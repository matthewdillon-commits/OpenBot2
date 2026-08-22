import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import {
  createCredential,
  createCredentialStore,
  encryptSecret,
} from "../src/credentials";
import { createDatabase } from "../src/db/client";
import { credentials } from "../src/db/schema";
import { resolveEmailMailboxes } from "../src/email/resolve";
import { emailTools } from "../src/email/tools";
import { TEST_POOL } from "./support/database";
import { testEnvironment } from "./support/environment";

const key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const config = loadConfig(testEnvironment({ KEY_ENCRYPTION_KEY: key }));
const database = createDatabase(
  process.env.DATABASE_URL ??
    "postgres://openbot:openbot@localhost:5432/openbot",
  TEST_POOL,
);
const credentialIds: string[] = [];

afterEach(async () => {
  for (const credentialId of credentialIds.splice(0)) {
    await database.delete(credentials).where(eq(credentials.id, credentialId));
  }
});

const store = createCredentialStore(database);

describe("email credentials in the vault", () => {
  test("no mailbox row means neither tool is offered", async () => {
    const mailboxes = await resolveEmailMailboxes({
      encryptionKey: key,
      reader: store,
    });
    expect(mailboxes).toEqual({ smtp: null, imap: null });
    const tools = await emailTools({
      resolve: async () => mailboxes,
      transport: {
        send: async () => {
          throw new Error("must not send");
        },
        list: async () => {
          throw new Error("must not list");
        },
        read: async () => {
          throw new Error("must not read");
        },
      },
      auditStore: { insert: async () => undefined },
      policy: () => ({ mode: "enforce", deny: [], allow: ["true"] }),
      botId: "general-assistant",
      actorId: "u_1",
    });
    expect(tools).toEqual([]);
  });

  test("a stored SMTP credential decrypts for send and never appears on the list API", async () => {
    const id = randomUUID();
    credentialIds.push(id);
    await database.insert(credentials).values({
      id,
      kind: "email",
      provider: "smtp",
      keyId: "primary",
      encryptedValue: await encryptSecret(key, "mailbox-password"),
      metadata: {
        host: "smtp.example.com",
        port: 587,
        user: "bot@example.com",
        from: "bot@example.com",
        secure: false,
      },
    });

    const mailboxes = await resolveEmailMailboxes({
      encryptionKey: key,
      reader: store,
    });
    expect(mailboxes.smtp?.password).toBe("mailbox-password");
    expect(mailboxes.imap).toBeNull();

    const listed = await store.list();
    const row = listed.find((credential) => credential.id === id);
    expect(row?.kind).toBe("email");
    expect(JSON.stringify(row)).not.toContain("mailbox-password");
    expect(row?.metadata).toEqual({
      host: "smtp.example.com",
      port: 587,
      user: "bot@example.com",
      from: "bot@example.com",
      secure: false,
    });
  });

  test("the admin API accepts an email credential and returns status without the password", async () => {
    const created: unknown[] = [];
    const app = createApp(
      config,
      {
        handler: () => new Response(null, { status: 204 }),
        api: {
          getSession: async () => ({
            user: { id: "admin", email: "admin@openbot.test" },
          }),
        },
      },
      { rolesForUser: async () => ["admin"] },
      undefined,
      {
        list: async () => [],
        create: async (input) => {
          created.push(input);
          return {
            id: "credential-email",
            kind: input.kind,
            provider: input.provider,
            keyId: input.keyId,
            metadata: input.metadata,
            revokedAt: null,
          };
        },
      },
    );

    const response = await app.request(
      "http://openbot.local/api/admin/credentials",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "email",
          provider: "smtp",
          keyId: "primary",
          metadata: {
            host: "smtp.example.com",
            port: 587,
            user: "bot@example.com",
            from: "bot@example.com",
            secure: false,
          },
          plaintext: "mailbox-password",
        }),
      },
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("mailbox-password");
    expect(created).toEqual([
      {
        kind: "email",
        provider: "smtp",
        keyId: "primary",
        metadata: {
          host: "smtp.example.com",
          port: 587,
          user: "bot@example.com",
          from: "bot@example.com",
          secure: false,
        },
        plaintext: "mailbox-password",
        actorUserId: "admin",
      },
    ]);
  });

  test("an email credential with no host is refused at the door", async () => {
    const app = createApp(
      config,
      {
        handler: () => new Response(null, { status: 204 }),
        api: {
          getSession: async () => ({
            user: { id: "admin", email: "admin@openbot.test" },
          }),
        },
      },
      { rolesForUser: async () => ["admin"] },
      undefined,
      {
        list: async () => [],
        create: async () => {
          throw new Error("must not store");
        },
      },
    );

    const response = await app.request(
      "http://openbot.local/api/admin/credentials",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "email",
          provider: "smtp",
          keyId: "primary",
          metadata: { user: "bot@example.com" },
          plaintext: "mailbox-password",
        }),
      },
    );

    expect(response.status).toBe(400);
  });

  test("createCredential audits kind and provider, never the password", async () => {
    const audited: unknown[] = [];
    const credential = await createCredential(
      {
        encryptionKey: key,
        store: {
          create: async (value) => {
            expect(value.encryptedValue).not.toContain("mailbox-password");
            return { id: "credential-email", revokedAt: null };
          },
          revoke: async () => new Date(),
        },
        auditStore: {
          insert: async (event) => {
            audited.push(event);
          },
        },
      },
      {
        kind: "email",
        provider: "imap",
        keyId: "inbox",
        metadata: {
          host: "imap.example.com",
          port: 993,
          user: "bot@example.com",
          secure: true,
        },
        plaintext: "mailbox-password",
        actorUserId: "admin",
      },
    );

    expect(credential.kind).toBe("email");
    expect(JSON.stringify(audited)).not.toContain("mailbox-password");
    expect(audited).toEqual([
      {
        eventType: "credential.created",
        targetType: "credential",
        targetId: "credential-email",
        actorUserId: "admin",
        payload: {
          kind: "email",
          provider: "imap",
          keyId: "inbox",
        },
      },
    ]);
  });
});
