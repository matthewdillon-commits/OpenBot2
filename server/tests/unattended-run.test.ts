import { describe, expect, test } from "bun:test";
import { HttpAgent } from "@ag-ui/client";
import { BuiltInAgent } from "@copilotkit/runtime/v2";
import { z } from "zod";
import { standingRoleMessage } from "../src/copilot";
import { crmTools } from "../src/crm/tools";
import {
  identifyActorFromContext,
  identifyUserFromContext,
} from "../src/jobs/actor";
import { startUnattendedRun, UNATTENDED_REFUSALS } from "../src/jobs/run";
import { gateUserOAuthTools, serverSideToolsOnly } from "../src/jobs/tools";
import { REFUSAL_MARKER } from "../src/plugins/refusal";
import type { GrantedTool } from "../src/plugins/tools";

const actor = {
  id: "user-1",
  name: "Ada",
  role: "user" as const,
  orgId: "org_local",
};

describe("request-less actor context", () => {
  test("scopes Intelligence users as org:user without a Request", () => {
    expect(identifyUserFromContext(actor)).toEqual({
      id: "org_local:user-1",
      name: "Ada",
    });
    expect(identifyActorFromContext(actor)).toEqual({
      id: "user-1",
      role: "user",
      orgId: "org_local",
    });
  });
});

describe("startUnattendedRun", () => {
  test("refuses when the channel has no Intelligence thread mapping", async () => {
    const result = await startUnattendedRun({
      actor,
      orgId: actor.orgId,
      channelId: "channel_missing",
      threadId: "thread-1",
      prompt: "Research this lead.",
      coworkerId: "researcher",
      deps: {
        lookupMapping: async () => null,
        recordActivity: async () => {
          throw new Error("must not record activity on a refused run");
        },
        loadAgents: async () => [],
        loadTools: () => async () => [],
        resolveModelApiKey: async () => null,
        model: { provider: "openai", defaultModel: "gpt-4.1" },
        timeoutMs: 5_000,
      },
    });

    expect(result.outcome).toBe("refused");
    expect(result.error).toBe(UNATTENDED_REFUSALS.MISSING_MAPPING);
  });

  test("refuses a busy thread instead of starting a second run", async () => {
    const result = await startUnattendedRun({
      actor,
      orgId: actor.orgId,
      channelId: "channel_1",
      threadId: "thread-1",
      prompt: "Follow up.",
      coworkerId: "researcher",
      deps: {
        lookupMapping: async () => ({
          threadId: "thread-1",
          channelId: "channel_1",
          userId: actor.id,
        }),
        waitForThread: async () => "busy",
        recordActivity: async () => undefined,
        loadAgents: async () => [],
        loadTools: () => async () => [],
        resolveModelApiKey: async () => null,
        model: { provider: "openai", defaultModel: "gpt-4.1" },
        timeoutMs: 5_000,
      },
    });

    expect(result.outcome).toBe("refused");
    expect(result.error).toBe(UNATTENDED_REFUSALS.THREAD_BUSY);
  });

  test("accepts goalId when it is the existing channel, and refuses a different id", async () => {
    const ok = await startUnattendedRun({
      actor,
      orgId: actor.orgId,
      channelId: "channel_1",
      threadId: "thread-1",
      prompt: "Find Ada.",
      coworkerId: "researcher",
      goalId: "channel_1",
      deps: {
        lookupMapping: async () => ({
          threadId: "thread-1",
          channelId: "channel_1",
          userId: actor.id,
        }),
        waitForThread: async () => "idle",
        persistThread: async () => true,
        recordActivity: async () => undefined,
        loadAgents: async () => [
          {
            id: "researcher",
            name: "Researcher",
            type: "built_in",
            systemPrompt: "Research people.",
          },
        ],
        loadTools: () => async () => [],
        resolveModelApiKey: async () => "unused",
        model: { provider: "openai", defaultModel: "gpt-4.1" },
        timeoutMs: 5_000,
        runCoworker: async ({ messages }) => ({
          text: "Ada is at Acme.",
          messages: [
            ...messages,
            { id: "a1", role: "assistant", content: "Ada is at Acme." },
          ],
        }),
      },
    });
    expect(ok.outcome).toBe("succeeded");

    const refused = await startUnattendedRun({
      actor,
      orgId: actor.orgId,
      channelId: "channel_1",
      threadId: "thread-1",
      prompt: "Find Ada.",
      coworkerId: "researcher",
      goalId: "goal_other",
      deps: {
        lookupMapping: async () => ({
          threadId: "thread-1",
          channelId: "channel_1",
          userId: actor.id,
        }),
        waitForThread: async () => "idle",
        persistThread: async () => {
          throw new Error("must not persist a mismatched goal");
        },
        recordActivity: async () => {
          throw new Error("must not record activity on a refused run");
        },
        loadAgents: async () => [],
        loadTools: () => async () => [],
        resolveModelApiKey: async () => null,
        model: { provider: "openai", defaultModel: "gpt-4.1" },
        timeoutMs: 5_000,
      },
    });
    expect(refused.outcome).toBe("refused");
    expect(refused.error).toBe(UNATTENDED_REFUSALS.GOAL_MISMATCH);
  });

  test("does not refuse when the mapped Intelligence thread is not yet known", async () => {
    const result = await startUnattendedRun({
      actor,
      orgId: actor.orgId,
      channelId: "channel_1",
      threadId: "thread-1",
      prompt: "Follow up.",
      coworkerId: "researcher",
      deps: {
        lookupMapping: async () => ({
          threadId: "thread-1",
          channelId: "channel_1",
          userId: actor.id,
        }),
        waitForThread: async () => "missing",
        persistThread: async () => {
          throw new Error("must not persist before the coworker is built");
        },
        recordActivity: async () => {
          throw new Error(
            "must not record activity before the coworker is built",
          );
        },
        loadAgents: async () => [],
        loadTools: () => async () => [],
        resolveModelApiKey: async () => null,
        model: { provider: "openai", defaultModel: "gpt-4.1" },
        timeoutMs: 5_000,
      },
    });

    expect(result.outcome).toBe("refused");
    expect(result.error).not.toBe(UNATTENDED_REFUSALS.THREAD_MISSING);
    expect(result.error).toBe(
      "That coworker is not available to the acting user.",
    );
  });

  test("keep / revise / revert on this goal is visible on the next unattended turn", async () => {
    const result = await startUnattendedRun({
      actor,
      orgId: actor.orgId,
      channelId: "channel_1",
      threadId: "thread-1",
      prompt: "Follow up.",
      coworkerId: "researcher",
      deps: {
        lookupMapping: async () => ({
          threadId: "thread-1",
          channelId: "channel_1",
          userId: actor.id,
        }),
        waitForThread: async () => "idle",
        persistThread: async () => false,
        recordActivity: async () => undefined,
        loadAgents: async () => [
          {
            id: "researcher",
            name: "Researcher",
            type: "built_in",
            systemPrompt: "Research people.",
          },
        ],
        loadTools: () => async () => [],
        resolveModelApiKey: async () => "unused",
        model: { provider: "openai", defaultModel: "gpt-4.1" },
        timeoutMs: 5_000,
        goalLoopGuidance:
          "Goal loop (this goal — measure and improve on the same object):\nOwner's last decision on this goal: revise (was crm_send) at 2026-08-25T12:00:00.000Z. Note: Too aggressive.",
        runCoworker: async ({ messages }) => {
          const loop = messages.find(
            (message) =>
              message.role === "system" &&
              message.content.includes(
                "Owner's last decision on this goal: revise",
              ),
          );
          expect(loop).toBeDefined();
          return {
            text: "I will revise the send.",
            messages: [
              ...messages,
              {
                id: "assistant-1",
                role: "assistant",
                content: "I will revise the send.",
              },
            ],
          };
        },
      },
    });

    expect(result.text).toBe("I will revise the send.");
  });

  test("a persist failure is not a success", async () => {
    const result = await startUnattendedRun({
      actor,
      orgId: actor.orgId,
      channelId: "channel_1",
      threadId: "thread-1",
      prompt: "Find Ada.",
      coworkerId: "researcher",
      deps: {
        lookupMapping: async () => ({
          threadId: "thread-1",
          channelId: "channel_1",
          userId: actor.id,
        }),
        waitForThread: async () => "idle",
        persistThread: async () => false,
        recordActivity: async () => undefined,
        loadAgents: async () => [
          {
            id: "researcher",
            name: "Researcher",
            type: "built_in",
            systemPrompt: "Research people.",
          },
        ],
        loadTools: () => async () => [],
        resolveModelApiKey: async () => "unused",
        model: { provider: "openai", defaultModel: "gpt-4.1" },
        timeoutMs: 5_000,
        runCoworker: async ({ messages }) => ({
          text: "Ada is at Acme.",
          messages: [
            ...messages,
            {
              id: "assistant-1",
              role: "assistant",
              content: "Ada is at Acme.",
            },
          ],
        }),
      },
    });

    expect(result.outcome).toBe("failed");
    expect(result.persisted).toBe(false);
    expect(result.error).toBe(UNATTENDED_REFUSALS.PERSIST_FAILED);
    expect(result.text).toBe("Ada is at Acme.");
  });

  test("runs a built-in coworker through buildAgents / BuiltInAgent", async () => {
    const calls: unknown[] = [];
    const crmSearch: GrantedTool = {
      name: "crm_search",
      description: "Search CRM",
      parameters: z.object({ query: z.string().optional() }),
      execute: async (args) => {
        calls.push(args);
        return "Found Ada at Acme.";
      },
    };
    const activities: string[] = [];
    const seen: unknown[] = [];
    const originalRunAgent = BuiltInAgent.prototype.runAgent;
    BuiltInAgent.prototype.runAgent = async function () {
      seen.push(this);
      const text = await crmSearch.execute({ query: "Ada" });
      const next = [
        ...((
          this as {
            messages?: Array<{ id: string; role: string; content: string }>;
          }
        ).messages ?? []),
        { id: "assistant-1", role: "assistant" as const, content: text },
      ];
      this.setMessages?.(next);
      return { newMessages: next };
    };

    try {
      const result = await startUnattendedRun({
        actor,
        orgId: actor.orgId,
        channelId: "channel_1",
        threadId: "thread-1",
        prompt: "Find Ada.",
        coworkerId: "researcher",
        deps: {
          lookupMapping: async () => ({
            threadId: "thread-1",
            channelId: "channel_1",
            userId: actor.id,
          }),
          waitForThread: async () => "idle",
          persistThread: async () => true,
          recordActivity: async ({ activity }) => {
            activities.push(activity.text);
          },
          loadAgents: async () => [
            {
              id: "researcher",
              name: "Researcher",
              type: "built_in",
              systemPrompt: "Research people.",
            },
          ],
          loadTools: () => async () => [crmSearch],
          resolveModelApiKey: async () => "unused",
          model: { provider: "openai", defaultModel: "gpt-4.1" },
          timeoutMs: 5_000,
        },
      });

      expect(seen[0]).toBeInstanceOf(BuiltInAgent);
      expect(result.outcome).toBe("succeeded");
      expect(result.text).toBe("Found Ada at Acme.");
      expect(calls).toEqual([{ query: "Ada" }]);
      expect(activities).toEqual(["Found Ada at Acme."]);
      expect(result.crmRecordIds).toEqual([]);
    } finally {
      BuiltInAgent.prototype.runAgent = originalRunAgent;
    }
  });

  test("keeps CRM write ids from assistant text for the job outcome", async () => {
    const result = await startUnattendedRun({
      actor,
      orgId: actor.orgId,
      channelId: "channel_1",
      threadId: "thread-1",
      prompt: "Add Ada.",
      coworkerId: "researcher",
      deps: {
        lookupMapping: async () => ({
          threadId: "thread-1",
          channelId: "channel_1",
          userId: actor.id,
        }),
        waitForThread: async () => "idle",
        persistThread: async () => true,
        recordActivity: async () => undefined,
        loadAgents: async () => [
          {
            id: "researcher",
            name: "Researcher",
            type: "built_in",
            systemPrompt: "Research people.",
          },
        ],
        loadTools: () => async () => [],
        resolveModelApiKey: async () => "unused",
        model: { provider: "openai", defaultModel: "gpt-4.1" },
        timeoutMs: 5_000,
        runCoworker: async ({ messages }) => {
          const text = "Created person p_ada: Ada Lovelace. She is in the CRM.";
          return {
            text,
            messages: [
              ...messages,
              { id: "assistant-1", role: "assistant", content: text },
            ],
          };
        },
      },
    });

    expect(result.outcome).toBe("succeeded");
    expect(result.crmRecordIds).toEqual(["p_ada"]);
  });

  test("runs a remote_ag_ui coworker against an AG-UI endpoint", async () => {
    await using endpoint = fakeAgUiEndpoint();
    const profile = {
      id: "risk",
      name: "Risk",
      title: "Risk & Compliance",
      roleDescription: "Investigate policies.",
    };
    const activities: string[] = [];

    const result = await startUnattendedRun({
      actor,
      orgId: actor.orgId,
      channelId: "channel_1",
      threadId: "thread-1",
      prompt: "Sort these.",
      coworkerId: "risk",
      deps: {
        lookupMapping: async () => ({
          threadId: "thread-1",
          channelId: "channel_1",
          userId: actor.id,
        }),
        waitForThread: async () => "idle",
        persistThread: async () => true,
        recordActivity: async ({ activity }) => {
          activities.push(activity.text);
        },
        loadAgents: async () => [
          {
            id: "risk",
            name: "Risk",
            type: "remote_ag_ui",
            endpoint: endpoint.url,
            standingMessage: standingRoleMessage(profile),
          },
        ],
        loadTools: () => async () => [],
        resolveModelApiKey: async () => null,
        model: { provider: "openai", defaultModel: "gpt-4.1" },
        timeoutMs: 10_000,
      },
    });

    expect(result.outcome).toBe("succeeded");
    expect(result.text).toBe("Categorized.");
    expect(activities).toEqual(["Categorized."]);
    expect(endpoint.requests).toHaveLength(1);
    expect(HttpAgent).toBeDefined();
  });
});

describe("unattended tools", () => {
  test("built-in CRM tools execute from ActorContext with no Request", async () => {
    let seenActor: unknown;
    const tools = crmTools({
      crm: {
        search: async (input) => {
          seenActor = input.actor;
          return "Ada at Acme";
        },
        get: async () => "",
        create: async () => "",
        update: async () => "",
        send: async () => "",
      },
      botId: "researcher",
      actor: identifyActorFromContext(actor),
    });
    const search = tools.find((tool) => tool.name === "crm_search");
    expect(search).toBeDefined();
    const text = await search?.execute({ kind: "person", query: "Ada" });
    expect(text).toBe("Ada at Acme");
    expect(seenActor).toEqual({
      id: "user-1",
      role: "user",
      orgId: "org_local",
    });
  });

  test("keeps computer tools, drops gallery tools, and fails closed on user-oauth without a connection", async () => {
    const tools = serverSideToolsOnly([
      {
        name: "computer_click",
        description: "Click",
        parameters: z.object({}),
        execute: async () => "clicked",
      },
      {
        name: "gallery_chart",
        description: "Chart",
        parameters: z.object({}),
        execute: async () => "drawn",
      },
      {
        name: "crm_search",
        description: "Search",
        parameters: z.object({}),
        execute: async () => "ok",
      },
    ]);
    expect(tools.map((tool) => tool.name)).toEqual([
      "computer_click",
      "crm_search",
    ]);

    const gated = await gateUserOAuthTools(
      [
        {
          name: "gmail_send",
          description: "Send",
          parameters: z.object({}),
          execute: async () => "sent",
          requiresUserOAuth: true,
        },
      ],
      { id: "user-1", orgId: "org_local" },
    );
    expect(await gated[0]?.execute({})).toContain(REFUSAL_MARKER);
  });
});

function fakeAgUiEndpoint() {
  const requests: Record<string, unknown>[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const input = (await request.json()) as Record<string, unknown>;
      requests.push(input);
      const { threadId, runId } = input as { threadId: string; runId: string };
      const events = [
        { type: "RUN_STARTED", threadId, runId },
        { type: "TEXT_MESSAGE_START", messageId: "reply-1", role: "assistant" },
        {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "reply-1",
          delta: "Categorized.",
        },
        { type: "TEXT_MESSAGE_END", messageId: "reply-1" },
        { type: "RUN_FINISHED", threadId, runId },
      ];
      return new Response(
        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });

  return {
    requests,
    url: `http://localhost:${server.port}/ag-ui`,
    [Symbol.asyncDispose]: () => server.stop(true),
  };
}
