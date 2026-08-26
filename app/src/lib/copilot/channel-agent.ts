/**
 * CopilotKit local ids for one goal. The owner thread registers
 * `channel:${id}`. See the work must not register that same id.
 */

export function ownerThreadAgentId(channelId: string): string {
  return `channel:${channelId}`;
}

/**
 * The lookup CopilotKit exposes to the tab. ChannelChat is the one
 * caller that may register the owner thread. See the work only looks up.
 */
export type ChannelAgentLookup = {
  getAgent: (agentId: string) => unknown;
};

/**
 * Bind See the work to the owner thread that ChannelChat already
 * registered. Never calls registerProxiedAgent — a second register of
 * `channel:${id}` throws and replaces the page with "Something went wrong!".
 */
export function attachSeeTheWorkAgent(
  registry: ChannelAgentLookup,
  channelId: string,
): unknown {
  return registry.getAgent(ownerThreadAgentId(channelId));
}
