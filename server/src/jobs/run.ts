/**
 * Start an unattended coworker run on the existing mapped Intelligence thread.
 *
 * Same `buildAgents` / `loadToolsForActor` / standing role / `signRun` path as an open-tab
 * turn in copilot.ts. Computer guidance is never attached: those tools live in the tab.
 * No cookie Request — the actor is explicit.
 */
import type { AbstractAgent } from "@ag-ui/client";
import type { AgentActor } from "../agents/profile-types";
import type { ChannelActivity } from "../channels/routes";
import {
  buildAgents,
  type LoadToolsForBot,
  type RegisteredAgent,
  type RuntimeModel,
  type SignRun,
  TOOL_STEPS,
} from "../copilot";
import { orgIdOf } from "../orgs/constants";
import {
  type ActorContext,
  identifyActorFromContext,
  identifyUserFromContext,
} from "./actor";
import type {
  ThreadIdleChecker,
  ThreadLookup,
  ThreadPersister,
  ThreadRunState,
  UnattendedMessage,
} from "./thread";
import { waitForThreadIdle } from "./thread";
import {
  gateUserOAuthTools,
  serverSideToolsOnly,
  type UserOAuthLookup,
} from "./tools";

export { TOOL_STEPS };

export type UnattendedRunOutcome = "succeeded" | "failed" | "refused";

export type UnattendedRunResult = {
  outcome: UnattendedRunOutcome;
  text?: string;
  error?: string;
  persisted?: boolean;
  messages: UnattendedMessage[];
};

export type UnattendedRunDeps = {
  lookupMapping: ThreadLookup["mappingFor"];
  waitForThread?: (input: {
    threadId: string;
    userId: string;
  }) => Promise<ThreadRunState>;
  threadIdle?: ThreadIdleChecker;
  persistThread?: ThreadPersister["append"];
  recordActivity: (input: {
    actor: AgentActor;
    channelId: string;
    activity: ChannelActivity;
  }) => Promise<void>;
  loadAgents: (actor: AgentActor) => Promise<RegisteredAgent[]>;
  loadTools: (actorId: string, orgId?: string) => LoadToolsForBot;
  signRun?: (actorId: string, orgId?: string) => SignRun;
  resolveModelApiKey: () => Promise<string | null>;
  model: RuntimeModel;
  timeoutMs: number;
  threadWaitMs?: number;
  userOAuth?: UserOAuthLookup;
  /**
   * Test seam. Production builds the coworker through `buildAgents` and calls `runAgent`.
   */
  runCoworker?: (input: {
    agent: AbstractAgent;
    messages: UnattendedMessage[];
  }) => Promise<{ text: string; messages: UnattendedMessage[] }>;
  prebuiltAgents?: Record<string, AbstractAgent>;
};

const MISSING_MAPPING =
  "This channel has no Intelligence thread for the acting user. Unattended runs attach to the existing mapping and do not mint a thread.";

const THREAD_BUSY =
  "This thread already has an active run. The job was not started.";

const THREAD_MISMATCH =
  "The job named a different Intelligence thread than the one mapped to this channel.";

function newMessageId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function assistantText(messages: UnattendedMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.content.trim()) {
      return message.content;
    }
  }
  return "";
}

function messagesFromAgent(agent: AbstractAgent): UnattendedMessage[] {
  const raw = (
    agent as {
      messages?: Array<{ id?: string; role?: string; content?: unknown }>;
    }
  ).messages;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((message) => {
    if (
      (message.role === "system" ||
        message.role === "user" ||
        message.role === "assistant") &&
      typeof message.content === "string"
    ) {
      return [
        {
          id:
            typeof message.id === "string"
              ? message.id
              : newMessageId(message.role),
          role: message.role,
          content: message.content,
        },
      ];
    }
    return [];
  });
}

async function defaultRunCoworker(input: {
  agent: AbstractAgent;
  messages: UnattendedMessage[];
}): Promise<{ text: string; messages: UnattendedMessage[] }> {
  const agent = input.agent as AbstractAgent & {
    setMessages?: (messages: unknown[]) => void;
    runAgent?: () => Promise<{ newMessages?: Array<{ content?: unknown }> }>;
  };
  agent.setMessages?.(input.messages);
  await agent.runAgent?.();
  const messages = messagesFromAgent(input.agent);
  return { text: assistantText(messages), messages };
}

export async function startUnattendedRun(input: {
  actor: ActorContext;
  orgId: string;
  channelId: string;
  threadId: string;
  prompt: string;
  coworkerId: string;
  skillInstructions?: string[];
  deps: UnattendedRunDeps;
}): Promise<UnattendedRunResult> {
  const orgId = orgIdOf({ orgId: input.orgId });
  const actor = identifyActorFromContext({ ...input.actor, orgId });
  const intelligenceUser = identifyUserFromContext({
    ...input.actor,
    orgId,
  });

  const mapping = await input.deps.lookupMapping({
    userId: input.actor.id,
    channelId: input.channelId,
    orgId,
  });
  if (!mapping) {
    return { outcome: "refused", error: MISSING_MAPPING, messages: [] };
  }
  if (mapping.threadId !== input.threadId) {
    return { outcome: "refused", error: THREAD_MISMATCH, messages: [] };
  }

  const wait =
    input.deps.waitForThread ??
    (input.deps.threadIdle
      ? (args: { threadId: string; userId: string }) =>
          waitForThreadIdle(input.deps.threadIdle as ThreadIdleChecker, args, {
            timeoutMs: input.deps.threadWaitMs ?? 15_000,
            pollMs: 500,
          })
      : async () => "idle" as const);
  const threadState = await wait({
    threadId: mapping.threadId,
    userId: intelligenceUser.id,
  });
  if (threadState === "busy") {
    return { outcome: "refused", error: THREAD_BUSY, messages: [] };
  }

  const registered = await input.deps.loadAgents(actor);
  const coworker = registered.find((agent) => agent.id === input.coworkerId);
  if (!coworker) {
    return {
      outcome: "refused",
      error: "That coworker is not available to the acting user.",
      messages: [],
    };
  }

  const rawTools = await input.deps.loadTools(actor.id, orgId)(coworker.id);
  const tools = await gateUserOAuthTools(
    serverSideToolsOnly(rawTools),
    { id: actor.id, orgId },
    input.deps.userOAuth,
  );
  const loadTools: LoadToolsForBot = async (botId) =>
    botId === coworker.id ? tools : [];

  const agents =
    input.deps.prebuiltAgents ??
    (await buildAgents(
      [coworker],
      input.deps.model,
      coworker.type === "built_in"
        ? await input.deps.resolveModelApiKey()
        : null,
      undefined,
      loadTools,
      input.deps.signRun?.(actor.id, orgId),
      // Unattended runs do not mention the computer. Those tools stay in the tab.
      undefined,
    ));
  const agent = agents[coworker.id];
  if (!agent) {
    return {
      outcome: "failed",
      error: "The coworker could not be built for this run.",
      messages: [],
    };
  }

  const runMessages: UnattendedMessage[] = [
    ...(input.skillInstructions ?? []).map((instruction) => ({
      id: newMessageId("skill"),
      role: "system" as const,
      content: instruction,
    })),
    {
      id: newMessageId("user"),
      role: "user",
      content: input.prompt,
    },
  ];

  const run = input.deps.runCoworker ?? defaultRunCoworker;
  let timedOut = false;
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      timedOut = true;
      reject(
        new Error(
          `Unattended job exceeded the ${input.deps.timeoutMs}ms wall-clock limit.`,
        ),
      );
    }, input.deps.timeoutMs);
  });

  try {
    const finished = await Promise.race([
      run({ agent, messages: runMessages }),
      timeout,
    ]);
    if (timedOut) {
      throw new Error("Unattended job timed out.");
    }
    const transcript = finished.messages.length
      ? finished.messages
      : [
          ...runMessages,
          {
            id: newMessageId("assistant"),
            role: "assistant" as const,
            content: finished.text,
          },
        ];
    const text = finished.text.trim() || assistantText(transcript);
    let persisted = false;
    if (input.deps.persistThread) {
      try {
        persisted = await input.deps.persistThread({
          threadId: mapping.threadId,
          userId: intelligenceUser.id,
          messages: transcript.filter((message) => message.role !== "system"),
        });
      } catch {
        persisted = false;
      }
    }
    if (text) {
      await input.deps.recordActivity({
        actor,
        channelId: input.channelId,
        activity: {
          text,
          agentId: input.coworkerId,
          at: new Date(),
        },
      });
    }
    return { outcome: "succeeded", text, persisted, messages: transcript };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The unattended run failed.";
    try {
      await input.deps.recordActivity({
        actor,
        channelId: input.channelId,
        activity: {
          text: message,
          agentId: input.coworkerId,
          at: new Date(),
        },
      });
    } catch {
      // Roster update is best-effort; the job row still records the failure.
    }
    return { outcome: "failed", error: message, messages: runMessages };
  }
}

export const UNATTENDED_REFUSALS = {
  MISSING_MAPPING,
  THREAD_BUSY,
  THREAD_MISMATCH,
} as const;
