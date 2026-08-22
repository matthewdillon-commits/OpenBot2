import { describe, expect, test } from "bun:test";
import type { AuditEventInput, AuditStore } from "../src/audit";
import type { ActionPolicy } from "../src/computer/policy";
import { REFUSAL_MARKER } from "../src/plugins/tools";
import type { WebHit, WebSearch } from "../src/web-search/tavily";
import { WEB_SEARCH_TOOL_NAME, webSearchTool } from "../src/web-search/tool";

const PERMISSIVE: ActionPolicy = { mode: "enforce", deny: [], allow: ["true"] };

function recorder() {
  const written: AuditEventInput[] = [];
  const auditStore: AuditStore = {
    insert: async (event) => {
      written.push(event);
    },
  };
  return { written, auditStore };
}

function searchReturning(hits: WebHit[]): {
  search: WebSearch;
  asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    search: {
      search: async (query) => {
        asked.push(query);
        return hits;
      },
    },
  };
}

const oneHit: WebHit[] = [
  {
    title: "Example Domain",
    url: "https://example.com/",
    snippet: "This domain is for use in documentation examples.",
  },
];

describe("the web search tool", () => {
  test("hands back each page with its link and its passage", async () => {
    const { search } = searchReturning(oneHit);
    const tool = webSearchTool({
      search,
      auditStore: recorder().auditStore,
      policy: () => PERMISSIVE,
      botId: "general-assistant",
      actorId: "u_1",
    });

    const answer = await tool.execute({ query: "example domain" });

    expect(tool.name).toBe(WEB_SEARCH_TOOL_NAME);
    expect(answer).toContain("Example Domain");
    expect(answer).toContain("https://example.com/");
    expect(answer).toContain("documentation examples");
  });

  test("says nothing was found rather than returning an empty string", async () => {
    const { search } = searchReturning([]);
    const answer = await webSearchTool({
      search,
      auditStore: recorder().auditStore,
      policy: () => PERMISSIVE,
      botId: "general-assistant",
      actorId: "u_1",
    }).execute({ query: "something that is not on the web" });

    expect(answer).not.toBe("");
    expect(answer.toLowerCase()).toContain("no public page");
    expect(answer.toLowerCase()).toContain("do not cite");
  });

  test("writes a row naming the addresses and never quoting the passages", async () => {
    const { search } = searchReturning(oneHit);
    const { written, auditStore } = recorder();
    await webSearchTool({
      search,
      auditStore,
      policy: () => PERMISSIVE,
      botId: "general-assistant",
      actorId: "u_1",
      actorUserId: "u_1",
    }).execute({ query: "example domain" });

    expect(written).toHaveLength(1);
    const row = written[0];
    expect(row?.eventType).toBe("web.searched");
    expect(row?.actorUserId).toBe("u_1");
    expect(row?.payload.query).toBe("example domain");
    expect(row?.payload.urls).toEqual(["https://example.com/"]);
    expect(row?.payload.matched).toBe(1);

    const serialised = JSON.stringify(row?.payload);
    expect(serialised).not.toContain("documentation examples");
  });

  test("a deny rule never reaches Tavily", async () => {
    const { search, asked } = searchReturning(oneHit);
    const { written, auditStore } = recorder();
    const answer = await webSearchTool({
      search,
      auditStore,
      policy: () => ({
        mode: "enforce",
        deny: ['tool.name == "search_web"'],
        allow: ["true"],
      }),
      botId: "general-assistant",
      actorId: "u_1",
    }).execute({ query: "example domain" });

    expect(asked).toEqual([]);
    expect(answer.startsWith(REFUSAL_MARKER)).toBe(true);
    expect(written[0]?.eventType).toBe("web.search_refused");
    expect(written[0]?.payload.urls).toEqual([]);
  });

  test("dry-run records a refusal and still searches", async () => {
    const { search, asked } = searchReturning(oneHit);
    const { written, auditStore } = recorder();
    const answer = await webSearchTool({
      search,
      auditStore,
      policy: () => ({
        mode: "dry-run",
        deny: ['tool.name == "search_web"'],
        allow: ["true"],
      }),
      botId: "general-assistant",
      actorId: "u_1",
    }).execute({ query: "example domain" });

    expect(asked).toEqual(["example domain"]);
    expect(answer).toContain("https://example.com/");
    expect(written[0]?.eventType).toBe("web.searched");
    expect(written[0]?.payload.decision).toMatchObject({
      allowed: false,
      carriedOut: true,
    });
  });

  test("answers a malformed call instead of ending the run", async () => {
    const { search, asked } = searchReturning(oneHit);
    const { written, auditStore } = recorder();
    const answer = await webSearchTool({
      search,
      auditStore,
      policy: () => PERMISSIVE,
      botId: "general-assistant",
      actorId: "u_1",
    }).execute({ notAQuery: 12 });

    expect(answer).toContain("needs a query");
    expect(asked).toEqual([]);
    expect(written).toHaveLength(0);
  });

  test("a vendor that failed is not recorded as a search", async () => {
    const { written, auditStore } = recorder();
    const answer = await webSearchTool({
      search: {
        search: async () => {
          throw new Error("Tavily refused the search (429).");
        },
      },
      auditStore,
      policy: () => PERMISSIVE,
      botId: "general-assistant",
      actorId: "u_1",
    }).execute({ query: "example domain" });

    expect(answer).toContain("could not be run");
    expect(written).toHaveLength(0);
  });
});
