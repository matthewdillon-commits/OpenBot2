import type { ScheduleGateway } from "../jobs/gateway";
import type { ScheduledJob } from "../jobs/store";
import type { EmailMailboxes } from "./mailbox";
import { type InboxCursorStore, mailboxKey } from "./cursor";
import type { EmailTransport, InboxInspect, InboxMessage } from "./transport";

const MAX_PER_TICK = 20;
const WAKE_BODY_CHARS = 1500;

export type InboundEmailPoller = {
  resolve: () => Promise<EmailMailboxes>;
  transport: EmailTransport;
  cursors: InboxCursorStore;
  gateway: Pick<ScheduleGateway, "list" | "fireInbound">;
};

export type InboundEmailTick = {
  fired: number;
  examined: number;
  seeded: boolean;
};

/**
 * One IMAP poll: seed or fire new mail through the schedule gateway.
 *
 * Trusted in-process only — this is the caller that may pass
 * `fireInbound({ trigger: "email", trusted: true })`. The HTTP webhook still
 * requires the secret. Mail bodies and the mailbox password never go on the
 * audit trail; the wake brief may include a short body for the Bot.
 */
export async function pollInboundEmail(
  options: InboundEmailPoller,
): Promise<InboundEmailTick> {
  const jobs = (await options.gateway.list()).filter(
    (job) => job.kind === "email",
  );
  if (jobs.length === 0) {
    return { fired: 0, examined: 0, seeded: false };
  }

  const mailbox = (await options.resolve()).imap;
  if (!mailbox) {
    return { fired: 0, examined: 0, seeded: false };
  }

  const key = mailboxKey(mailbox);
  const state = await inspectInbox(options.transport, mailbox);
  const cursor = await options.cursors.get(key);
  if (!cursor || cursor.uidValidity !== state.uidValidity) {
    await options.cursors.save({
      mailboxKey: key,
      uidValidity: state.uidValidity,
      lastUid: state.maxUid,
    });
    return { fired: 0, examined: 0, seeded: true };
  }

  const listed = await options.transport.list(mailbox, {
    limit: MAX_PER_TICK,
    afterUid: cursor.lastUid,
  });
  const active = jobs.filter((job) => job.status === "active");
  let fired = 0;
  let advancedTo = cursor.lastUid;

  for (const listedMessage of listed) {
    const uid = Number(listedMessage.id);
    if (!Number.isInteger(uid) || uid < 1) continue;

    const message = await withBody(options.transport, mailbox, listedMessage);
    for (const job of active) {
      if (!messageMatchesJob(message, job)) continue;
      const result = await options.gateway.fireInbound({
        jobId: job.id,
        trigger: "email",
        trusted: true,
        wakeBrief: composeInboundBrief(job.brief, message),
        inbound: {
          from: message.from,
          subject: message.subject,
          id: message.id,
        },
      });
      if (result.ok) fired += 1;
    }
    advancedTo = Math.max(advancedTo, uid);
  }

  if (advancedTo !== cursor.lastUid) {
    await options.cursors.save({
      mailboxKey: key,
      uidValidity: state.uidValidity,
      lastUid: advancedTo,
    });
  }

  return { fired, examined: listed.length, seeded: false };
}

export function composeInboundBrief(
  standing: string,
  message: Pick<
    InboxMessage,
    "id" | "from" | "to" | "subject" | "snippet" | "body"
  >,
): string {
  const body = (message.body ?? message.snippet ?? "").trim();
  const excerpt =
    body.length > WAKE_BODY_CHARS
      ? `${body.slice(0, WAKE_BODY_CHARS - 3).trimEnd()}...`
      : body;
  return [
    standing.trim(),
    "",
    "A new inbox message arrived.",
    `id: ${message.id}`,
    `from: ${message.from || "(unknown)"}`,
    `to: ${message.to.join(", ") || "(unknown)"}`,
    `subject: ${message.subject || "(no subject)"}`,
    ...(excerpt ? ["", excerpt] : []),
  ].join("\n");
}

export function messageMatchesJob(
  message: Pick<InboxMessage, "from" | "to" | "subject">,
  match: Pick<ScheduledJob, "matchFrom" | "matchTo" | "matchSubject">,
): boolean {
  return (
    contains(message.from, match.matchFrom) &&
    contains(message.subject, match.matchSubject) &&
    contains(message.to.join(" "), match.matchTo)
  );
}

function contains(
  haystack: string,
  needle: string | null | undefined,
): boolean {
  const trimmed = needle?.trim();
  if (!trimmed) return true;
  return haystack.toLowerCase().includes(trimmed.toLowerCase());
}

async function inspectInbox(
  transport: EmailTransport,
  mailbox: Parameters<NonNullable<EmailTransport["inspect"]>>[0],
): Promise<InboxInspect> {
  if (transport.inspect) return transport.inspect(mailbox);
  const newest = await transport.list(mailbox, { limit: 1 });
  const maxUid = Number(newest[0]?.id);
  return {
    uidValidity: 1,
    maxUid: Number.isInteger(maxUid) && maxUid > 0 ? maxUid : 0,
  };
}

async function withBody(
  transport: EmailTransport,
  mailbox: Parameters<EmailTransport["read"]>[0],
  listed: InboxMessage,
): Promise<InboxMessage> {
  try {
    const read = await transport.read(mailbox, listed.id);
    if (read) return read;
  } catch {
    // A list snippet is enough to wake; a failed read must not skip the fire.
  }
  return listed;
}
