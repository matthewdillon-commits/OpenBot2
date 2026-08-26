import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");

function read(path: string) {
  return readFileSync(join(repositoryRoot, path), "utf8");
}

test("the one-image boot starts agent-computer on 4100 next to the API", () => {
  const dockerfile = read("Dockerfile");
  expect(dockerfile).toContain("ENV AGENT_COMPUTER_URL=http://127.0.0.1:4100");
  expect(dockerfile).toContain("COPY shared shared");
  expect(dockerfile).toContain("COPY agent-computer/src agent-computer/src");
  const computer = read("docker/s6/s6-rc.d/computer/run");
  expect(computer).toContain("export PORT=4100");
  expect(computer).toContain("bun src/index.ts");
  expect(read("docker/s6/s6-rc.d/user/contents.d/computer")).toBe("");
});

test("an empty COMPUTER_TOKEN does not mint a random secret when the vault key is present", () => {
  const script = read("docker/s6/scripts/computer-token.sh");
  expect(script).toContain("KEY_ENCRYPTION_KEY");
  expect(script).toContain("COMPUTER_TOKEN:-");
  expect(script).toContain("KEY_ENCRYPTION_KEY:-");
  expect(script).toMatch(
    /if \[ -z "\$\{COMPUTER_TOKEN:-\}" \] && \[ -z "\$\{KEY_ENCRYPTION_KEY:-\}" \]; then/,
  );
  const computer = read("agent-computer/src/index.ts");
  expect(computer).toContain("sameImageComputerToken");
  const config = read("server/src/config.ts");
  expect(config).toContain("sameImageComputerToken");
  expect(config).toContain("sameImageComputerSecret");
});
