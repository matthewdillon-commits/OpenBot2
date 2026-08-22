import { and, eq } from "drizzle-orm";
import type { AgentActor } from "../agents/profile-types";
import type { Database } from "../db/client";
import { subagentRuns } from "../db/schema";

export type SubagentStatus =
  | "queued"
  | "running"
  | "completed"
  | "blocked"
  | "failed";

export type SubagentRun = {
  id: string;
  parentAgentId: string;
  actorUserId: string;
  channelId: string;
  goal: string;
  successCriteria: string;
  reportBack: string;
  followUp: string | null;
  followUpAt: Date | null;
  status: SubagentStatus;
  result: string | null;
  hop: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

export type SubagentStore = {
  create(input: {
    parentAgentId: string;
    actor: AgentActor;
    channelId: string;
    goal: string;
    successCriteria: string;
    reportBack: string;
  }): Promise<SubagentRun>;
  get(actor: AgentActor, id: string): Promise<SubagentRun | null>;
  getForParent(
    actor: AgentActor,
    parentAgentId: string,
    id: string,
  ): Promise<SubagentRun | null>;
  markRunning(id: string): Promise<void>;
  setFollowUp(
    id: string,
    text: string,
    hop: number,
    status: SubagentStatus,
  ): Promise<SubagentRun>;
  complete(
    id: string,
    status: "completed" | "blocked" | "failed",
    result: string,
  ): Promise<SubagentRun>;
};

export function createSubagentStore(database: Database): SubagentStore {
  return {
    async create(input) {
      const id = `subagent_${crypto.randomUUID()}`;
      const [row] = await database
        .insert(subagentRuns)
        .values({
          id,
          parentAgentId: input.parentAgentId,
          actorUserId: input.actor.id,
          channelId: input.channelId,
          goal: input.goal,
          successCriteria: input.successCriteria,
          reportBack: input.reportBack,
          status: "queued",
          hop: 1,
        })
        .returning();
      if (!row) throw new Error("The sub-agent could not be started.");
      return asRun(row);
    },

    async get(actor, id) {
      const [row] = await database
        .select()
        .from(subagentRuns)
        .where(
          and(eq(subagentRuns.id, id), eq(subagentRuns.actorUserId, actor.id)),
        );
      return row ? asRun(row) : null;
    },

    async getForParent(actor, parentAgentId, id) {
      const [row] = await database
        .select()
        .from(subagentRuns)
        .where(
          and(
            eq(subagentRuns.id, id),
            eq(subagentRuns.parentAgentId, parentAgentId),
            eq(subagentRuns.actorUserId, actor.id),
          ),
        );
      return row ? asRun(row) : null;
    },

    async markRunning(id) {
      await database
        .update(subagentRuns)
        .set({ status: "running", updatedAt: new Date() })
        .where(eq(subagentRuns.id, id));
    },

    async setFollowUp(id, text, hop, status) {
      const [row] = await database
        .update(subagentRuns)
        .set({
          followUp: text,
          followUpAt: new Date(),
          hop,
          status,
          updatedAt: new Date(),
        })
        .where(eq(subagentRuns.id, id))
        .returning();
      if (!row) throw new Error("That sub-agent could not be updated.");
      return asRun(row);
    },

    async complete(id, status, result) {
      const [row] = await database
        .update(subagentRuns)
        .set({
          status,
          result,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(subagentRuns.id, id))
        .returning();
      if (!row) throw new Error("That sub-agent could not be completed.");
      return asRun(row);
    },
  };
}

function asRun(row: typeof subagentRuns.$inferSelect): SubagentRun {
  return {
    id: row.id,
    parentAgentId: row.parentAgentId,
    actorUserId: row.actorUserId,
    channelId: row.channelId,
    goal: row.goal,
    successCriteria: row.successCriteria,
    reportBack: row.reportBack,
    followUp: row.followUp,
    followUpAt: row.followUpAt,
    status: row.status,
    result: row.result,
    hop: row.hop,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}
