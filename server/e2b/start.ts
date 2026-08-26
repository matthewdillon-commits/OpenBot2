/**
 * How agent-computer is started inside an E2B sandbox.
 *
 * Must not depend on /root/.bun. The bun installer puts the binary there as
 * root, but E2B start does not run as root (or cannot traverse /root), so
 * `/root/.bun/bin/bun` exits 126 Permission denied. The template copies bun
 * to /usr/local/bin (mode 755); this command inherits PATH.
 */
export const AGENT_COMPUTER_START_CMD = "bun src/index.ts";

/** PATH that finds /usr/local/bin/bun. Do not prepend /root/.bun/bin. */
export const AGENT_COMPUTER_PATH =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

/**
 * Non-secret placeholder so template-build `waitForPort(4100)` can start
 * agent-computer. E2B runs the start command at build time; the process exits
 * 1 without COMPUTER_TOKEN. Runtime `Sandbox.create` overwrites this with the
 * deployment token. Do not put a production secret here.
 */
export const AGENT_COMPUTER_TEMPLATE_TOKEN = "template-build";
