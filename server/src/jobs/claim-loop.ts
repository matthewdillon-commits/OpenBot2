/**
 * The worker's poll loop: claim first, then run.
 *
 * `createUnattendedWorkerRuntime` pulls CopilotKit, MCP, computer, and Intelligence.
 * That import is what `worker/src/index.ts` used to do before `worker-start`, and on
 * Railway the process never reached the log or a `jobs.started_at`. Claiming uses
 * only the database and `FOR UPDATE SKIP LOCKED`. The coworker graph loads in the
 * background and is awaited only after a row is already `running`.
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

export async function runUnattendedClaimLoop(
  config: DeploymentConfig,
  options: ClaimLoopOptions = {},
) {
  const pollMs = config.unattendedJobPollMs;
  const jobStore =
    options.jobStore ?? createJobStore(createDatabase(config.databaseUrl));
  const loadRuntime = options.loadRuntime ?? loadProductionRuntime;

  let runtime: ClaimLoopRuntime | undefined;
  const runtimeReady = loadRuntime(config)
    .then((loaded) => {
      runtime = loaded;
      return loaded;
    })
    .catch((error) => {
      console.error(
        JSON.stringify({
          type: "unattended-runtime-load-error",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      throw error;
    });

  while (!options.signal?.aborted) {
    try {
      const job = await jobStore.claim();
      if (job) {
        console.info(
          JSON.stringify({
            type: "unattended-job-claimed",
            jobId: job.id,
            orgId: job.orgId,
          }),
        );
        const loaded = runtime ?? (await runtimeReady);
        await loaded.processJob(job);
        continue;
      }
      if (runtime) {
        await runtime.tickDueCrons();
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          type: "unattended-job-loop-error",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
