import {
  AGENT_COMPUTER_PATH,
  AGENT_COMPUTER_START_CMD,
} from "../../e2b/start";
import { ComputerUnavailableError } from "./client";
import type {
  E2BClient,
  E2BSandboxHandle,
  E2BSandboxRecord,
} from "./e2b-client";
import { E2BSandboxGoneError, createSdkE2BClient } from "./e2b-client";
import type { ComputerLocation, ComputerProvider } from "./provider";
import type { ComputerStatus } from "./schema";

/**
 * One E2B sandbox per org-scoped computer id.
 *
 * This is the SaaS computer plane: Railway cannot hold a Docker socket, so the
 * in-image Chromium stays shared until this provider is selected. locate()
 * resumes a paused sandbox or creates one, then returns the HTTPS URL of the
 * agent-computer process inside it. The existing gateway transport and
 * computer_* tools speak that HTTP API unchanged.
 *
 * Pause/resume is how a coworker comes back to the same machine. A running
 * sandbox still has a plan limit (one hour on Hobby, 24 hours on Pro); when
 * that expires this provider asks E2B to pause, not kill. Pause is not a TTL
 * and is not a promise the sandbox exists forever — if it has been killed the
 * owner is told the computer is not available, with no environment names.
 */

/** Keep in lockstep with `COMPUTER_UNAVAILABLE_OWNER` in computer-tools.ts. */
const UNAVAILABLE =
  "The computer is not available. Ask your operator to get it running.";

export const DEFAULT_E2B_TEMPLATE = "openbot-agent-computer";
export const DEFAULT_E2B_NAMESPACE = "openbot";
const COMPUTER_PORT = 4100;
const RUNNING_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_READY_TIMEOUT_MS = 90_000;
const KIND = "computer";

export type E2BComputerProviderOptions = {
  apiKey?: string;
  token?: string;
  template?: string;
  namespace?: string;
  client?: E2BClient;
  fetchImpl?: typeof fetch;
  readyTimeoutMs?: number;
};

function unavailable(cause?: unknown): ComputerUnavailableError {
  if (cause && !(cause instanceof ComputerUnavailableError)) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    if (
      detail.length > 0 &&
      !/E2B_API_KEY|E2B_TEMPLATE|COMPUTER_TOKEN/i.test(detail)
    ) {
      console.error(`E2B computer failed: ${detail}`);
    } else {
      console.error("E2B computer failed.");
    }
  }
  return new ComputerUnavailableError(UNAVAILABLE);
}

function asHttps(host: string): string {
  if (/^https?:\/\//i.test(host)) return host.replace(/\/$/, "");
  return `https://${host.replace(/\/$/, "")}`;
}

function metadataFor(
  computerId: string,
  namespace: string,
): Record<string, string> {
  return {
    openbot: KIND,
    computerId,
    namespace,
  };
}

function pause(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function pick(records: E2BSandboxRecord[]): E2BSandboxRecord | undefined {
  const running = records.filter((record) => record.state === "running");
  const paused = records.filter((record) => record.state === "paused");
  return running[0] ?? paused[0];
}

export function createE2BComputerProvider(
  options: E2BComputerProviderOptions,
): ComputerProvider {
  const template = options.template?.trim() || DEFAULT_E2B_TEMPLATE;
  const namespace = options.namespace?.trim() || DEFAULT_E2B_NAMESPACE;
  const fetchImpl = options.fetchImpl ?? fetch;
  const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const resolvedClient =
    options.client ??
    (options.apiKey ? createSdkE2BClient(options.apiKey) : undefined);
  if (!resolvedClient) {
    throw new Error("E2B computer provider requires an API key or a client.");
  }
  const client: E2BClient = resolvedClient;

  const inflight = new Map<string, Promise<string>>();

  async function listed(
    extra: Record<string, string> = {},
  ): Promise<E2BSandboxRecord[]> {
    return client.list({ openbot: KIND, namespace, ...extra });
  }

  async function find(
    computerId: string,
  ): Promise<E2BSandboxRecord | undefined> {
    return pick(await listed({ computerId }));
  }

  async function waitUntilAnswering(url: string): Promise<void> {
    const deadline = Date.now() + readyTimeoutMs;
    while (Date.now() < deadline) {
      try {
        const response = await fetchImpl(`${url}/health`, {
          signal: AbortSignal.timeout(3_000),
        });
        if (response.ok) return;
      } catch {
        // Not up yet. The deadline is what ends this.
      }
      await pause(250);
    }
    throw unavailable();
  }

  async function ensureComputer(
    handle: E2BSandboxHandle,
    url: string,
  ): Promise<void> {
    try {
      const response = await fetchImpl(`${url}/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (response.ok) return;
    } catch {
      // Start, or start again after a filesystem-only resume.
    }
    await handle.startComputer(AGENT_COMPUTER_START_CMD, "/app");
    await waitUntilAnswering(url);
  }

  async function locateOnce(computerId: string): Promise<string> {
    if (!options.token) {
      throw unavailable();
    }

    try {
      const existing = await find(computerId);
      const handle = existing
        ? await client.connect(existing.sandboxId, RUNNING_TIMEOUT_MS)
        : await client.create({
            template,
            metadata: metadataFor(computerId, namespace),
            envs: {
              // Overwrites the template-build placeholder. Never omit this.
              COMPUTER_TOKEN: options.token,
              COMPUTER_BOT_ID: computerId,
              PORT: String(COMPUTER_PORT),
              WORKSPACE_DIR: "/workspace",
              PROFILES_DIR: "/profiles",
              PATH: AGENT_COMPUTER_PATH,
            },
            timeoutMs: RUNNING_TIMEOUT_MS,
          });
      await handle.setTimeout(RUNNING_TIMEOUT_MS);
      const url = asHttps(handle.getHost(COMPUTER_PORT));
      await ensureComputer(handle, url);
      return url;
    } catch (error) {
      if (error instanceof ComputerUnavailableError) throw error;
      if (error instanceof E2BSandboxGoneError) throw unavailable();
      throw unavailable(error);
    }
  }

  return {
    name: "E2B",
    isolation: "per-bot",

    async locate(botId) {
      const pending = inflight.get(botId);
      if (pending) return pending;
      const work = locateOnce(botId).finally(() => inflight.delete(botId));
      inflight.set(botId, work);
      return work;
    },

    async status(botId): Promise<ComputerStatus> {
      try {
        const existing = await find(botId);
        if (!existing) return { botId, state: "absent" };
        if (existing.state === "running") return { botId, state: "ready" };
        return { botId, state: "absent" };
      } catch (error) {
        return {
          botId,
          state: "unreachable",
          reason:
            error instanceof ComputerUnavailableError
              ? error.message
              : UNAVAILABLE,
        };
      }
    },

    async stop(botId) {
      const existing = await find(botId);
      if (existing?.state !== "running") {
        return { wasRunning: false };
      }
      try {
        await client.pause(existing.sandboxId);
        return { wasRunning: true };
      } catch (error) {
        if (error instanceof E2BSandboxGoneError) {
          return { wasRunning: false };
        }
        throw unavailable(error);
      }
    },

    async reset(botId) {
      const existing = await find(botId);
      if (!existing) return { cleared: false };
      try {
        await client.kill(existing.sandboxId);
        return { cleared: true };
      } catch (error) {
        if (error instanceof E2BSandboxGoneError) return { cleared: false };
        throw unavailable(error);
      }
    },

    async list(): Promise<ComputerLocation[]> {
      const records = await listed();
      return records.map((record) => ({
        botId: record.metadata.computerId ?? "unknown",
        status: record.state === "running" ? "running" : "stopped",
        ...(record.startedAt
          ? { startedAt: record.startedAt.toISOString() }
          : {}),
      }));
    },
  };
}
