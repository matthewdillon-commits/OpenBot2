/**
 * The persist write for an unattended turn is the same CopilotRuntime Intelligence
 * runner an open-tab turn uses.
 *
 * Tab turns hit `handleRunAgent` → `handleIntelligenceRun` → `runtime.runner.run`.
 * That runner (`IntelligenceAgentRunner`) calls `agent.runAgent` and pushes AG-UI
 * events onto the existing thread. This file is that last step, without a browser
 * Request and without minting a thread: `createThread` / `getOrCreateThread` are
 * never called here. The mapped `threadId` must already exist; a missing thread
 * is refused before we get here.
 *
 * `getThread` is a read. Persist is true only after the run, when Intelligence
 * on that same thread shows the user prompt and the assistant result.
 */
import type { AbstractAgent, RunAgentInput } from "@ag-ui/client";
import type { UnattendedMessage } from "./thread";

export type UnattendedRuntimeRunner = {
  run: (request: {
    threadId: string;
    agent: AbstractAgent;
    input: RunAgentInput;
  }) => {
    subscribe: (observer: {
      next?: (value: unknown) => void;
      error?: (error: unknown) => void;
      complete?: () => void;
    }) => unknown;
  };
};

export type UnattendedCopilotRuntime = {
  runner: UnattendedRuntimeRunner;
};

function assistantText(messages: UnattendedMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.content.trim()) {
      return message.content;
    }
  }
  const last = messages[messages.length - 1];
  return last?.role === "assistant" ? last.content : "";
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
              : `${message.role}_${crypto.randomUUID()}`,
          role: message.role,
          content: message.content,
        },
      ];
    }
    return [];
  });
}

function waitForRunner(
  runner: UnattendedRuntimeRunner,
  request: Parameters<UnattendedRuntimeRunner["run"]>[0],
): Promise<void> {
  return new Promise((resolve, reject) => {
    runner.run(request).subscribe({
      error: reject,
      complete: resolve,
    });
  });
}

/**
 * Start the coworker through `CopilotRuntime.runner.run` on the existing thread.
 */
export async function runUnattendedThroughRuntime(input: {
  runtime: UnattendedCopilotRuntime;
  agent: AbstractAgent;
  threadId: string;
  messages: UnattendedMessage[];
}): Promise<{ text: string; messages: UnattendedMessage[] }> {
  const runId = `run_${crypto.randomUUID()}`;
  const agent = input.agent as AbstractAgent & {
    setMessages?: (messages: unknown[]) => void;
    threadId?: string;
    runAgent?: (
      runInput?: unknown,
      handlers?: { onEvent?: (event: unknown) => void },
    ) => Promise<unknown>;
  };
  agent.setMessages?.(input.messages);
  agent.threadId = input.threadId;
  await waitForRunner(input.runtime.runner, {
    threadId: input.threadId,
    agent: input.agent,
    input: {
      threadId: input.threadId,
      runId,
      messages: input.messages,
      tools: [],
      context: [],
    },
  });
  const messages = messagesFromAgent(input.agent);
  const transcript = messages.length ? messages : input.messages;
  return {
    text: assistantText(transcript),
    messages: transcript,
  };
}
