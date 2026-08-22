import { z } from "zod";
import { type AuditStore, recordAuditEvent } from "../audit";
import {
  type ActionPolicy,
  evaluateActionPolicy,
  type PolicyContext,
  type PolicyDecision,
} from "../computer/policy";
import { type GrantedTool, REFUSAL_MARKER } from "../plugins/tools";
import {
  type EmailMailbox,
  type EmailMailboxes,
  parseAddressList,
} from "./mailbox";
import type { EmailTransport, InboxMessage } from "./transport";

/**
 * A mailbox, as something a Bot can call.
 *
 * WHY IT IS A CUSTOM TOOL. Gmail-as-MCP would dump every vendor verb into the prompt and leave
 * destination, subject and the password on the same path. This deployment's own send and read go
 * through the same resolve → decide → audit → act order as messaging and web search. Policy names
 * `intent == "email"` or the tool; the trail names the destination and the subject and never the
 * body or the credential.
 *
 * OFFERED WHEN A MAILBOX EXISTS. No SMTP credential, no `send_email`. No IMAP credential, no
 * `read_email`. Absent both, neither tool is registered — the same pattern as `TAVILY_API_KEY`.
 */

export const SEND_EMAIL_TOOL = "send_email";
export const READ_EMAIL_TOOL = "read_email";

const NOT_CONFIGURED =
  "Email is not configured for this deployment. An administrator can add an SMTP or IMAP credential.";

const EMPTY_INBOX =
  "The inbox has no messages that match. Say so rather than inventing mail.";

const sendParameters = z.object({
  to: z
    .string()
    .describe("Recipient address. Comma-separate several if needed."),
  cc: z.string().optional().describe("Optional CC addresses, comma-separated."),
  subject: z.string().describe("Subject line."),
  body: z.string().describe("Plain-text body. Do not include credentials."),
});

const readParameters = z.object({
  id: z
    .string()
    .optional()
    .describe(
      "Message id from a previous list. Omit to list recent mail instead.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .describe(
      "How many recent messages to list. Default 10. Ignored when id is set.",
    ),
  unread_only: z
    .boolean()
    .optional()
    .describe("When listing, only unseen messages."),
});

export type EmailToolOptions = {
  resolve: () => Promise<EmailMailboxes>;
  transport: EmailTransport;
  auditStore: AuditStore;
  policy: () => ActionPolicy;
  botId: string;
  actorId: string;
  /** A real `users` row, when there is one. The audit table has a foreign key to it. */
  actorUserId?: string;
};

/**
 * The mailbox tools this Bot may be offered, or none.
 *
 * Resolves once to decide what to register. Each call resolves again before it acts, so a
 * credential revoked between the offer and the call sends nothing.
 */
export async function emailTools(
  options: EmailToolOptions,
): Promise<GrantedTool[]> {
  const mailboxes = await options.resolve();
  const tools: GrantedTool[] = [];
  if (mailboxes.smtp) tools.push(sendEmailTool(options));
  if (mailboxes.imap) tools.push(readEmailTool(options));
  return tools;
}

function sendEmailTool(options: EmailToolOptions): GrantedTool {
  const {
    resolve,
    transport,
    auditStore,
    policy,
    botId,
    actorId,
    actorUserId,
  } = options;

  return {
    name: SEND_EMAIL_TOOL,
    description:
      "Send an email from this deployment's mailbox. Use this to write to a person outside " +
      "OpenBot. The send is judged by policy before anything leaves, and the destination and " +
      "subject are recorded. Do not put passwords or API keys in the body.",
    parameters: sendParameters,
    execute: async (args: unknown) => {
      const parsed = sendParameters.safeParse(args);
      if (!parsed.success) {
        return "That send needs to, subject, and body.";
      }

      const to = parseAddressList(parsed.data.to);
      const cc = parsed.data.cc ? parseAddressList(parsed.data.cc) : [];
      const subject = parsed.data.subject.trim();
      const body = parsed.data.body;
      if (to.length === 0) {
        return "That send needs at least one recipient address.";
      }
      if (!subject) {
        return "That send needs a subject.";
      }

      const mailbox = await mailboxOrGone(resolve, "smtp");
      if (!mailbox) return NOT_CONFIGURED;

      const destinations = [...to, ...cc];
      const context = emailContext({
        tool: SEND_EMAIL_TOOL,
        botId,
        actorId,
        to: destinations.join(", "),
        subject,
      });
      const verdict = evaluateActionPolicy(policy(), context);
      if (!verdict.forward) {
        await writeEmail(auditStore, {
          eventType: "email.send_refused",
          botId,
          actorId,
          actorUserId,
          tool: SEND_EMAIL_TOOL,
          to: destinations,
          subject,
          verdict,
        });
        return `${REFUSAL_MARKER} ${verdict.reason}`;
      }

      let sent: { messageId: string };
      try {
        sent = await transport.send(mailbox, {
          to,
          ...(cc.length > 0 ? { cc } : {}),
          subject,
          body,
        });
      } catch (error) {
        return error instanceof Error
          ? `The email could not be sent: ${error.message}`
          : "The email could not be sent.";
      }

      await writeEmail(auditStore, {
        eventType: "email.sent",
        botId,
        actorId,
        actorUserId,
        tool: SEND_EMAIL_TOOL,
        to: destinations,
        subject,
        messageId: sent.messageId,
        verdict,
      });

      return `Sent to ${to.join(", ")} with subject “${subject}”.`;
    },
  };
}

function readEmailTool(options: EmailToolOptions): GrantedTool {
  const {
    resolve,
    transport,
    auditStore,
    policy,
    botId,
    actorId,
    actorUserId,
  } = options;

  return {
    name: READ_EMAIL_TOOL,
    description:
      "List recent inbox messages, or read one by id. A list returns from, subject, date and id; " +
      "pass that id to read the body. Use this to see mail that arrived for this deployment, not " +
      "to search the web.",
    parameters: readParameters,
    execute: async (args: unknown) => {
      const parsed = readParameters.safeParse(args ?? {});
      if (!parsed.success) {
        return "That read needs a valid id or a limit between 1 and 25.";
      }

      const id = parsed.data.id?.trim() ?? "";
      const subjectForPolicy = id ? `id ${id}` : "list recent";
      const mailbox = await mailboxOrGone(resolve, "imap");
      if (!mailbox) return NOT_CONFIGURED;

      const context = emailContext({
        tool: READ_EMAIL_TOOL,
        botId,
        actorId,
        to: "",
        subject: subjectForPolicy,
      });
      const verdict = evaluateActionPolicy(policy(), context);
      if (!verdict.forward) {
        await writeEmail(auditStore, {
          eventType: "email.read_refused",
          botId,
          actorId,
          actorUserId,
          tool: READ_EMAIL_TOOL,
          to: [],
          subject: subjectForPolicy,
          verdict,
        });
        return `${REFUSAL_MARKER} ${verdict.reason}`;
      }

      if (id) {
        return readOne({
          transport,
          mailbox,
          id,
          auditStore,
          botId,
          actorId,
          actorUserId,
          verdict,
        });
      }

      return listRecent({
        transport,
        mailbox,
        limit: parsed.data.limit ?? 10,
        unreadOnly: parsed.data.unread_only === true,
        auditStore,
        botId,
        actorId,
        actorUserId,
        verdict,
      });
    },
  };
}

async function readOne(input: {
  transport: EmailTransport;
  mailbox: EmailMailbox;
  id: string;
  auditStore: AuditStore;
  botId: string;
  actorId: string;
  actorUserId?: string;
  verdict: PolicyDecision;
}): Promise<string> {
  let message: InboxMessage | null;
  try {
    message = await input.transport.read(input.mailbox, input.id);
  } catch (error) {
    return error instanceof Error
      ? `The inbox could not be read: ${error.message}`
      : "The inbox could not be read.";
  }

  if (!message) {
    return "No message with that id is in the inbox.";
  }

  await writeEmail(input.auditStore, {
    eventType: "email.read",
    botId: input.botId,
    actorId: input.actorId,
    actorUserId: input.actorUserId,
    tool: READ_EMAIL_TOOL,
    to: message.to,
    subject: message.subject,
    messageId: message.id,
    matched: 1,
    verdict: input.verdict,
  });

  return formatMessage(message, true);
}

async function listRecent(input: {
  transport: EmailTransport;
  mailbox: EmailMailbox;
  limit: number;
  unreadOnly: boolean;
  auditStore: AuditStore;
  botId: string;
  actorId: string;
  actorUserId?: string;
  verdict: PolicyDecision;
}): Promise<string> {
  let messages: InboxMessage[];
  try {
    messages = await input.transport.list(input.mailbox, {
      limit: input.limit,
      unreadOnly: input.unreadOnly,
    });
  } catch (error) {
    return error instanceof Error
      ? `The inbox could not be read: ${error.message}`
      : "The inbox could not be read.";
  }

  await writeEmail(input.auditStore, {
    eventType: "email.read",
    botId: input.botId,
    actorId: input.actorId,
    actorUserId: input.actorUserId,
    tool: READ_EMAIL_TOOL,
    to: [],
    subject: "list recent",
    matched: messages.length,
    subjects: messages.map((message) => message.subject),
    verdict: input.verdict,
  });

  if (messages.length === 0) return EMPTY_INBOX;

  return messages.map((message) => formatMessage(message, false)).join("\n\n");
}

function formatMessage(message: InboxMessage, withBody: boolean): string {
  const lines = [
    `id: ${message.id}`,
    `from: ${message.from || "(unknown)"}`,
    `to: ${message.to.join(", ") || "(unknown)"}`,
    `date: ${message.date || "(unknown)"}`,
    `subject: ${message.subject || "(no subject)"}`,
  ];
  if (withBody) {
    lines.push("", message.body?.trim() || "(empty body)");
  } else if (message.snippet) {
    lines.push(message.snippet);
  }
  return lines.join("\n");
}

async function mailboxOrGone(
  resolve: () => Promise<EmailMailboxes>,
  side: "smtp" | "imap",
): Promise<EmailMailbox | null> {
  const mailboxes = await resolve();
  return mailboxes[side];
}

function emailContext(input: {
  tool: string;
  botId: string;
  actorId: string;
  to: string;
  subject: string;
}): PolicyContext {
  return {
    tool: { name: input.tool },
    bot: { id: input.botId },
    actor: { id: input.actorId },
    page: { url: "", host: "" },
    element: { ref: "", role: "", name: "", type: "" },
    key: "",
    file: { path: "", name: "", extension: "" },
    command: "",
    intent: "email",
    email: { to: input.to, subject: input.subject },
  };
}

async function writeEmail(
  auditStore: AuditStore,
  entry: {
    eventType:
      | "email.sent"
      | "email.send_refused"
      | "email.read"
      | "email.read_refused";
    botId: string;
    actorId: string;
    actorUserId?: string;
    tool: string;
    to: string[];
    subject: string;
    messageId?: string;
    matched?: number;
    subjects?: string[];
    verdict: PolicyDecision;
  },
) {
  await recordAuditEvent(auditStore, {
    eventType: entry.eventType,
    targetType: "email",
    targetId: entry.botId,
    ...(entry.actorUserId ? { actorUserId: entry.actorUserId } : {}),
    payload: {
      bot: entry.botId,
      actor: entry.actorId,
      tool: entry.tool,
      to: entry.to,
      subject: entry.subject,
      ...(entry.messageId ? { messageId: entry.messageId } : {}),
      ...(entry.matched !== undefined ? { matched: entry.matched } : {}),
      ...(entry.subjects ? { subjects: entry.subjects } : {}),
      decision: {
        allowed: entry.verdict.allowed,
        mode: entry.verdict.mode,
        source: entry.verdict.source,
        rule: entry.verdict.matched,
        carriedOut: entry.verdict.forward,
      },
    },
  });
}
