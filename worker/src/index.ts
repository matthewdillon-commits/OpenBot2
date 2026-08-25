/**
 * Claim unattended coworker jobs and run them.
 *
 * The API only inserts a `queued` row. This process is the one that `FOR UPDATE SKIP LOCKED`
 * claims and executes — not an in-process Map on the replica that accepted Send-and-go.
 *
 * Do not statically import `jobs/bootstrap`. That module is the coworker run graph
 * (CopilotKit, MCP, computer, Intelligence). Evaluating it before `worker-start` is
 * what left Railway jobs queued: s6 had spawned bun, and bun never reached this log.
 */
import "../../server/src/compat/eventsource";
import { loadConfig } from "../../server/src/config";
import { runUnattendedClaimLoop } from "../../server/src/jobs/claim-loop";
import { startTracing } from "../../server/src/telemetry";
import { workerStatus } from "./status";

console.error("worker-boot");

const config = loadConfig();
startTracing("openbot-worker");

const started = {
  type: "worker-start",
  ...workerStatus(),
  pollMs: config.unattendedJobPollMs,
  timeoutMs: config.unattendedJobTimeoutMs,
};
const startedLine = JSON.stringify(started);
console.info(startedLine);
console.error(startedLine);

await runUnattendedClaimLoop(config);
