/**
 * Evaluate `eventsource` as ESM before any CommonJS MCP client `require()`s it.
 *
 * `@ag-ui/mcp-apps-middleware` loads `@modelcontextprotocol/sdk/dist/cjs/client/sse.js`,
 * which does `require("eventsource")`. eventsource@3 ships dual ESM/CJS, but its
 * `exports.bun` condition pointed `require()` at the ESM build. Bun 1.3 then throws
 * `require() async module .../eventsource/dist/index.js is unsupported` and the process
 * never starts.
 *
 * The package is patched so `require()` gets `dist/index.cjs`. This module remains the
 * production equivalent of `server/scripts/test-preload.ts`: bun `--preload`s it (and
 * the API/worker entries import it first) so a missed patch still cannot crash the
 * worker that claims unattended jobs.
 */
import "eventsource";
