import { Sandbox, SandboxNotFoundError } from "e2b";

/**
 * The E2B surface this provider needs, and nothing else.
 *
 * Tests inject a fake. Production wraps the SDK so a paused sandbox can be
 * resumed by id from any replica without this process holding a handle.
 */

export class E2BSandboxGoneError extends Error {
  constructor() {
    super("The computer is not available.");
    this.name = "E2BSandboxGoneError";
  }
}

export type E2BSandboxRecord = {
  sandboxId: string;
  metadata: Record<string, string>;
  state: "running" | "paused";
  startedAt?: Date;
};

export type E2BSandboxHandle = {
  sandboxId: string;
  getHost(port: number): string;
  pause(): Promise<void>;
  kill(): Promise<void>;
  setTimeout(ms: number): Promise<void>;
  startComputer(command: string, cwd: string): Promise<void>;
};

export type E2BCreateInput = {
  template: string;
  metadata: Record<string, string>;
  envs: Record<string, string>;
  timeoutMs: number;
};

export type E2BClient = {
  create(input: E2BCreateInput): Promise<E2BSandboxHandle>;
  connect(sandboxId: string, timeoutMs: number): Promise<E2BSandboxHandle>;
  list(metadata?: Record<string, string>): Promise<E2BSandboxRecord[]>;
  pause(sandboxId: string): Promise<void>;
  kill(sandboxId: string): Promise<boolean>;
};

function wrap(sandbox: Sandbox): E2BSandboxHandle {
  return {
    sandboxId: sandbox.sandboxId,
    getHost: (port) => sandbox.getHost(port),
    pause: async () => {
      await sandbox.pause();
    },
    kill: async () => {
      await sandbox.kill();
    },
    setTimeout: async (ms) => {
      await sandbox.setTimeout(ms);
    },
    startComputer: async (command, cwd) => {
      await sandbox.commands.run(command, {
        background: true,
        cwd,
      });
    },
  };
}

async function pages(paginator: {
  hasNext: boolean;
  nextItems(): Promise<
    Array<{
      sandboxId: string;
      metadata?: Record<string, string>;
      state: "running" | "paused";
      startedAt?: Date;
    }>
  >;
}): Promise<E2BSandboxRecord[]> {
  const collected: E2BSandboxRecord[] = [];
  while (paginator.hasNext) {
    const batch = (await paginator.nextItems()) as Array<{
      sandboxId: string;
      metadata?: Record<string, string>;
      state: "running" | "paused";
      startedAt?: Date;
    }>;
    for (const item of batch) {
      collected.push({
        sandboxId: item.sandboxId,
        metadata: item.metadata ?? {},
        state: item.state,
        ...(item.startedAt ? { startedAt: item.startedAt } : {}),
      });
    }
  }
  return collected;
}

/** The live E2B SDK, keyed by this deployment's API key. */
export function createSdkE2BClient(apiKey: string): E2BClient {
  const auth = { apiKey };

  return {
    async create(input) {
      const sandbox = await Sandbox.create(input.template, {
        ...auth,
        timeoutMs: input.timeoutMs,
        metadata: input.metadata,
        envs: input.envs,
        lifecycle: { onTimeout: "pause" },
        // agent-computer already requires COMPUTER_TOKEN. E2B traffic auth
        // would need extra headers the existing gateway transport does not send.
        secure: false,
      });
      return wrap(sandbox);
    },

    async connect(sandboxId, timeoutMs) {
      try {
        const sandbox = await Sandbox.connect(sandboxId, {
          ...auth,
          timeoutMs,
        });
        return wrap(sandbox);
      } catch (error) {
        if (error instanceof SandboxNotFoundError) {
          throw new E2BSandboxGoneError();
        }
        throw error;
      }
    },

    async list(metadata) {
      const paginator = Sandbox.list({
        ...auth,
        ...(metadata
          ? { query: { metadata, state: ["running", "paused"] } }
          : { query: { state: ["running", "paused"] } }),
      });
      return pages(paginator);
    },

    async pause(sandboxId) {
      try {
        await Sandbox.pause(sandboxId, auth);
      } catch (error) {
        if (error instanceof SandboxNotFoundError) {
          throw new E2BSandboxGoneError();
        }
        throw error;
      }
    },

    async kill(sandboxId) {
      try {
        return await Sandbox.kill(sandboxId, auth);
      } catch (error) {
        if (error instanceof SandboxNotFoundError) {
          throw new E2BSandboxGoneError();
        }
        throw error;
      }
    },
  };
}
