import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const FORBIDDEN = [
  /\bspawn_subagent\b/,
  /\bmessage_agent\b/,
  /\bsubagent_runs\b/,
  /channel\.kind\s*=/,
];

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === ".output"
      ) {
        continue;
      }
      files.push(...(await sourceFiles(path)));
      continue;
    }
    if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

describe("PR #11 stack is not on this tree", () => {
  test("does not introduce spawn_subagent, message_agent, or subagent_runs", async () => {
    const roots = [
      new URL("../src", import.meta.url).pathname,
      new URL("../../app/src", import.meta.url).pathname,
    ];
    const hits: string[] = [];
    for (const root of roots) {
      for (const file of await sourceFiles(root)) {
        const text = await readFile(file, "utf8");
        for (const symbol of FORBIDDEN) {
          if (symbol.test(text)) {
            hits.push(`${file}: ${symbol}`);
          }
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
