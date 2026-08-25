import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");

function read(path: string) {
  return readFileSync(join(repositoryRoot, path), "utf8");
}

function json(path: string) {
  return JSON.parse(read(path)) as Record<string, unknown>;
}

/**
 * eventsource@3's `exports.bun` condition pointed Bun's `require()` at the ESM
 * build. `@ag-ui/mcp-apps-middleware` then died on
 * `require() async module .../eventsource/dist/index.js` and the worker never
 * claimed a queued job. The patch removes that condition so `require()` gets
 * `dist/index.cjs`.
 */
test("patches eventsource so Bun require() uses the CJS build", () => {
  const patch = read("patches/eventsource@3.0.7.patch");
  expect(patch).toContain('-      "bun": "./dist/index.js",');
  expect(patch).toContain('"require": "./dist/index.cjs"');

  const root = json("package.json") as {
    patchedDependencies?: Record<string, string>;
  };
  expect(root.patchedDependencies?.["eventsource@3.0.7"]).toBe(
    "patches/eventsource@3.0.7.patch",
  );

  const installed = json("server/node_modules/eventsource/package.json") as {
    exports?: { "."?: { bun?: string; require?: string } };
  };
  expect(installed.exports?.["."]?.bun).toBeUndefined();
  expect(installed.exports?.["."]?.require).toBe("./dist/index.cjs");
});

test("keeps eventsource in server production dependencies so the image can preload it", () => {
  const manifest = json("server/package.json") as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  expect(manifest.dependencies?.eventsource).toBe("3.0.7");
  expect(manifest.devDependencies?.eventsource).toBeUndefined();
});

test("copies eventsource patches into both image installs", () => {
  const dockerfile = read("Dockerfile");
  expect(dockerfile).toContain("COPY patches patches");
  expect(dockerfile).toContain("cp -r patches /prod/patches");
  expect(read("server/Dockerfile")).toContain("COPY patches patches");
});

test("s6 API and worker preload eventsource before their start files", () => {
  const preload = "--preload /app/server/src/compat/eventsource.ts";
  expect(read("docker/s6/s6-rc.d/worker/run")).toContain(preload);
  expect(read("docker/s6/s6-rc.d/api/run")).toContain(preload);
  expect(read("docker/s6/s6-rc.d/computer/run")).not.toContain("--preload");
});

/**
 * bunfig [test] preload does not apply to this child. Repeating the import
 * catches the Bun race that let the API listen while the worker died.
 */
test("unattended start graph loads under bun without the test preload", async () => {
  const script = join(
    repositoryRoot,
    "worker/scripts/load-unattended-graph.ts",
  );
  expect(existsSync(script)).toBe(true);

  for (let attempt = 0; attempt < 3; attempt++) {
    const proc = Bun.spawn([process.execPath, script], {
      cwd: repositoryRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code !== 0 || !stdout.includes("unattended-graph-ok")) {
      throw new Error(
        `unattended start graph failed on attempt ${attempt} (exit ${code})\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      );
    }
    expect(stderr).not.toContain("require() async module");
    expect(stdout).toContain("unattended-graph-ok");
    expect(code).toBe(0);
  }
}, 20_000);
