/**
 * Start a finite specialist on this goal: add them to the room, enqueue the same
 * unattended job the Phase 1–3 runner already claims. No second wake path.
 *
 * Shared CRM is the rule: the job is org-scoped, and loadToolsForActor offers the
 * same org CRM the parent has. A missing Intelligence thread is a refuse.
 */
import type { AgentActor, AgentProfile } from "../agents/profile-types";
import type { OpenBotRole } from "../auth/roles";
import type { ChannelStore } from "../channels/routes";
import { agentIsOrchestrator } from "../orchestrator";
import { orgIdOf } from "../orgs/constants";
import type { SpendStore } from "../orgs/spend";
import { type EnqueueUnattendedResult, enqueueUnattendedJob } from "./enqueue";
import type { JobStore } from "./store";

export const SPECIALIST_REFUSALS = {
  NO_THREAD:
    "This goal has no Intelligence thread. Specialists attach to the existing mapping and do not mint one.",
  NO_CHANNEL: "A specialist can only start on a goal.",
  TASK_REQUIRED: "A specialist needs a finite chunk of work.",
  NO_SPECIALIST:
    "Name a specialist in this organization, or a skill to follow.",
  UNKNOWN_SPECIALIST: "That specialist is not available in this organization.",
  UNKNOWN_SKILL: "There is no such skill in this organization.",
  SELF: "The orchestrator cannot spawn itself as a specialist.",
  ROOM_FULL: "A goal room can have at most 8 coworkers.",
} as const;

export type SkillLookup = {
  slug: string;
  title: string;
  instructions: string;
};

export type StartSpecialistInput = {
  actor: AgentActor;
  orgId: string;
  channelId: string;
  threadId: string;
  parentCoworkerId: string;
  task: string;
  specialistId?: string;
  skillSlug?: string;
  withComputer?: boolean;
};

export type StartSpecialistDeps = {
  lookupChannel: ChannelStore["get"];
  addAgents: ChannelStore["addAgents"];
  getAgent: (actor: AgentActor, id: string) => Promise<AgentProfile | null>;
  listAgents: (actor: AgentActor) => Promise<AgentProfile[]>;
  skillBySlug: (slug: string, orgId: string) => Promise<SkillLookup | null>;
  jobStore: Pick<JobStore, "enqueue">;
  enqueue?: (
    input: Parameters<typeof enqueueUnattendedJob>[0],
  ) => Promise<EnqueueUnattendedResult>;
  spend?: SpendStore;
};

export type StartSpecialistOk = {
  ok: true;
  coworkerId: string;
  jobId: string;
  orgId: string;
  channelId: string;
  threadId: string;
  skillInstructions: string[];
};

export type StartSpecialistResult =
  | StartSpecialistOk
  | { ok: false; error: string; status: 400 | 404 | 409 | 402 };

export function specialistGetsComputer(withComputer?: boolean): boolean {
  return withComputer !== false;
}

/**
 * The CRM book a specialist reads is the organization’s, never a private copy.
 */
export function specialistCrmOrgId(orgId: string): string {
  return orgIdOf({ orgId });
}

function actorRole(actor: AgentActor): OpenBotRole {
  return actor.role === "admin" ? "admin" : "user";
}

async function resolveSpecialist(
  input: StartSpecialistInput,
  deps: StartSpecialistDeps,
  orgId: string,
): Promise<
  | { ok: true; agent: AgentProfile }
  | { ok: false; error: string; status: 400 | 404 }
> {
  const requested = input.specialistId?.trim() ?? "";
  if (requested) {
    const agent = await deps.getAgent(input.actor, requested);
    if (!agent) {
      return {
        ok: false,
        error: SPECIALIST_REFUSALS.UNKNOWN_SPECIALIST,
        status: 404,
      };
    }
    if (
      agentIsOrchestrator(agent, orgId) ||
      agent.id === input.parentCoworkerId
    ) {
      return { ok: false, error: SPECIALIST_REFUSALS.SELF, status: 400 };
    }
    return { ok: true, agent };
  }

  const listed = await deps.listAgents(input.actor);
  const specialist = listed.find(
    (agent) =>
      !agentIsOrchestrator(agent, orgId) &&
      agent.id !== input.parentCoworkerId &&
      agent.deletedAt == null,
  );
  if (!specialist) {
    return {
      ok: false,
      error: SPECIALIST_REFUSALS.NO_SPECIALIST,
      status: 400,
    };
  }
  return { ok: true, agent: specialist };
}

export async function startSpecialist(
  input: StartSpecialistInput,
  deps: StartSpecialistDeps,
): Promise<StartSpecialistResult> {
  const orgId = specialistCrmOrgId(input.orgId);
  const channelId = input.channelId.trim();
  const threadId = input.threadId.trim();
  const task = input.task.trim();
  if (!channelId) {
    return { ok: false, error: SPECIALIST_REFUSALS.NO_CHANNEL, status: 400 };
  }
  if (!threadId) {
    return { ok: false, error: SPECIALIST_REFUSALS.NO_THREAD, status: 409 };
  }
  if (!task) {
    return { ok: false, error: SPECIALIST_REFUSALS.TASK_REQUIRED, status: 400 };
  }
  if (!input.specialistId?.trim() && !input.skillSlug?.trim()) {
    return { ok: false, error: SPECIALIST_REFUSALS.NO_SPECIALIST, status: 400 };
  }

  const channel = await deps.lookupChannel(input.actor, channelId);
  if (!channel) {
    return { ok: false, error: SPECIALIST_REFUSALS.NO_CHANNEL, status: 404 };
  }
  if (!channel.threadId) {
    return { ok: false, error: SPECIALIST_REFUSALS.NO_THREAD, status: 409 };
  }
  if (channel.threadId !== threadId) {
    return { ok: false, error: SPECIALIST_REFUSALS.NO_THREAD, status: 409 };
  }

  let skillInstructions: string[] = [];
  const skillSlug = input.skillSlug?.trim() ?? "";
  if (skillSlug) {
    const skill = await deps.skillBySlug(skillSlug, orgId);
    if (!skill) {
      return {
        ok: false,
        error: SPECIALIST_REFUSALS.UNKNOWN_SKILL,
        status: 404,
      };
    }
    skillInstructions = [
      `Follow the skill “${skill.title}” (${skill.slug}):\n${skill.instructions}`,
    ];
  }

  const resolved = await resolveSpecialist(input, deps, orgId);
  if (!resolved.ok) return resolved;
  const specialist = resolved.agent;

  let room = channel;
  if (!room.agentIds.includes(specialist.id)) {
    try {
      room = await deps.addAgents(input.actor, channel.id, [specialist.id]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("at most 8")) {
        return { ok: false, error: SPECIALIST_REFUSALS.ROOM_FULL, status: 409 };
      }
      throw error;
    }
  }

  const computerNote = specialistGetsComputer(input.withComputer)
    ? "The parent handed you this chunk including a computer when this deployment has one. Use computer_navigate, snapshot, click and type when the work needs a live website, files, or the shell. Do not ask the owner to paste pages."
    : "The parent did not hand you a computer for this chunk. Use CRM, search, and knowledge.";

  const prompt = [
    "You are a specialist on this goal. When you finish, state the result in one sentence for the orchestrator.",
    "You share this organization’s CRM — the same customer fact every agent in the org can see. Do not invent a private book.",
    computerNote,
    "",
    task,
  ].join("\n");

  const enqueue = deps.enqueue ?? enqueueUnattendedJob;
  const enqueued = await enqueue({
    trigger: "manual",
    orgId,
    channelId: room.id,
    goalId: room.id,
    coworkerId: specialist.id,
    actingUserId: input.actor.id,
    actorRole: actorRole(input.actor),
    prompt,
    ...(skillInstructions.length > 0 ? { skillInstructions } : {}),
    ...(specialistGetsComputer(input.withComputer)
      ? {}
      : { withComputer: false }),
    expectedThreadId: room.threadId,
    // Use the room we just updated. A second get can lag a stale fake, and
    // enqueue refuses a coworker who is not yet in agentIds.
    lookupChannel: async (actor, channelId) =>
      channelId === room.id ? room : deps.lookupChannel(actor, channelId),
    jobStore: deps.jobStore,
    ...(deps.spend ? { spend: deps.spend } : {}),
  });
  if (!enqueued.ok) {
    return { ok: false, error: enqueued.error, status: enqueued.status };
  }

  return {
    ok: true,
    coworkerId: specialist.id,
    jobId: enqueued.job.id,
    orgId,
    channelId: room.id,
    threadId: room.threadId,
    skillInstructions,
  };
}
