import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");

function read(path: string) {
  return readFileSync(join(repositoryRoot, path), "utf8");
}

/**
 * Railway s6 started bun and never logged worker-start while jobs stayed
 * queued. The cause was a static import of `jobs/bootstrap` — the full
 * coworker graph — before the boot line. Claiming does not need that graph.
 */
test("worker entry logs worker-start without importing the coworker graph", () => {
  const source = read("worker/src/index.ts");
  expect(source).toContain('type: "worker-start"');
  expect(source).toContain('console.error("worker-start")');
  expect(source.indexOf('console.error("worker-start")')).toBeLessThan(
    source.indexOf("loadConfig()"),
  );
  expect(source).toContain("jobs/claim-loop");
  expect(source).not.toMatch(/from ["'][^"']*jobs\/bootstrap["']/);
  expect(source).toContain('console.error("worker-boot")');
});

test("claim loop loads bootstrap only after a claim, not at import time", () => {
  const source = read("server/src/jobs/claim-loop.ts");
  expect(source).toContain('import("./bootstrap")');
  expect(source).not.toMatch(/from ["']\.\/bootstrap["']/);
  expect(source).not.toContain("copilot");
  expect(source).not.toContain("runtime-agents");
  expect(source).toContain("FOR UPDATE SKIP LOCKED");
  expect(source).toContain("worker-claim-empty");
  expect(source).toContain("worker-claim-error");
  const firstClaim = source.indexOf("await jobStore.claim()");
  expect(firstClaim).toBeGreaterThan(-1);
  expect(firstClaim).toBeLessThan(source.indexOf("await ensureRuntime()"));
  expect(firstClaim).toBeLessThan(source.indexOf("void ensureRuntime()"));
});

test("s6 still execs the worker after migrate, with eventsource preload", () => {
  const run = read("docker/s6/s6-rc.d/worker/run");
  expect(run).toContain("--preload /app/server/src/compat/eventsource.ts");
  expect(run).toContain("worker-exec");
  expect(read("docker/s6/s6-rc.d/user/contents.d/worker")).toBe("");
});

test("image CI fails if worker-start is missing or a queued job stays queued", () => {
  const ci = read(".github/workflows/ci.yml");
  expect(ci).toContain('"type":"worker-start"');
  expect(ci).toContain("worker-boot");
  expect(ci).toContain("worker-claim-empty");
  expect(ci).toContain("ci-claim-probe.sh");
  expect(read("worker/scripts/ci-claim-probe.sh")).toContain("started_at");
});
