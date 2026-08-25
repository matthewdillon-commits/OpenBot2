/**
 * Production import graph for unattended jobs, loaded as `bun` (not `bun test`).
 *
 * bunfig.toml only preloads eventsource under `[test]`, so this file is the start
 * path that crashed on Railway: `jobs/bootstrap` (the worker), `copilot` (the API
 * runtime), and `runtime-agents` (imported by the API before copilot). A
 * `require() async module .../eventsource` throw here is the worker dying before
 * it can claim a queued job.
 */
import "../../server/src/jobs/bootstrap";
import "../../server/src/copilot";
import "../../server/src/agents/runtime-agents";

console.log("unattended-graph-ok");
