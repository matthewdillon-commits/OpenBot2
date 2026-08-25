import { describe, expect, test } from "bun:test";
import type { DeploymentConfig } from "../src/config";
import { runUnattendedClaimLoop } from "../src/jobs/claim-loop";
import type { JobStore, UnattendedJob } from "../src/jobs/store";

function queuedJob(): UnattendedJob {
  const now = new Date();
  return {
    id: "job_claim_before_graph",
    orgId: "org_local",
    channelId: "channel_claim",
    goalId: "channel_claim",
    coworkerId: "agent_claim",
    actingUserId: "user_claim",
    trigger: "manual",
    payload: { prompt: "claim first" },
    status: "running",
    threadId: "thread_claim",
    needsYou: false,
    error: null,
    outcome: null,
    startedAt: now,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function unusedStore(): JobStore {
  const unused = async () => {
    throw new Error("this test only claims");
  };
  return {
    enqueue: unused,
    claim: unused,
    finish: unused,
    get: unused,
    listForChannel: unused,
    markNeedsYou: unused,
    hasUnfinishedOnThread: unused,
  };
}

describe("unattended claim loop", () => {
  test("claims a queued row before the coworker graph finishes loading", async () => {
    const job = queuedJob();
    let claims = 0;
    let processed: string | undefined;
    let claimedAt: number | undefined;
    let runtimeReadyAt: number | undefined;
    const started = Date.now();

    const jobStore: JobStore = {
      ...unusedStore(),
      claim: async () => {
        if (claims === 0) {
          claims += 1;
          claimedAt = Date.now() - started;
          return job;
        }
        return null;
      },
    };

    const abort = new AbortController();
    const loop = runUnattendedClaimLoop(
      { unattendedJobPollMs: 15 } as DeploymentConfig,
      {
        signal: abort.signal,
        jobStore,
        loadRuntime: async () => {
          await new Promise((resolve) => setTimeout(resolve, 80));
          runtimeReadyAt = Date.now() - started;
          return {
            processJob: async (claimed) => {
              processed = claimed.id;
              abort.abort();
            },
            tickDueCrons: async () => 0,
          };
        },
      },
    );

    await loop;

    expect(claims).toBe(1);
    expect(processed).toBe(job.id);
    expect(claimedAt).toBeDefined();
    expect(runtimeReadyAt).toBeDefined();
    expect(claimedAt ?? Number.POSITIVE_INFINITY).toBeLessThan(
      runtimeReadyAt ?? 0,
    );
  });

  test("keeps polling while the coworker graph is still loading", async () => {
    let claims = 0;
    const abort = new AbortController();

    const loop = runUnattendedClaimLoop(
      { unattendedJobPollMs: 10 } as DeploymentConfig,
      {
        signal: abort.signal,
        jobStore: {
          ...unusedStore(),
          claim: async () => {
            claims += 1;
            if (claims >= 3) abort.abort();
            return null;
          },
        },
        loadRuntime: () => new Promise(() => undefined),
      },
    );

    await loop;
    expect(claims).toBeGreaterThanOrEqual(3);
  });
});
