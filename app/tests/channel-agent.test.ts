import { describe, expect, test } from "bun:test";
import {
  attachSeeTheWorkAgent,
  type ChannelAgentLookup,
  ownerThreadAgentId,
} from "@/lib/copilot/channel-agent";

function alreadyRegisteredError(agentId: string): Error {
  return new Error(
    `CopilotKitCore.registerProxiedAgent: agentId "${agentId}" is already registered. Pick a different agentId, or unregister…`,
  );
}

function registry(): ChannelAgentLookup & {
  ids: Set<string>;
  registerProxiedAgent: (params: { agentId: string }) => unknown;
} {
  const ids = new Set<string>();
  return {
    ids,
    getAgent: (agentId) => (ids.has(agentId) ? { agentId } : undefined),
    registerProxiedAgent: ({ agentId }) => {
      if (ids.has(agentId)) throw alreadyRegisteredError(agentId);
      ids.add(agentId);
      return { agentId };
    },
  };
}

describe("See the work CopilotKit bind", () => {
  test("mounting See the work while ChannelChat is already on the same channel does not throw registerProxiedAgent", () => {
    const core = registry();
    const channelId = "channel_419b656b-94bf-403d-8d17-1cf5c387f262";
    const ownerId = ownerThreadAgentId(channelId);
    expect(ownerId).toBe(
      "channel:channel_419b656b-94bf-403d-8d17-1cf5c387f262",
    );

    core.registerProxiedAgent({ agentId: ownerId });

    expect(() => attachSeeTheWorkAgent(core, channelId)).not.toThrow();
    expect(attachSeeTheWorkAgent(core, channelId)).toEqual({
      agentId: ownerId,
    });
    expect(core.ids.size).toBe(1);

    expect(() => core.registerProxiedAgent({ agentId: ownerId })).toThrow(
      /already registered/,
    );
  });
});
