/**
 * Loaded before any test file, to make module loading deterministic.
 *
 * Deep inside the runtime's dependencies, `@modelcontextprotocol/sdk`
 * does `require("eventsource")` from CommonJS. eventsource@3 ships dual ESM/CJS, but its
 * `exports.bun` condition pointed Bun's `require()` at the ESM build, so the throw was
 * `require() async module` rather than a missing package. Whether a file imported depended
 * on the order the suite happened to be walked, an order that changes whenever a test file
 * is added or renamed.
 *
 * The failure is not a failing test. The file throws while being imported, so its tests are
 * never registered and never reported.
 *
 * Production uses the same evaluation (`server/src/compat/eventsource.ts` via `--preload`
 * and a first import) plus a patched `eventsource` that gives `require()` the CJS build.
 * This file stays so `bun test` does not depend on that patch applying before the first
 * test file is walked. `eventsource` is a production dependency of this package for the
 * same reason.
 */

import "eventsource";
