import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Template, waitForPort } from "e2b";

/**
 * Template for one org×coworker computer on E2B.
 *
 * Built by an operator (`bun server/e2b/build.ts` from the repo root, with
 * E2B_API_KEY set). COMPUTER_TOKEN is not baked in; the API passes it as a
 * sandbox env when the sandbox is created, and the start command inherits it.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

export const template = Template({ fileContextPath: repoRoot })
  .fromImage("mcr.microsoft.com/playwright:v1.62.1-noble")
  .aptInstall(["unzip"], { noInstallRecommends: true })
  .runCmd("curl -fsSL https://bun.sh/install | bash", { user: "root" })
  .setEnvs({
    PATH: "/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
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
  })
  .setStartCmd("/root/.bun/bin/bun src/index.ts", waitForPort(4100));
