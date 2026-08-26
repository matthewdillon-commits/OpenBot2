import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { ComputerUnavailableError } from "../src/computer/client";
import {
  type E2BClient,
  type E2BCreateInput,
  type E2BSandboxHandle,
  type E2BSandboxRecord,
  E2BSandboxGoneError,
} from "../src/computer/e2b-client";
import {
  createE2BComputerProvider,
  DEFAULT_E2B_NAMESPACE,
  DEFAULT_E2B_TEMPLATE,
} from "../src/computer/e2b";
import { createComputerGateway } from "../src/computer/gateway";
import {
  createComputerProvider,
  describeComputerIsolation,
} from "../src/computer/provider";
import { COMPUTER_UNAVAILABLE_OWNER } from "../src/computer/computer-tools";
import type { ComputerConfig } from "../src/config";
import { computerIdFor } from "../src/orgs/constants";

/**
 * E2B as the computer plane: one sandbox per org-scoped computer id, never the
 * shared Chromium, and the second-org claim must not run.
 */

type FakeSandbox = {
  sandboxId: string;
  metadata: Record<string, string>;
  state: "running" | "paused";
  startedAt: Date;
  host: string;
  killed?: boolean;
};

function healthFetch(ok = true): typeof fetch {
  return (async () =>
    ok
      ? Response.json({ status: "ok" })
      : new Response("down", { status: 503 })) as unknown as typeof fetch;
}

function fakeE2B(options?: {
  connectError?: (sandboxId: string) => Error | undefined;
}): {
  client: E2BClient;
  creates: E2BCreateInput[];
  starts: string[];
  sandboxes: Map<string, FakeSandbox>;
} {
  const sandboxes = new Map<string, FakeSandbox>();
  const creates: E2BCreateInput[] = [];
  const starts: string[] = [];
  let next = 0;

  function handle(record: FakeSandbox): E2BSandboxHandle {
    return {
      sandboxId: record.sandboxId,
      getHost: () => record.host,
      pause: async () => {
        record.state = "paused";
      },
      kill: async () => {
        record.killed = true;
        sandboxes.delete(record.sandboxId);
      },
      setTimeout: async () => undefined,
      startComputer: async () => {
        starts.push(record.sandboxId);
      },
    };
  }

  const client: E2BClient = {
    async create(input) {
      creates.push(input);
      const sandboxId = `sbx_${++next}`;
      const record: FakeSandbox = {
        sandboxId,
        metadata: { ...input.metadata },
        state: "running",
        startedAt: new Date("2026-08-26T12:00:00.000Z"),
        host: `4100-${sandboxId}.e2b.app`,
      };
      sandboxes.set(sandboxId, record);
      return handle(record);
    },

    async connect(sandboxId) {
      const thrown = options?.connectError?.(sandboxId);
      if (thrown) throw thrown;
      const record = sandboxes.get(sandboxId);
      if (!record || record.killed) throw new E2BSandboxGoneError();
      record.state = "running";
      return handle(record);
    },

    async list(metadata) {
      return [...sandboxes.values()]
        .filter((record) => {
          if (record.killed) return false;
          if (!metadata) return true;
          return Object.entries(metadata).every(
            ([key, value]) => record.metadata[key] === value,
          );
        })
        .map(
          (record): E2BSandboxRecord => ({
            sandboxId: record.sandboxId,
            metadata: record.metadata,
            state: record.state,
            startedAt: record.startedAt,
          }),
        );
    },

    async pause(sandboxId) {
      const record = sandboxes.get(sandboxId);
      if (!record) throw new E2BSandboxGoneError();
      record.state = "paused";
    },

    async kill(sandboxId) {
      const record = sandboxes.get(sandboxId);
      if (!record) return false;
      record.killed = true;
      sandboxes.delete(sandboxId);
      return true;
    },
  };

  return { client, creates, starts, sandboxes };
}

describe("E2B computer provider factory", () => {
  test("selects E2B as one computer per Bot, not the shared Chromium", () => {
    const config: ComputerConfig = {
      provider: "e2b",
      apiKey: "e2b_test",
      token: "computer-secret",
      allowPrivateHosts: false,
    };
    const provider = createComputerProvider(config);
    expect(provider.name).toBe("E2B");
    expect(provider.isolation).toBe("per-bot");
    expect(describeComputerIsolation(provider).isolation).toBe(
      "one computer per Bot",
    );
  });
});

describe("E2B computer lifecycle", () => {
  test("creates one sandbox per computer id and returns its HTTPS address", async () => {
    const { client, creates } = fakeE2B();
    const provider = createE2BComputerProvider({
      token: "computer-secret",
      client,
      fetchImpl: healthFetch(),
    });

    const url = await provider.locate("org_acme__analyst");
    expect(url).toBe("https://4100-sbx_1.e2b.app");
    expect(creates).toHaveLength(1);
    expect(creates[0]?.metadata).toEqual({
      openbot: "computer",
      computerId: "org_acme__analyst",
      namespace: DEFAULT_E2B_NAMESPACE,
    });
    expect(creates[0]?.template).toBe(DEFAULT_E2B_TEMPLATE);
    expect(creates[0]?.envs.COMPUTER_BOT_ID).toBe("org_acme__analyst");
    expect(creates[0]?.envs.COMPUTER_TOKEN).toBe("computer-secret");
  });

  test("two org-scoped ids never share a sandbox", async () => {
    const { client, creates } = fakeE2B();
    const provider = createE2BComputerProvider({
      token: "t",
      client,
      fetchImpl: healthFetch(),
    });

    const acme = computerIdFor("org_acme", "analyst");
    const beta = computerIdFor("org_beta", "analyst");
    expect(acme).not.toBe(beta);

    const acmeUrl = await provider.locate(acme);
    const betaUrl = await provider.locate(beta);
    expect(acmeUrl).not.toBe(betaUrl);
    expect(creates.map((entry) => entry.metadata.computerId)).toEqual([
      acme,
      beta,
    ]);
  });

  test("a second locate resumes the paused sandbox instead of minting another", async () => {
    const { client, creates, sandboxes } = fakeE2B();
    const provider = createE2BComputerProvider({
      token: "t",
      client,
      fetchImpl: healthFetch(),
    });

    await provider.locate("sales");
    expect(await provider.stop("sales")).toEqual({ wasRunning: true });
    expect([...sandboxes.values()][0]?.state).toBe("paused");

    const url = await provider.locate("sales");
    expect(url).toBe("https://4100-sbx_1.e2b.app");
    expect(creates).toHaveLength(1);
    expect([...sandboxes.values()][0]?.state).toBe("running");
  });

  test("a missing token is not available, with no environment names", async () => {
    const { client, creates } = fakeE2B();
    const provider = createE2BComputerProvider({
      client,
      fetchImpl: healthFetch(),
    });

    let thrown: unknown;
    try {
      await provider.locate("sales");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ComputerUnavailableError);
    expect((thrown as Error).message).toBe(COMPUTER_UNAVAILABLE_OWNER);
    expect((thrown as Error).message).not.toMatch(
      /E2B_API_KEY|E2B_TEMPLATE|COMPUTER_TOKEN/,
    );
    expect(creates).toHaveLength(0);
  });

  test("a gone sandbox is not available, with no environment names", async () => {
    const { client } = fakeE2B({
      connectError: () => new E2BSandboxGoneError(),
    });
    const provider = createE2BComputerProvider({
      token: "t",
      client,
      fetchImpl: healthFetch(),
    });
    await provider.locate("sales");

    let thrown: unknown;
    try {
      await provider.locate("sales");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ComputerUnavailableError);
    expect((thrown as Error).message).toBe(COMPUTER_UNAVAILABLE_OWNER);
    expect((thrown as Error).message).not.toMatch(
      /E2B_API_KEY|E2B_TEMPLATE|COMPUTER_TOKEN|COMPUTER_SUPERVISOR_URL/,
    );
  });

  test("stop pauses; reset kills so the next locate can mint a new machine", async () => {
    const { client, creates } = fakeE2B();
    const provider = createE2BComputerProvider({
      token: "t",
      client,
      fetchImpl: healthFetch(),
    });

    await provider.locate("sales");
    expect(await provider.status("sales")).toEqual({
      botId: "sales",
      state: "ready",
    });
    expect(await provider.stop("sales")).toEqual({ wasRunning: true });
    expect(await provider.status("sales")).toEqual({
      botId: "sales",
      state: "absent",
    });
    expect(await provider.reset("sales")).toEqual({ cleared: true });
    expect(await provider.list()).toEqual([]);

    await provider.locate("sales");
    expect(creates).toHaveLength(2);
  });

  test("starts agent-computer inside the sandbox when health is down", async () => {
    const { client, starts } = fakeE2B();
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls < 3) return new Response("down", { status: 503 });
      return Response.json({ status: "ok" });
    }) as unknown as typeof fetch;
    const provider = createE2BComputerProvider({
      token: "t",
      client,
      fetchImpl,
      readyTimeoutMs: 5_000,
    });

    await provider.locate("sales");
    expect(starts).toEqual(["sbx_1"]);
  });
});

describe("E2B isolation at the gateway", () => {
  test("shared-claim is not consulted for an E2B provider", async () => {
    const { client } = fakeE2B();
    const fetchImpl = (async (url: string) => {
      const path = new URL(url).pathname;
      if (path === "/health") return Response.json({ status: "ok" });
      if (path === "/navigate") {
        return Response.json({
          url: "https://example.com/",
          title: "Example",
          text: "",
          truncated: false,
          elapsedMs: 1,
        });
      }
      return Response.json({ error: path }, { status: 404 });
    }) as unknown as typeof fetch;
    const provider = createE2BComputerProvider({
      token: "t",
      client,
      fetchImpl,
    });
    expect(provider.isolation).toBe("per-bot");

    const gateway = createComputerGateway({
      provider,
      fetchImpl,
      auditStore: { insert: async () => undefined },
      policy: () => ({ mode: "enforce", deny: [], allow: ["true"] }),
      sharedClaim: {
        ensure: async () => {
          throw new Error("shared-claim must not run for E2B");
        },
      },
    });

    await gateway.navigate(
      "analyst",
      { id: "user-a", orgId: "org_acme" },
      "https://example.com/",
    );
    await gateway.navigate(
      "analyst",
      { id: "user-b", orgId: "org_beta" },
      "https://example.com/",
    );
  });

  test("the API and worker only attach shared-claim when isolation is shared", () => {
    const index = readFileSync(
      fileURLToPath(new URL("../src/index.ts", import.meta.url)),
      "utf8",
    );
    const bootstrap = readFileSync(
      fileURLToPath(new URL("../src/jobs/bootstrap.ts", import.meta.url)),
      "utf8",
    );
    expect(index).toContain('computerProvider.isolation === "shared"');
    expect(bootstrap).toContain('computerProvider.isolation === "shared"');
  });
});
