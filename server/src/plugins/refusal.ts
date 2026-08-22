/**
 * What a refused plugin or web-search call answers with.
 *
 * Lives in its own module so HTTP tests that import `createApp` do not pull the MCP SDK
 * (and its CJS EventSource) into the graph just to read this string.
 */
export const REFUSAL_MARKER = "Refused.";
