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
import { REFUSAL_MARKER } from "../plugins/refusal";
import type { GrantedTool } from "../plugins/tools";
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
import { extractCrmRecordIds } from "./outcome";
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
  toolSuccessCount: number;
  crmRecordIds: string[];
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

const THREAD_MISSING =
  "This channel’s Intelligence thread is gone. Unattended runs attach to the existing mapping and do not mint a thread.";

const PERSIST_FAILED =
  "The mapped Intelligence thread could not be updated. The job is not treated as finished.";

function newMessageId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function emptyResult(
  outcome: UnattendedRunOutcome,
  error?: string,
): UnattendedRunResult {
  return {
    outcome,
    ...(error ? { error } : {}),
    messages: [],
    toolSuccessCount: 0,
    crmRecordIds: [],
  };
}

function observeServerTools(tools: GrantedTool[]): {
  tools: GrantedTool[];
  snapshot: () => { toolSuccessCount: number; texts: string[] };
} {
  const texts: string[] = [];
  let toolSuccessCount = 0;
  return {
    tools: tools.map((tool) => ({
      ...tool,
      execute: async (args) => {
        const result = await tool.execute(args);
        const text = typeof result === "string" ? result : "";
        if (text) texts.push(text);
        if (text && !text.includes(REFUSAL_MARKER)) {
          toolSuccessCount += 1;
        }
        return result;
      },
    })),
    snapshot: () => ({ toolSuccessCount, texts }),
  };
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
    return emptyResult("refused", MISSING_MAPPING);
  }
  if (mapping.threadId !== input.threadId) {
    return emptyResult("refused", THREAD_MISMATCH);
  }

  const wait =
    input.deps.waitForThread ??
    (input.deps.threadIdle
      ? (args: { threadId: string; userId: string }) =>
          waitForThreadIdle(input.deps.threadIdle as ThreadIdleChecker, args, {
            timeoutMs: input.deps.threadWaitMs ?? 15_000,
            pollMs: 500,
          })
      : undefined);
  if (!wait) {
    return emptyResult("refused", THREAD_MISSING);
  }
  let threadState: ThreadRunState;
  try {
    threadState = await wait({
      threadId: mapping.threadId,
      userId: intelligenceUser.id,
    });
  } catch (error) {
    return emptyResult(
      "failed",
      error instanceof Error
        ? error.message
        : "The Intelligence thread could not be checked.",
    );
  }
  if (threadState === "busy") {
    return emptyResult("refused", THREAD_BUSY);
  }
  if (threadState === "missing") {
    return emptyResult("refused", THREAD_MISSING);
  }

  const registered = await input.deps.loadAgents(actor);
  const coworker = registered.find((agent) => agent.id === input.coworkerId);
  if (!coworker) {
    return emptyResult(
      "refused",
      "That coworker is not available to the acting user.",
    );
  }

  const rawTools = await input.deps.loadTools(actor.id, orgId)(coworker.id);
  const gated = await gateUserOAuthTools(
    serverSideToolsOnly(rawTools),
    { id: actor.id, orgId },
    input.deps.userOAuth,
  );
  const observed = observeServerTools(gated);
  const loadTools: LoadToolsForBot = async (botId) =>
    botId === coworker.id ? observed.tools : [];

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
    return emptyResult(
      "failed",
      "The coworker could not be built for this run.",
    );
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
    const observedTools = observed.snapshot();
    const crmRecordIds = extractCrmRecordIds(
      text,
      ...transcript.map((message) => message.content),
      ...observedTools.texts,
    );
    let persisted = false;
    try {
      persisted = input.deps.persistThread
        ? await input.deps.persistThread({
            threadId: mapping.threadId,
            userId: intelligenceUser.id,
            messages: transcript.filter((message) => message.role !== "system"),
            agentId: input.coworkerId,
          })
        : false;
    } catch {
      persisted = false;
    }
    if (!persisted) {
      try {
        await input.deps.recordActivity({
          actor,
          channelId: input.channelId,
          activity: {
            text: PERSIST_FAILED,
            agentId: input.coworkerId,
            at: new Date(),
          },
        });
      } catch {
        // Roster update is best-effort; the job row still records the failure.
      }
      return {
        outcome: "failed",
        error: PERSIST_FAILED,
        text,
        persisted: false,
        messages: transcript,
        toolSuccessCount: observedTools.toolSuccessCount,
        crmRecordIds,
      };
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
    return {
      outcome: "succeeded",
      text,
      persisted: true,
      messages: transcript,
      toolSuccessCount: observedTools.toolSuccessCount,
      crmRecordIds,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The unattended run failed.";
    const observedTools = observed.snapshot();
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
    return {
      outcome: "failed",
      error: message,
      messages: runMessages,
      toolSuccessCount: observedTools.toolSuccessCount,
      crmRecordIds: extractCrmRecordIds(...observedTools.texts),
    };
  }
}

export const UNATTENDED_REFUSALS = {
  MISSING_MAPPING,
  THREAD_BUSY,
  THREAD_MISMATCH,
  THREAD_MISSING,
  PERSIST_FAILED,
} as const;
