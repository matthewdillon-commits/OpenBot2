/**
 * The worker's poll loop: claim first, then run.
 *
 * `createUnattendedWorkerRuntime` pulls CopilotKit, MCP, computer, and Intelligence.
 * That import is what `worker/src/index.ts` used to do before `worker-start`, and on
 * Railway the process never reached the log or a `jobs.started_at`. Claiming uses
 * only the database and `FOR UPDATE SKIP LOCKED`. The coworker graph is not started
 * until a claim attempt has returned — a leftover queued row at boot must be able
 * to get `started_at` without waiting for that graph to finish evaluating.
 */
import type { DeploymentConfig } from "../config";
import { createDatabase } from "../db/client";
import { createJobStore, type JobStore, type UnattendedJob } from "./store";

export type ClaimLoopRuntime = {
  processJob: (job: UnattendedJob) => Promise<void>;
  tickDueCrons: () => Promise<number>;
};

export type ClaimLoopOptions = {
  signal?: AbortSignal;
  /** Tests inject a store so the loop can be proven without Postgres. */
  jobStore?: JobStore;
  /**
   * Tests inject a delayed runtime so claim is shown to happen before the
   * coworker graph finishes loading. Production loads `./bootstrap`.
   */
  loadRuntime?: (config: DeploymentConfig) => Promise<ClaimLoopRuntime>;
};

function loadProductionRuntime(
  config: DeploymentConfig,
): Promise<ClaimLoopRuntime> {
  return import("./bootstrap").then((module) =>
    module.createUnattendedWorkerRuntime(config),
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runUnattendedClaimLoop(
  config: DeploymentConfig,
  options: ClaimLoopOptions = {},
) {
  const pollMs = config.unattendedJobPollMs;
  // One connection: the claim statement is a single UPDATE. A second pooled
  // connection is how drizzle `transaction()` plus a follow-up select deadlocks
  // (the UPDATE holds FOR UPDATE; the select waits for it). The coworker graph
  // opens its own pool later; it must not exist yet on the first claim.
  const jobStore =
    options.jobStore ??
    createJobStore(createDatabase(config.databaseUrl, { max: 1 }));
  const loadRuntime = options.loadRuntime ?? loadProductionRuntime;

  let runtime: ClaimLoopRuntime | undefined;
  let runtimeReady: Promise<ClaimLoopRuntime> | undefined;

  const ensureRuntime = (): Promise<ClaimLoopRuntime> => {
    runtimeReady ??= loadRuntime(config)
      .then((loaded) => {
        runtime = loaded;
        return loaded;
      })
      .catch((error) => {
        console.error(`worker-claim-error runtime ${errorText(error)}`);
        console.error(
          JSON.stringify({
            type: "unattended-runtime-load-error",
            error: errorText(error),
          }),
        );
        throw error;
      });
    return runtimeReady;
  };

  while (!options.signal?.aborted) {
    try {
      console.error("worker-claim");
      const job = await jobStore.claim();
      if (job) {
        console.error(`worker-claim ${job.id}`);
        console.info(
          JSON.stringify({
            type: "unattended-job-claimed",
            jobId: job.id,
            orgId: job.orgId,
          }),
        );
        const loaded = runtime ?? (await ensureRuntime());
        await loaded.processJob(job);
        continue;
      }
      console.error("worker-claim-empty");
      if (!runtime) void ensureRuntime();
      if (runtime) {
        await runtime.tickDueCrons();
      }
    } catch (error) {
      console.error(`worker-claim-error ${errorText(error)}`);
      console.error(
        JSON.stringify({
          type: "unattended-job-loop-error",
          error: errorText(error),
        }),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
