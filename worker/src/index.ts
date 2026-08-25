/**
 * Claim unattended coworker jobs and run them.
 *
 * The API only inserts a `queued` row. This process is the one that `FOR UPDATE SKIP LOCKED`
 * claims and executes — not an in-process Map on the replica that accepted Send-and-go.
 *
 * Do not statically import `jobs/bootstrap`. That module is the coworker run graph
 * (CopilotKit, MCP, computer, Intelligence). Evaluating it before `worker-start` is
 * what left Railway jobs queued: s6 had spawned bun, and bun never reached this log.
 *
 * `worker-start` is plain stderr, before loadConfig / tracing / the claim loop. Railway
 * drops JSON log bodies; a JSON-only line is how we went blind after `worker-boot`.
 */
import "../../server/src/compat/eventsource";
import { loadConfig } from "../../server/src/config";
import { runUnattendedClaimLoop } from "../../server/src/jobs/claim-loop";
import { startTracing } from "../../server/src/telemetry";
import { workerStatus } from "./status";

console.error("worker-boot");
console.error("worker-start");

const config = loadConfig();
startTracing("openbot-worker");

const started = {
  type: "worker-start",
  ...workerStatus(),
  pollMs: config.unattendedJobPollMs,
  timeoutMs: config.unattendedJobTimeoutMs,
};
console.error(JSON.stringify(started));

await runUnattendedClaimLoop(config);
