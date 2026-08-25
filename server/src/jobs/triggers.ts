/**
 * Standing cron / webhook / email config. Firing always inserts a `jobs` row.
 *
 * Two workers racing a due cron share the same SKIP LOCKED shape as job claim: one row,
 * one enqueue, never a second runner. The actor is the person stored on the row — there
 * is no cookie Request on a clock tick or an inbound POST.
 */
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { AuditStore } from "../audit";
import { recordAuditEvent } from "../audit";
import type { ChannelStore } from "../channels/routes";
import type { Database } from "../db/client";
import { jobTriggers } from "../db/schema/jobs";
import { orgIdOf } from "../orgs/constants";
import { enqueueUnattendedJob } from "./enqueue";
import type { JobStore } from "./store";

export const JOB_TRIGGER_KINDS = ["cron", "webhook", "email"] as const;
export type JobTriggerKind = (typeof JOB_TRIGGER_KINDS)[number];

/** Recognisable on sight, so a leaked one can be found in a log or by a secret scanner. */
export const TRIGGER_SECRET_PREFIX = "obot_trg_";
const SECRET_BYTES = 32;

export function mintTriggerSecret(): string {
  return `${TRIGGER_SECRET_PREFIX}${randomBytes(SECRET_BYTES).toString("base64url")}`;
}

export function hashTriggerSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function sameTriggerSecret(given: string, storedHash: string): boolean {
  const hashed = hashTriggerSecret(given);
  const left = Buffer.from(hashed, "hex");
  const right = Buffer.from(storedHash, "hex");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function hmacTriggerBody(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function sameTriggerSignature(
  secret: string,
  rawBody: string,
  header: string,
): boolean {
  const given = header.trim();
  const hex = given.toLowerCase().startsWith("sha256=")
    ? given.slice("sha256=".length)
    : given;
  const expected = hmacTriggerBody(secret, rawBody);
  const left = Buffer.from(hex, "hex");
  const right = Buffer.from(expected, "hex");
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function normalizeMailbox(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Claim the next due cron row. Exported so a test can assert the lock shape without Postgres.
 *
 * Advancing `next_run_at` in the same statement is the serialisation: two workers cannot both
 * believe the same schedule is due. Catch-up is one fire, then now + every_seconds — a missed
 * window does not enqueue a pile of the same standing prompt.
 */
export const CLAIM_DUE_CRON_SQL = `
UPDATE job_triggers
SET next_run_at = now() + (every_seconds * interval '1 second'),
    updated_at = now()
WHERE id = (
  SELECT id FROM job_triggers
  WHERE kind = 'cron'
    AND enabled = true
    AND every_seconds IS NOT NULL
    AND every_seconds > 0
    AND next_run_at IS NOT NULL
    AND next_run_at <= now()
  ORDER BY next_run_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING id
`;

export type JobTrigger = {
  id: string;
  orgId: string;
  kind: JobTriggerKind;
  channelId: string;
  goalId: string;
  threadId: string;
  coworkerId: string;
  actingUserId: string;
  prompt: string;
  enabled: boolean;
  everySeconds: number | null;
  nextRunAt: Date | null;
  secretHash: string | null;
  mailbox: string | null;
  lastEnqueuedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PublicJobTrigger = Omit<
  JobTrigger,
  "secretHash" | "nextRunAt" | "lastEnqueuedAt" | "createdAt" | "updatedAt"
> & {
  hasSecret: boolean;
  nextRunAt: string | null;
  lastEnqueuedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateJobTriggerInput = {
  orgId: string;
  kind: JobTriggerKind;
  channelId: string;
  goalId: string;
  threadId: string;
  coworkerId: string;
  actingUserId: string;
  prompt: string;
  everySeconds?: number;
  nextRunAt?: Date;
  mailbox?: string;
  enabled?: boolean;
};

export type JobTriggerStore = {
  create: (
    input: CreateJobTriggerInput,
  ) => Promise<{ trigger: JobTrigger; secret?: string }>;
  get: (orgId: string, id: string) => Promise<JobTrigger | null>;
  getById: (id: string) => Promise<JobTrigger | null>;
  getByMailbox: (mailbox: string) => Promise<JobTrigger | null>;
  list: (orgId: string) => Promise<JobTrigger[]>;
  remove: (orgId: string, id: string) => Promise<boolean>;
  claimDueCron: () => Promise<JobTrigger | null>;
  recordFire: (
    id: string,
    update: { error?: string; enqueued?: boolean },
  ) => Promise<void>;
};

export function publicJobTrigger(row: JobTrigger): PublicJobTrigger {
  return {
    id: row.id,
    orgId: row.orgId,
    kind: row.kind,
    channelId: row.channelId,
    goalId: row.goalId,
    threadId: row.threadId,
    coworkerId: row.coworkerId,
    actingUserId: row.actingUserId,
    prompt: row.prompt,
    enabled: row.enabled,
    everySeconds: row.everySeconds,
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
    mailbox: row.mailbox,
    hasSecret: Boolean(row.secretHash),
    lastEnqueuedAt: row.lastEnqueuedAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toTrigger(row: typeof jobTriggers.$inferSelect): JobTrigger {
  return {
    id: row.id,
    orgId: row.orgId,
    kind: row.kind,
    channelId: row.channelId,
    goalId: row.goalId,
    threadId: row.threadId,
    coworkerId: row.coworkerId,
    actingUserId: row.actingUserId,
    prompt: row.prompt,
    enabled: row.enabled,
    everySeconds: row.everySeconds,
    nextRunAt: row.nextRunAt,
    secretHash: row.secretHash,
    mailbox: row.mailbox,
    lastEnqueuedAt: row.lastEnqueuedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function claimedIds(result: unknown): string[] {
  if (Array.isArray(result)) {
    return result
      .map((row) =>
        row && typeof row === "object" && "id" in row
          ? String((row as { id: unknown }).id)
          : "",
      )
      .filter(Boolean);
  }
  if (result && typeof result === "object" && "rows" in result) {
    return claimedIds((result as { rows: unknown }).rows);
  }
  return [];
}

export function createJobTriggerStore(database: Database): JobTriggerStore {
  return {
    async create(input) {
      const id = `jtr_${crypto.randomUUID()}`;
      const kind = input.kind;
      const secret =
        kind === "webhook" || kind === "email"
          ? mintTriggerSecret()
          : undefined;
      const mailbox =
        kind === "email" && input.mailbox
          ? normalizeMailbox(input.mailbox)
          : null;
      const everySeconds =
        kind === "cron" && input.everySeconds && input.everySeconds > 0
          ? input.everySeconds
          : null;
      const nextRunAt =
        kind === "cron"
          ? (input.nextRunAt ??
            new Date(Date.now() + (everySeconds ?? 0) * 1000))
          : null;
      const [row] = await database
        .insert(jobTriggers)
        .values({
          id,
          orgId: orgIdOf({ orgId: input.orgId }),
          kind,
          channelId: input.channelId,
          goalId: input.goalId,
          threadId: input.threadId,
          coworkerId: input.coworkerId,
          actingUserId: input.actingUserId,
          prompt: input.prompt,
          enabled: input.enabled ?? true,
          everySeconds,
          nextRunAt,
          secretHash: secret ? hashTriggerSecret(secret) : null,
          mailbox,
        })
        .returning();
      if (!row) {
        throw new Error("The standing trigger could not be saved.");
      }
      return {
        trigger: toTrigger(row),
        ...(secret ? { secret } : {}),
      };
    },

    async get(orgId, id) {
      const [row] = await database
        .select()
        .from(jobTriggers)
        .where(
          and(
            eq(jobTriggers.id, id),
            eq(jobTriggers.orgId, orgIdOf({ orgId })),
          ),
        );
      return row ? toTrigger(row) : null;
    },

    async getById(id) {
      const [row] = await database
        .select()
        .from(jobTriggers)
        .where(eq(jobTriggers.id, id));
      return row ? toTrigger(row) : null;
    },

    async getByMailbox(mailbox) {
      const normalized = normalizeMailbox(mailbox);
      if (!normalized) return null;
      const [row] = await database
        .select()
        .from(jobTriggers)
        .where(
          and(
            eq(jobTriggers.kind, "email"),
            eq(jobTriggers.mailbox, normalized),
            eq(jobTriggers.enabled, true),
          ),
        );
      return row ? toTrigger(row) : null;
    },

    async list(orgId) {
      const rows = await database
        .select()
        .from(jobTriggers)
        .where(eq(jobTriggers.orgId, orgIdOf({ orgId })))
        .orderBy(desc(jobTriggers.createdAt));
      return rows.map(toTrigger);
    },

    async remove(orgId, id) {
      const deleted = await database
        .delete(jobTriggers)
        .where(
          and(
            eq(jobTriggers.id, id),
            eq(jobTriggers.orgId, orgIdOf({ orgId })),
          ),
        )
        .returning({ id: jobTriggers.id });
      return deleted.length > 0;
    },

    async claimDueCron() {
      return database.transaction(async (tx) => {
        const result = await tx.execute(sql`
          UPDATE job_triggers
          SET next_run_at = now() + (every_seconds * interval '1 second'),
              updated_at = now()
          WHERE id = (
            SELECT id FROM job_triggers
            WHERE kind = 'cron'
              AND enabled = true
              AND every_seconds IS NOT NULL
              AND every_seconds > 0
              AND next_run_at IS NOT NULL
              AND next_run_at <= now()
            ORDER BY next_run_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )
          RETURNING id
        `);
        const id = claimedIds(result)[0];
        if (!id) return null;
        const [row] = await tx
          .select()
          .from(jobTriggers)
          .where(eq(jobTriggers.id, id));
        return row ? toTrigger(row) : null;
      });
    },

    async recordFire(id, update) {
      const now = new Date();
      await database
        .update(jobTriggers)
        .set({
          ...(update.enqueued ? { lastEnqueuedAt: now, lastError: null } : {}),
          ...(update.error
            ? { lastError: update.error }
            : update.enqueued
              ? { lastError: null }
              : {}),
          updatedAt: now,
        })
        .where(eq(jobTriggers.id, id));
    },
  };
}

export async function tickDueCrons(input: {
  triggerStore: JobTriggerStore;
  jobStore: JobStore;
  lookupChannel: ChannelStore["get"];
  auditStore?: AuditStore;
}): Promise<number> {
  let enqueued = 0;
  for (;;) {
    const due = await input.triggerStore.claimDueCron();
    if (!due) return enqueued;
    if (await input.jobStore.hasUnfinishedOnThread(due.orgId, due.threadId)) {
      continue;
    }
    const result = await enqueueUnattendedJob({
      trigger: "cron",
      orgId: due.orgId,
      channelId: due.channelId,
      goalId: due.goalId,
      coworkerId: due.coworkerId,
      actingUserId: due.actingUserId,
      actorRole: "user",
      prompt: due.prompt,
      expectedThreadId: due.threadId,
      lookupChannel: input.lookupChannel,
      jobStore: input.jobStore,
    });
    if (!result.ok) {
      await input.triggerStore.recordFire(due.id, { error: result.error });
      continue;
    }
    await input.triggerStore.recordFire(due.id, { enqueued: true });
    if (input.auditStore) {
      await recordAuditEvent(input.auditStore, {
        eventType: "job.enqueued",
        targetType: "job",
        targetId: result.job.id,
        actorUserId: due.actingUserId,
        orgId: due.orgId,
        payload: {
          channelId: due.channelId,
          coworkerId: due.coworkerId,
          threadId: result.channel.threadId,
          trigger: "cron",
          triggerId: due.id,
        },
      }).catch(() => undefined);
    }
    enqueued += 1;
  }
}
