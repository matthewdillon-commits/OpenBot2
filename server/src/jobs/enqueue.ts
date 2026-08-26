/**
 * The one insert path for an unattended job.
 *
 * Send-and-go, cron, webhook, inbound email, and specialist spawn all land here.
 * The worker still claims the `jobs` row with `FOR UPDATE SKIP LOCKED` and calls
 * `startUnattendedRun`. A missing mapping or Intelligence thread is a refuse —
 * this function does not mint a thread, and it does not run the coworker itself.
 */
import type { AgentActor } from "../agents/profile-types";
import type { OpenBotRole } from "../auth/roles";
import type { AgentChannel, ChannelStore } from "../channels/routes";
import { orgIdOf } from "../orgs/constants";
import {
  assertSpend,
  SpendCapError,
  type SpendKind,
  type SpendStore,
} from "../orgs/spend";
import type { JobStore, UnattendedJob } from "./store";

export const JOB_TRIGGERS = ["manual", "cron", "webhook", "email"] as const;
export type JobTrigger = (typeof JOB_TRIGGERS)[number];

export const ENQUEUE_REFUSALS = {
  CHANNEL_REQUIRED: "A channel is required.",
  MESSAGE_REQUIRED: "A message is required.",
  NO_CHANNEL: "There is no such channel.",
  MISSING_THREAD:
    "This channel has no Intelligence thread. Unattended runs attach to the existing mapping and do not mint one.",
  CHANNEL_INACTIVE: "This channel can no longer start a run.",
  GOAL_MISMATCH:
    "A goal maps to the existing channel and its Intelligence thread. This goal is not that channel.",
  COWORKER_NOT_IN_CHANNEL: "That coworker is not in this channel.",
  THREAD_MISMATCH:
    "The job named a different Intelligence thread than the one mapped to this channel.",
} as const;

export type EnqueueUnattendedInput = {
  trigger: JobTrigger;
  orgId: string;
  channelId: string;
  goalId?: string;
  coworkerId?: string;
  actingUserId: string;
  actorRole: OpenBotRole;
  prompt: string;
  skillInstructions?: string[];
  /**
   * Standing configs store the mapped thread. A live mapping that does not match is a
   * refuse — the trigger does not mint or retarget a thread.
   */
  expectedThreadId?: string;
  /**
   * When false, the worker withholds computer_* even if this deployment has a
   * computer. Omit or true to hand the specialist the org computer.
   */
  withComputer?: boolean;
  lookupChannel: ChannelStore["get"];
  jobStore: Pick<JobStore, "enqueue">;
  /**
   * Spend cap. Crossing it refuses this enqueue. Absent in tests that are not
   * about billing; production always passes the Postgres ledger.
   */
  spend?: SpendStore;
};

export type EnqueueUnattendedResult =
  | { ok: true; job: UnattendedJob; channel: AgentChannel }
  | { ok: false; error: string; status: 400 | 404 | 409 | 402 };

function actorForLookup(input: EnqueueUnattendedInput): AgentActor {
  return {
    id: input.actingUserId,
    role: input.actorRole,
    orgId: orgIdOf({ orgId: input.orgId }),
  };
}

export async function enqueueUnattendedJob(
  input: EnqueueUnattendedInput,
): Promise<EnqueueUnattendedResult> {
  const orgId = orgIdOf({ orgId: input.orgId });
  const channelId = input.channelId.trim();
  const prompt = input.prompt.trim();
  if (!channelId) {
    return { ok: false, error: ENQUEUE_REFUSALS.CHANNEL_REQUIRED, status: 400 };
  }
  if (!prompt) {
    return { ok: false, error: ENQUEUE_REFUSALS.MESSAGE_REQUIRED, status: 400 };
  }

  const requestedGoal = input.goalId?.trim() || channelId;
  const channel = await input.lookupChannel(
    actorForLookup({ ...input, orgId }),
    channelId,
  );
  if (!channel) {
    return { ok: false, error: ENQUEUE_REFUSALS.NO_CHANNEL, status: 404 };
  }
  if (!channel.threadId) {
    return { ok: false, error: ENQUEUE_REFUSALS.MISSING_THREAD, status: 409 };
  }
  if (!channel.active) {
    return { ok: false, error: ENQUEUE_REFUSALS.CHANNEL_INACTIVE, status: 409 };
  }
  if (requestedGoal !== channel.id) {
    return { ok: false, error: ENQUEUE_REFUSALS.GOAL_MISMATCH, status: 409 };
  }
  if (input.expectedThreadId && input.expectedThreadId !== channel.threadId) {
    return { ok: false, error: ENQUEUE_REFUSALS.THREAD_MISMATCH, status: 409 };
  }

  const requested = input.coworkerId?.trim() || "";
  const coworkerId = requested || channel.agentIds[0] || "";
  if (!coworkerId || !channel.agentIds.includes(coworkerId)) {
    return {
      ok: false,
      error: ENQUEUE_REFUSALS.COWORKER_NOT_IN_CHANNEL,
      status: 400,
    };
  }

  try {
    await assertSpend(input.spend, orgId, "unattended" satisfies SpendKind);
  } catch (error) {
    if (error instanceof SpendCapError) {
      return { ok: false, error: error.message, status: 402 };
    }
    throw error;
  }

  const job = await input.jobStore.enqueue({
    orgId,
    channelId: channel.id,
    goalId: channel.id,
    coworkerId,
    actingUserId: input.actingUserId,
    threadId: channel.threadId,
    prompt,
    ...(input.skillInstructions && input.skillInstructions.length > 0
      ? { skillInstructions: input.skillInstructions }
      : {}),
    ...(input.withComputer === false ? { withComputer: false } : {}),
    trigger: input.trigger,
  });

  return { ok: true, job, channel };
}
