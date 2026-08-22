import { describe, expect, test } from "bun:test";
import type { AuditEventInput, AuditStore } from "../src/audit";
import type { ActionPolicy } from "../src/computer/policy";
import type { EmailMailbox, EmailMailboxes } from "../src/email/mailbox";
import {
  READ_EMAIL_TOOL,
  SEND_EMAIL_TOOL,
  emailTools,
} from "../src/email/tools";
import type {
  EmailTransport,
  InboxMessage,
  OutboundMessage,
} from "../src/email/transport";
import type { GrantedTool } from "../src/plugins/tools";
import { REFUSAL_MARKER } from "../src/plugins/tools";

const PERMISSIVE: ActionPolicy = { mode: "enforce", deny: [], allow: ["true"] };

const SMTP: EmailMailbox = {
  host: "smtp.example.com",
  port: 587,
  secure: false,
  user: "bot@example.com",
  from: "bot@example.com",
  password: "super-secret-password",
};

const IMAP: EmailMailbox = {
  host: "imap.example.com",
  port: 993,
  secure: true,
  user: "bot@example.com",
  password: "super-secret-password",
};

const SAMPLE: InboxMessage = {
  id: "17",
  from: "Alice <alice@example.com>",
  to: ["bot@example.com"],
  subject: "Quarterly report",
  date: "2026-08-22T10:00:00.000Z",
  snippet: "Please find the figures attached.",
  body: "Please find the figures attached.\n\nConfidential revenue: 12 million.",
};

function recorder() {
  const written: AuditEventInput[] = [];
  const auditStore: AuditStore = {
    insert: async (event) => {
      written.push(event);
    },
  };
  return { written, auditStore };
}

function fakeTransport(): EmailTransport & {
  sent: OutboundMessage[];
  listed: boolean;
  readIds: string[];
} {
  const sent: OutboundMessage[] = [];
  const readIds: string[] = [];
  return {
    sent,
    listed: false,
    readIds,
    send: async (_mailbox, message) => {
      sent.push(message);
      return { messageId: "<generated@example.com>" };
    },
    list: async () => {
      return [SAMPLE];
    },
    read: async (_mailbox, id) => {
      readIds.push(id);
      return id === SAMPLE.id ? SAMPLE : null;
    },
  };
}

function namedTool(tools: GrantedTool[], name: string): GrantedTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`expected ${name} to be offered`);
  }
  return tool;
}

async function toolsFor(
  mailboxes: EmailMailboxes,
  extras: {
    policy?: ActionPolicy;
    transport?: EmailTransport;
    auditStore?: AuditStore;
  } = {},
) {
  const transport = extras.transport ?? fakeTransport();
  const auditStore = extras.auditStore ?? recorder().auditStore;
  return emailTools({
    resolve: async () => mailboxes,
    transport,
    auditStore,
    policy: () => extras.policy ?? PERMISSIVE,
    botId: "general-assistant",
    actorId: "u_1",
    actorUserId: "u_1",
  });
}

describe("offering the mailbox tools", () => {
  test("absent credential hides both tools", async () => {
    const tools = await toolsFor({ smtp: null, imap: null });
    expect(tools.map((tool) => tool.name)).toEqual([]);
  });

  test("SMTP alone offers send_email", async () => {
    const tools = await toolsFor({ smtp: SMTP, imap: null });
    expect(tools.map((tool) => tool.name)).toEqual([SEND_EMAIL_TOOL]);
  });

  test("IMAP alone offers read_email", async () => {
    const tools = await toolsFor({ smtp: null, imap: IMAP });
    expect(tools.map((tool) => tool.name)).toEqual([READ_EMAIL_TOOL]);
  });
});

describe("send_email", () => {
  test("sends after a permit and names destination and subject, not the body", async () => {
    const transport = fakeTransport();
    const { written, auditStore } = recorder();
    const tool = namedTool(
      await toolsFor({ smtp: SMTP, imap: null }, { transport, auditStore }),
      SEND_EMAIL_TOOL,
    );

    const answer = await tool.execute({
      to: "alice@example.com",
      subject: "Quarterly report",
      body: "Confidential revenue: 12 million.",
    });

    expect(answer).toContain("alice@example.com");
    expect(answer).toContain("Quarterly report");
    expect(answer).not.toContain("12 million");
    expect(answer).not.toContain("super-secret-password");
    expect(transport.sent).toEqual([
      {
        to: ["alice@example.com"],
        subject: "Quarterly report",
        body: "Confidential revenue: 12 million.",
      },
    ]);
    expect(written).toHaveLength(1);
    expect(written[0]?.eventType).toBe("email.sent");
    expect(written[0]?.payload.to).toEqual(["alice@example.com"]);
    expect(written[0]?.payload.subject).toBe("Quarterly report");
    const serialised = JSON.stringify(written[0]?.payload);
    expect(serialised).not.toContain("12 million");
    expect(serialised).not.toContain("super-secret-password");
    expect(serialised).not.toContain("Confidential");
  });

  test("a deny rule never reaches the transport and is audited", async () => {
    const transport = fakeTransport();
    const { written, auditStore } = recorder();
    const tool = namedTool(
      await toolsFor(
        { smtp: SMTP, imap: null },
        {
          transport,
          auditStore,
          policy: {
            mode: "enforce",
            deny: ['intent == "email"'],
            allow: ["true"],
          },
        },
      ),
      SEND_EMAIL_TOOL,
    );

    const answer = await tool.execute({
      to: "alice@example.com",
      subject: "Quarterly report",
      body: "Confidential revenue: 12 million.",
    });

    expect(transport.sent).toEqual([]);
    expect(answer.startsWith(REFUSAL_MARKER)).toBe(true);
    expect(answer).toContain("send_email");
    expect(written[0]?.eventType).toBe("email.send_refused");
    expect(written[0]?.payload.decision).toMatchObject({
      allowed: false,
      carriedOut: false,
    });
    expect(JSON.stringify(written[0]?.payload)).not.toContain("12 million");
  });

  test("a tool-name deny also sends nothing", async () => {
    const transport = fakeTransport();
    const tool = namedTool(
      await toolsFor(
        { smtp: SMTP, imap: null },
        {
          transport,
          policy: {
            mode: "enforce",
            deny: ['tool.name == "send_email"'],
            allow: ["true"],
          },
        },
      ),
      SEND_EMAIL_TOOL,
    );

    const answer = await tool.execute({
      to: "alice@example.com",
      subject: "Hello",
      body: "Hi",
    });

    expect(transport.sent).toEqual([]);
    expect(answer.startsWith(REFUSAL_MARKER)).toBe(true);
  });

  test("an absent policy denies and sends nothing", async () => {
    const transport = fakeTransport();
    const { written, auditStore } = recorder();
    const tool = namedTool(
      await toolsFor(
        { smtp: SMTP, imap: null },
        {
          transport,
          auditStore,
          policy: { mode: "enforce", deny: [], allow: [] },
        },
      ),
      SEND_EMAIL_TOOL,
    );

    const answer = await tool.execute({
      to: "alice@example.com",
      subject: "Hello",
      body: "Hi",
    });

    expect(transport.sent).toEqual([]);
    expect(answer.startsWith(REFUSAL_MARKER)).toBe(true);
    expect(written[0]?.eventType).toBe("email.send_refused");
  });

  test("a credential revoked between offer and call sends nothing", async () => {
    const transport = fakeTransport();
    const { written, auditStore } = recorder();
    let current: EmailMailboxes = { smtp: SMTP, imap: null };
    const tool = namedTool(
      await emailTools({
        resolve: async () => current,
        transport,
        auditStore,
        policy: () => PERMISSIVE,
        botId: "general-assistant",
        actorId: "u_1",
      }),
      SEND_EMAIL_TOOL,
    );
    current = { smtp: null, imap: null };

    const answer = await tool.execute({
      to: "alice@example.com",
      subject: "Hello",
      body: "Hi",
    });

    expect(answer).toContain("not configured");
    expect(transport.sent).toEqual([]);
    expect(written).toHaveLength(0);
  });

  test("a malformed call is answered and not audited", async () => {
    const transport = fakeTransport();
    const { written, auditStore } = recorder();
    const tool = namedTool(
      await toolsFor({ smtp: SMTP, imap: null }, { transport, auditStore }),
      SEND_EMAIL_TOOL,
    );

    const answer = await tool.execute({ subject: "Hello" });

    expect(answer).toContain("needs to, subject, and body");
    expect(transport.sent).toEqual([]);
    expect(written).toHaveLength(0);
  });

  test("a transport failure is not recorded as a send", async () => {
    const { written, auditStore } = recorder();
    const tool = namedTool(
      await toolsFor(
        { smtp: SMTP, imap: null },
        {
          auditStore,
          transport: {
            ...fakeTransport(),
            send: async () => {
              throw new Error("the mail server did not accept the request");
            },
          },
        },
      ),
      SEND_EMAIL_TOOL,
    );

    const answer = await tool.execute({
      to: "alice@example.com",
      subject: "Hello",
      body: "Hi",
    });

    expect(answer).toContain("could not be sent");
    expect(written).toHaveLength(0);
  });
});

describe("read_email", () => {
  test("lists recent mail without putting bodies on the trail", async () => {
    const { written, auditStore } = recorder();
    const tool = namedTool(
      await toolsFor({ smtp: null, imap: IMAP }, { auditStore }),
      READ_EMAIL_TOOL,
    );

    const answer = await tool.execute({});

    expect(answer).toContain("Quarterly report");
    expect(answer).toContain("id: 17");
    expect(answer).toContain("Please find the figures attached.");
    expect(answer).not.toContain("12 million");
    expect(written[0]?.eventType).toBe("email.read");
    expect(written[0]?.payload.matched).toBe(1);
    expect(written[0]?.payload.subjects).toEqual(["Quarterly report"]);
    const serialised = JSON.stringify(written[0]?.payload);
    expect(serialised).not.toContain("12 million");
    expect(serialised).not.toContain("super-secret-password");
    expect(serialised).not.toContain("Confidential");
  });

  test("reads one message by id and still keeps the body off the trail", async () => {
    const transport = fakeTransport();
    const { written, auditStore } = recorder();
    const tool = namedTool(
      await toolsFor({ smtp: null, imap: IMAP }, { transport, auditStore }),
      READ_EMAIL_TOOL,
    );

    const answer = await tool.execute({ id: "17" });

    expect(transport.readIds).toEqual(["17"]);
    expect(answer).toContain("12 million");
    expect(written[0]?.eventType).toBe("email.read");
    expect(written[0]?.payload.subject).toBe("Quarterly report");
    expect(JSON.stringify(written[0]?.payload)).not.toContain("12 million");
  });

  test("a deny rule never reaches IMAP", async () => {
    const transport = fakeTransport();
    const listed: string[] = [];
    const { written, auditStore } = recorder();
    const tool = namedTool(
      await toolsFor(
        { smtp: null, imap: IMAP },
        {
          auditStore,
          policy: {
            mode: "enforce",
            deny: ['tool.name == "read_email"'],
            allow: ["true"],
          },
          transport: {
            ...transport,
            list: async () => {
              listed.push("called");
              return [SAMPLE];
            },
          },
        },
      ),
      READ_EMAIL_TOOL,
    );

    const answer = await tool.execute({});

    expect(listed).toEqual([]);
    expect(answer.startsWith(REFUSAL_MARKER)).toBe(true);
    expect(written[0]?.eventType).toBe("email.read_refused");
  });
});
