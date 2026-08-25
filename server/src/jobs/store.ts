/**
 * The durable queue for unattended coworker runs.
 *
 * Enqueue is an insert. Claim is a single `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)`.
 * Two workers that race that statement get one row and one null — never the same job, and never
 * a second run on a thread that already has a `running` row (the partial unique index plus the
 * `NOT EXISTS` predicate).
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { jobs } from "../db/schema/jobs";
import { orgIdOf } from "../orgs/constants";
import { asJobOutcome, buildJobOutcome, type JobOutcome } from "./outcome";

export const JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export type JobPayload = {
  prompt: string;
  skillInstructions?: string[];
  agentId?: string;
  result?: {
    text?: string;
    persisted?: boolean;
  };
};

export type { JobOutcome } from "./outcome";

export type UnattendedJob = {
  id: string;
  orgId: string;
  channelId: string;
  goalId: string;
  coworkerId: string;
  actingUserId: string;
  trigger: string;
  payload: JobPayload;
  status: JobStatus;
  threadId: string;
  needsYou: boolean;
  error: string | null;
  outcome: JobOutcome | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type EnqueueJobInput = {
  orgId: string;
  channelId: string;
  goalId?: string;
  coworkerId: string;
  actingUserId: string;
  threadId: string;
  prompt: string;
  skillInstructions?: string[];
  trigger?: string;
};

/**
 * The claim statement, exported so a test can assert the lock shape without opening Postgres.
 *
 * `FOR UPDATE SKIP LOCKED` is the whole concurrency story: a locked row is invisible to the
 * other worker, so two claimers cannot both believe they own the same job.
 */
export const CLAIM_QUEUED_JOB_SQL = `
UPDATE jobs
SET status = 'running',
    started_at = COALESCE(started_at, now()),
    updated_at = now()
WHERE id = (
  SELECT id FROM jobs
  WHERE status = 'queued'
    AND NOT EXISTS (
      SELECT 1 FROM jobs AS running
      WHERE running.thread_id = jobs.thread_id
        AND running.status = 'running'
    )
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING id
`;

export type JobStore = {
  enqueue: (input: EnqueueJobInput) => Promise<UnattendedJob>;
  claim: () => Promise<UnattendedJob | null>;
  finish: (
    id: string,
    status: "succeeded" | "failed" | "cancelled",
    update?: {
      error?: string;
      payload?: JobPayload;
      crmRecordIds?: string[];
      toolSuccessCount?: number;
    },
  ) => Promise<UnattendedJob | null>;
  get: (orgId: string, id: string) => Promise<UnattendedJob | null>;
  listForChannel: (
    orgId: string,
    channelId: string,
    limit?: number,
  ) => Promise<UnattendedJob[]>;
};

function collectPayloadTexts(payload: JobPayload): string[] {
  return payload.result?.text ? [payload.result.text] : [];
}

function skinnyResult(value: unknown): JobPayload["result"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text : undefined;
  const persisted =
    typeof record.persisted === "boolean" ? record.persisted : undefined;
  if (text === undefined && persisted === undefined) return undefined;
  return {
    ...(text !== undefined ? { text } : {}),
    ...(persisted !== undefined ? { persisted } : {}),
  };
}

/**
 * Read a stored payload without keeping a `messages[]` chat store. Intelligence is the
 * transcript. The job may keep the prompt and a skinny `result.text` / `persisted` flag.
 */
export function asJobPayload(
  value: Record<string, unknown> | JobPayload,
): JobPayload {
  const prompt =
    typeof value.prompt === "string"
      ? value.prompt
      : String(value.prompt ?? "");
  const skillInstructions = Array.isArray(value.skillInstructions)
    ? value.skillInstructions.filter(
        (item): item is string => typeof item === "string",
      )
    : undefined;
  const agentId = typeof value.agentId === "string" ? value.agentId : undefined;
  const result = skinnyResult(
    "result" in value ? (value as { result?: unknown }).result : undefined,
  );
  return {
    prompt,
    ...(skillInstructions && skillInstructions.length > 0
      ? { skillInstructions }
      : {}),
    ...(agentId ? { agentId } : {}),
    ...(result ? { result } : {}),
  };
}

function toJob(row: typeof jobs.$inferSelect): UnattendedJob {
  return {
    id: row.id,
    orgId: row.orgId,
    channelId: row.channelId,
    goalId: row.goalId,
    coworkerId: row.coworkerId,
    actingUserId: row.actingUserId,
    trigger: row.trigger,
    payload: asJobPayload(row.payload),
    status: row.status,
    threadId: row.threadId,
    needsYou: row.needsYou,
    error: row.error,
    outcome: asJobOutcome(row.outcome),
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
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

export function createJobStore(database: Database): JobStore {
  return {
    async enqueue(input) {
      const id = `job_${crypto.randomUUID()}`;
      const goalId = input.goalId?.trim() || input.channelId;
      const payload: JobPayload = {
        prompt: input.prompt,
        ...(input.skillInstructions && input.skillInstructions.length > 0
          ? { skillInstructions: input.skillInstructions }
          : {}),
        agentId: input.coworkerId,
      };
      const outcome = buildJobOutcome({
        status: "queued",
        at: new Date(),
        goalId,
        channelId: input.channelId,
        agentId: input.coworkerId,
        orgId: orgIdOf({ orgId: input.orgId }),
        actingUserId: input.actingUserId,
        assistantText: input.prompt,
      });
      const [row] = await database
        .insert(jobs)
        .values({
          id,
          orgId: orgIdOf({ orgId: input.orgId }),
          channelId: input.channelId,
          goalId,
          coworkerId: input.coworkerId,
          actingUserId: input.actingUserId,
          trigger: input.trigger ?? "manual",
          payload,
          status: "queued",
          threadId: input.threadId,
          outcome,
        })
        .returning();
      if (!row) {
        throw new Error("The job could not be queued.");
      }
      return toJob(row);
    },

    async claim() {
      return database.transaction(async (tx) => {
        const result = await tx.execute(sql`
          UPDATE jobs
          SET status = 'running',
              started_at = COALESCE(started_at, now()),
              updated_at = now()
          WHERE id = (
            SELECT id FROM jobs
            WHERE status = 'queued'
              AND NOT EXISTS (
                SELECT 1 FROM jobs AS running
                WHERE running.thread_id = jobs.thread_id
                  AND running.status = 'running'
              )
            ORDER BY created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )
          RETURNING id
        `);
        const id = claimedIds(result)[0];
        if (!id) return null;
        const [row] = await tx.select().from(jobs).where(eq(jobs.id, id));
        return row ? toJob(row) : null;
      });
    },

    async finish(id, status, update = {}) {
      const [existing] = await database
        .select()
        .from(jobs)
        .where(eq(jobs.id, id));
      if (!existing) return null;
      const payload = update.payload
        ? asJobPayload({ ...asJobPayload(existing.payload), ...update.payload })
        : asJobPayload(existing.payload);
      const finishedAt = new Date();
      const sourceTexts = collectPayloadTexts(payload);
      const outcome = buildJobOutcome({
        status,
        at: finishedAt,
        goalId: existing.goalId,
        channelId: existing.channelId,
        agentId: existing.coworkerId,
        orgId: existing.orgId,
        actingUserId: existing.actingUserId,
        needsYou: existing.needsYou,
        assistantText: payload.result?.text,
        error: update.error ?? existing.error,
        toolSuccessCount: update.toolSuccessCount,
        crmRecordIds: update.crmRecordIds,
        sourceTexts,
      });
      const [row] = await database
        .update(jobs)
        .set({
          status,
          error: update.error ?? null,
          payload,
          outcome,
          finishedAt,
          updatedAt: finishedAt,
        })
        .where(eq(jobs.id, id))
        .returning();
      return row ? toJob(row) : null;
    },

    async get(orgId, id) {
      const [row] = await database
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, id), eq(jobs.orgId, orgIdOf({ orgId }))));
      return row ? toJob(row) : null;
    },

    async listForChannel(orgId, channelId, limit = 20) {
      const rows = await database
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.orgId, orgIdOf({ orgId })),
            eq(jobs.channelId, channelId),
          ),
        )
        .orderBy(desc(jobs.createdAt))
        .limit(Math.min(Math.max(limit, 1), 50));
      return rows.map(toJob);
    },
  };
}
