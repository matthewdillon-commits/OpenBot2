import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { EmailMailbox } from "./mailbox";

export type OutboundMessage = {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
};

export type InboxMessage = {
  id: string;
  from: string;
  to: string[];
  subject: string;
  date: string;
  snippet: string;
  body?: string;
};

export type ListInbox = {
  limit: number;
  unreadOnly?: boolean;
};

/**
 * How mail leaves and enters this deployment.
 *
 * The real implementation talks SMTP and IMAP. Tests pass a fake so a deny rule, an audit row,
 * and a missing credential can be checked without a mailbox. The password is an argument to each
 * call, never a field on the transport, so a log of the transport itself cannot print it.
 */
export type EmailTransport = {
  send: (
    mailbox: EmailMailbox,
    message: OutboundMessage,
  ) => Promise<{ messageId: string }>;
  list: (mailbox: EmailMailbox, options: ListInbox) => Promise<InboxMessage[]>;
  read: (mailbox: EmailMailbox, id: string) => Promise<InboxMessage | null>;
};

export function createEmailTransport(options?: {
  send?: EmailTransport["send"];
  list?: EmailTransport["list"];
  read?: EmailTransport["read"];
}): EmailTransport {
  return {
    send: options?.send ?? smtpSend,
    list: options?.list ?? imapList,
    read: options?.read ?? imapRead,
  };
}

/**
 * An error a Bot may see. The password is stripped when we have it; AUTH lines are dropped even
 * when we do not, because some servers echo the attempt.
 */
export function describeTransportError(
  error: unknown,
  secret?: string,
): string {
  const raw =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "the mail server did not accept the request";
  let message = raw;
  if (secret) {
    message = message.split(secret).join("[redacted]");
  }
  return message
    .replace(/pass(?:word)?\s*[=:]\s*\S+/gi, "password=[redacted]")
    .replace(/\bAUTH\b[^\n]*/gi, "AUTH [redacted]");
}

async function smtpSend(
  mailbox: EmailMailbox,
  message: OutboundMessage,
): Promise<{ messageId: string }> {
  const transporter = nodemailer.createTransport({
    host: mailbox.host,
    port: mailbox.port,
    secure: mailbox.secure,
    auth: { user: mailbox.user, pass: mailbox.password },
  });
  try {
    const info = await transporter.sendMail({
      from: mailbox.from ?? mailbox.user,
      to: message.to.join(", "),
      ...(message.cc && message.cc.length > 0
        ? { cc: message.cc.join(", ") }
        : {}),
      subject: message.subject,
      text: message.body,
    });
    return {
      messageId: typeof info.messageId === "string" ? info.messageId : "",
    };
  } catch (error) {
    throw new Error(describeTransportError(error, mailbox.password));
  } finally {
    transporter.close();
  }
}

async function imapList(
  mailbox: EmailMailbox,
  options: ListInbox,
): Promise<InboxMessage[]> {
  return withImap(mailbox, async (client) => {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const listed: InboxMessage[] = [];
      if (options.unreadOnly) {
        const found = await client.search({ seen: false }, { uid: true });
        const uids = (found || []).slice(-options.limit);
        if (uids.length === 0) return [];
        for await (const msg of client.fetch(
          uids,
          { envelope: true, uid: true, source: { maxLength: 8_000 } },
          { uid: true },
        )) {
          listed.push(fromFetched(msg, false));
        }
      } else {
        const exists =
          client.mailbox && "exists" in client.mailbox
            ? client.mailbox.exists
            : 0;
        if (exists < 1) return [];
        const start = Math.max(1, exists - options.limit + 1);
        for await (const msg of client.fetch(`${start}:*`, {
          envelope: true,
          uid: true,
          source: { maxLength: 8_000 },
        })) {
          listed.push(fromFetched(msg, false));
        }
      }
      listed.sort((a, b) => Number(b.id) - Number(a.id));
      return listed;
    } finally {
      lock.release();
    }
  });
}

async function imapRead(
  mailbox: EmailMailbox,
  id: string,
): Promise<InboxMessage | null> {
  const uid = Number(id);
  if (!Number.isInteger(uid) || uid < 1) return null;

  return withImap(mailbox, async (client) => {
    const lock = await client.getMailboxLock("INBOX");
    try {
      for await (const msg of client.fetch(
        uid,
        { envelope: true, uid: true, source: true },
        { uid: true },
      )) {
        return fromFetched(msg, true);
      }
      return null;
    } finally {
      lock.release();
    }
  });
}

async function withImap<T>(
  mailbox: EmailMailbox,
  run: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const client = new ImapFlow({
    host: mailbox.host,
    port: mailbox.port,
    secure: mailbox.secure,
    auth: { user: mailbox.user, pass: mailbox.password },
    logger: false,
  });
  try {
    await client.connect();
    return await run(client);
  } catch (error) {
    throw new Error(describeTransportError(error, mailbox.password));
  } finally {
    try {
      await client.logout();
    } catch {
      // A failed connect has nothing to log out of.
    }
  }
}

function fromFetched(
  msg: {
    uid?: number;
    envelope?: {
      from?: Array<{ name?: string; address?: string }>;
      to?: Array<{ name?: string; address?: string }>;
      subject?: string;
      date?: Date;
    };
    source?: Buffer;
  },
  withBody: boolean,
): InboxMessage {
  const source = bufferText(msg.source);
  const extracted = textFromRfc822(source);
  const from = formatAddresses(msg.envelope?.from);
  return {
    id: String(msg.uid ?? ""),
    from: from[0] ?? "",
    to: formatAddresses(msg.envelope?.to),
    subject: msg.envelope?.subject?.trim() ?? "",
    date: msg.envelope?.date ? msg.envelope.date.toISOString() : "",
    snippet: extracted.snippet,
    ...(withBody ? { body: extracted.body } : {}),
  };
}

function formatAddresses(
  list: Array<{ name?: string; address?: string }> | undefined,
): string[] {
  if (!list) return [];
  return list
    .map((entry) => {
      const address = entry.address?.trim() ?? "";
      if (!address) return "";
      const name = entry.name?.trim();
      return name ? `${name} <${address}>` : address;
    })
    .filter(Boolean);
}

function bufferText(value: Buffer | undefined): string {
  if (!value) return "";
  return value.toString("utf8");
}

/**
 * Pull a plain-text body out of a raw RFC 822 message.
 *
 * Enough for the inboxes this tool is for: `text/plain`, `multipart/alternative` with a plain part,
 * quoted-printable and base64. An HTML-only message is stripped of tags rather than handed to the
 * model as markup. This is not a full MIME library; a part we cannot read becomes an empty body,
 * which the tool reports as such instead of inventing text.
 */
export function textFromRfc822(source: string): {
  body: string;
  snippet: string;
} {
  const normalised = source.replace(/\r\n/g, "\n");
  const split = normalised.indexOf("\n\n");
  const headers = split === -1 ? normalised : normalised.slice(0, split);
  const rawBody = split === -1 ? "" : normalised.slice(split + 2);
  const contentType = headerValue(headers, "content-type") ?? "text/plain";
  const encoding = headerValue(headers, "content-transfer-encoding") ?? "";
  const boundary = mimeBoundary(contentType);

  let body = "";
  if (boundary) {
    body =
      plainFromMultipart(rawBody, boundary) ??
      htmlFromMultipart(rawBody, boundary) ??
      "";
  } else if (contentType.toLowerCase().includes("text/html")) {
    body = stripHtml(decodePart(rawBody, encoding));
  } else {
    body = decodePart(rawBody, encoding);
  }

  body = body.split("\0").join("").trim();
  return { body, snippet: snippetOf(body) };
}

export function snippetOf(body: string): string {
  const collapsed = body.replace(/\s+/g, " ").trim();
  if (collapsed.length <= 200) return collapsed;
  return `${collapsed.slice(0, 197).trimEnd()}...`;
}

function headerValue(headers: string, name: string): string | undefined {
  const folded = headers.replace(/\n[ \t]+/g, " ");
  const match = folded.match(new RegExp(`^${name}:\\s*(.+)$`, "im"));
  return match?.[1]?.trim();
}

function mimeBoundary(contentType: string): string | undefined {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/i);
  return match?.[1] ?? match?.[2];
}

function plainFromMultipart(raw: string, boundary: string): string | null {
  return firstPart(raw, boundary, "text/plain");
}

function htmlFromMultipart(raw: string, boundary: string): string | null {
  const html = firstPart(raw, boundary, "text/html");
  return html ? stripHtml(html) : null;
}

function firstPart(raw: string, boundary: string, want: string): string | null {
  const delimiter = `--${boundary}`;
  for (const chunk of raw.split(delimiter)) {
    const trimmed = chunk.replace(/^[\n-]+/, "").replace(/--\s*$/, "");
    if (!trimmed || trimmed === "--") continue;
    const split = trimmed.indexOf("\n\n");
    const headers = split === -1 ? trimmed : trimmed.slice(0, split);
    const partBody = split === -1 ? "" : trimmed.slice(split + 2);
    const type = headerValue(headers, "content-type") ?? "";
    if (!type.toLowerCase().includes(want)) continue;
    const encoding = headerValue(headers, "content-transfer-encoding") ?? "";
    return decodePart(partBody, encoding);
  }
  return null;
}

function decodePart(raw: string, encoding: string): string {
  const kind = encoding.toLowerCase();
  if (kind === "base64") {
    return Buffer.from(raw.replace(/\s/g, ""), "base64").toString("utf8");
  }
  if (kind === "quoted-printable") {
    return decodeQuotedPrintable(raw);
  }
  return raw;
}

function decodeQuotedPrintable(raw: string): string {
  const soft = raw.replace(/=\n/g, "");
  return soft.replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}
