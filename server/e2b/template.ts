import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Template, waitForPort } from "e2b";
import {
  AGENT_COMPUTER_PATH,
  AGENT_COMPUTER_START_CMD,
  AGENT_COMPUTER_TEMPLATE_TOKEN,
} from "./start";

/**
 * Template for one org×coworker computer on E2B.
 *
 * Built by an operator (`bun server/e2b/build.ts` from the repo root, with
 * E2B_API_KEY set). COMPUTER_TOKEN in this image is only the non-secret
 * placeholder `template-build`: E2B runs the start command at template-build
 * time for waitForPort(4100), and agent-computer exits 1 without a token.
 * The API overwrites it in Sandbox.create envs. Do not bake a production token.
 *
 * Start must not depend on /root/.bun: E2B start does not run as root (or
 * cannot traverse /root), so `/root/.bun/bin/bun` exits 126 Permission denied.
 * Copy bun to /usr/local/bin with mode 755 and start with `bun src/index.ts`
 * so PATH finds a world-executable binary.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

export const template = Template({ fileContextPath: repoRoot })
  .fromImage("mcr.microsoft.com/playwright:v1.62.1-noble")
  .aptInstall(["unzip"], { noInstallRecommends: true })
  .runCmd(
    "curl -fsSL https://bun.sh/install | bash && cp -L /root/.bun/bin/bun /usr/local/bin/bun && chmod 755 /usr/local/bin/bun",
    { user: "root" },
  )
  .setEnvs({
    PATH: AGENT_COMPUTER_PATH,
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
  })
  .setWorkdir("/app")
  .copy("agent-computer/package.json", "/app/package.json")
  .runCmd("bun install", { user: "root" })
  .copy("shared", "/shared")
  .copy("agent-computer/src", "/app/src")
  .runCmd("mkdir -p /workspace /profiles", { user: "root" })
  .setEnvs({
    WORKSPACE_DIR: "/workspace",
    PROFILES_DIR: "/profiles",
    PORT: "4100",
    COMPUTER_TOKEN: AGENT_COMPUTER_TEMPLATE_TOKEN,
  })
  .setStartCmd(AGENT_COMPUTER_START_CMD, waitForPort(4100));
