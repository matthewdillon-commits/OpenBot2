/**
 * Publish the agent-computer E2B template.
 *
 * From the repository root, with E2B_API_KEY in the environment:
 *
 *   bun server/e2b/build.ts
 *
 * That alias is the default E2B_TEMPLATE. This is an operator step, not CI.
 */
import { Template, defaultBuildLogger } from "e2b";
import { template } from "./template";

const key = process.env.E2B_API_KEY?.trim();
if (!key) {
  console.error(
    "E2B_API_KEY is not set. Create an E2B account, then rerun from the repository root.",
  );
  process.exit(1);
}

await Template.build(template, "openbot-agent-computer", {
  apiKey: key,
  cpuCount: 2,
  memoryMB: 4096,
  onBuildLogs: defaultBuildLogger(),
});
