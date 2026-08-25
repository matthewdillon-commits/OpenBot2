import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { createRoleRepository } from "../src/auth/guards";
import { loadConfig } from "../src/config";
import { createDatabase } from "../src/db/client";
import { bindRequestRls } from "../src/db/rls";
import { accounts, sessions, users } from "../src/db/schema";
import { TEST_POOL } from "./support/database";
import { testEnvironment } from "./support/environment";
import { ensureLocalOrganization } from "./support/organization";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://openbot:openbot@localhost:5432/openbot";

const postgresReachable = await (async () => {
  const probe = createDatabase(databaseUrl, { max: 1 });
  try {
    await probe.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  } finally {
    await probe.$client.close();
  }
})();

const AUTH_URL = "http://localhost:3001";
const APP_ORIGIN = "http://localhost:3010";

describe.skipIf(!postgresReachable)(
  "email/password signup against a database that already has users",
  () => {
    const database = createDatabase(databaseUrl, TEST_POOL);
    const suffix = randomUUID();
    const existing = {
      id: `user_existing_${suffix}`,
      email: `existing-${suffix}@openbot.test`,
    };
    const createdEmails: string[] = [];

    afterAll(async () => {
      for (const email of createdEmails) {
        await database.delete(users).where(eq(users.email, email));
      }
      await database.delete(users).where(eq(users.id, existing.id));
      await database.$client.close();
    });

    test("insert returning under the request RLS wrapper does not collide with itself", async () => {
      await ensureLocalOrganization(database);
      await database.execute(sql`grant openbot_rls to current_user`);
      await bindRequestRls(database, { orgId: null, bypass: false });
      const returningEmail = `returning-${suffix}@openbot.test`;
      createdEmails.push(returningEmail);
      const [returned] = await database
        .insert(users)
        .values({
          id: `user_returning_${suffix}`,
          email: returningEmail,
          name: "Returning insert",
        })
        .returning({ id: users.id });
      expect(returned?.id).toBe(`user_returning_${suffix}`);
    });

    test("a new address creates a user, credential account, and session", async () => {
      await ensureLocalOrganization(database);
      await database.execute(sql`grant openbot_rls to current_user`);
      await database.insert(users).values({
        id: existing.id,
        email: existing.email,
        name: "Already here",
      });

      const config = loadConfig(
        testEnvironment({
          OPENBOT_EMAIL_AUTH: "true",
          BETTER_AUTH_URL: AUTH_URL,
          TRUSTED_ORIGINS: APP_ORIGIN,
        }),
      );
      const auth = createAuth(config, database);
      const app = createApp(
        config,
        auth,
        createRoleRepository(database),
        ...Array.from({ length: 23 }, () => undefined),
        {
          bindRls: (input) => bindRequestRls(database, input),
        },
      );

      const email = `signup-${suffix}@openbot.test`;
      const password = "signup-test-password";
      createdEmails.push(email);

      const response = await app.request(`${AUTH_URL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: {
          origin: APP_ORIGIN,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
          name: "New person",
        }),
      });
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body).not.toMatchObject({ code: "FAILED_TO_CREATE_USER" });

      const [user] = await database
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      expect(user?.email).toBe(email);
      const userId = user?.id;
      expect(userId).toBeTruthy();
      expect(userId).not.toBe(existing.id);
      if (!userId) {
        throw new Error("signup did not insert a user");
      }

      const accountRows = await database
        .select({
          userId: accounts.userId,
          providerId: accounts.providerId,
        })
        .from(accounts)
        .where(eq(accounts.userId, userId));
      expect(accountRows).toEqual([{ userId, providerId: "credential" }]);

      const sessionRows = await database
        .select({ userId: sessions.userId })
        .from(sessions)
        .where(eq(sessions.userId, userId));
      expect(sessionRows).toEqual([{ userId }]);

      const signIn = await app.request(`${AUTH_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          origin: APP_ORIGIN,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });
      expect(signIn.status).toBe(200);
    });
  },
);
