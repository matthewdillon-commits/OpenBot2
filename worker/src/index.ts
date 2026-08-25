/**
 * Claim unattended coworker jobs and run them.
 *
 * The API only inserts a `queued` row. This process is the one that `FOR UPDATE SKIP LOCKED`
 * claims and executes — not an in-process Map on the replica that accepted Send-and-go.
 */
import { loadConfig } from "../../server/src/config";
import { runUnattendedClaimLoop } from "../../server/src/jobs/bootstrap";
import { workerStatus } from "./status";

const config = loadConfig();

console.info(
  JSON.stringify({
    type: "worker-start",
    ...workerStatus(),
    pollMs: config.unattendedJobPollMs,
    timeoutMs: config.unattendedJobTimeoutMs,
  }),
);

await runUnattendedClaimLoop(config);
