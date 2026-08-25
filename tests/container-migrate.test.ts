import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");

function read(path: string) {
  return readFileSync(join(repositoryRoot, path), "utf8");
}

/**
 * Railway and any other external Postgres deploy set DATABASE_URL and leave
 * EMBEDDED_POSTGRES off. The oneshot used to exit 0 in that case, so the API
 * started against a database with no tables.
 */
test("applies drizzle migrations for any DATABASE_URL, not only embedded postgres", () => {
  const script = read("docker/s6/scripts/migrate.sh");

  expect(script).not.toMatch(/EMBEDDED_POSTGRES.*\|\| exit 0/);
  expect(script).toContain("drizzle-kit migrate");
  expect(script).toContain("--config=drizzle.config.ts");
  expect(script).toContain("DATABASE_URL");
});

test("keeps drizzle-kit in server production dependencies so the image can migrate", () => {
  const manifest = JSON.parse(read("server/package.json")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  expect(manifest.dependencies?.["drizzle-kit"]).toBeTruthy();
  expect(manifest.devDependencies?.["drizzle-kit"]).toBeUndefined();
});

test("starts the API only after migrate has finished", () => {
  expect(
    existsSync(
      join(repositoryRoot, "docker/s6/s6-rc.d/api/dependencies.d/migrate"),
    ),
  ).toBe(true);
  expect(
    existsSync(
      join(repositoryRoot, "docker/s6/s6-rc.d/worker/dependencies.d/migrate"),
    ),
  ).toBe(true);
});

/**
 * s6 compiles every directory under s6-rc.d, but it only launches names listed
 * in user/contents.d. The worker service existed while jobs stayed queued
 * because that list omitted it.
 */
test("starts the worker from the s6 user boot bundle", () => {
  const bundle = join(repositoryRoot, "docker/s6/s6-rc.d/user/contents.d");
  for (const name of [
    "worker",
    "api",
    "computer",
    "migrate",
    "postgres",
    "postgres-init",
    "computer-token",
  ]) {
    expect(existsSync(join(bundle, name))).toBe(true);
  }
});

test("copies the production server install into the runtime image", () => {
  const dockerfile = read("Dockerfile");
  expect(dockerfile).toContain("bun install --frozen-lockfile --production");
  expect(dockerfile).toContain(
    "COPY --from=deps /prod/server/node_modules server/node_modules",
  );
});
