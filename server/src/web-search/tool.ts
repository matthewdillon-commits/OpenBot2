import { z } from "zod";
import { type AuditStore, recordAuditEvent } from "../audit";
import {
  type ActionPolicy,
  evaluateActionPolicy,
  type PolicyContext,
} from "../computer/policy";
import { type GrantedTool, REFUSAL_MARKER } from "../plugins/tools";
import type { WebSearch } from "./tavily";

/**
 * The public web, as something a Bot can call.
 *
 * WHY IT IS A TOOL rather than a browser. Opening a page is for acting on one: signing in, filling a
 * form, reading a thing that is not in any index. Looking something up is a search, and sending a
 * Bot to Chromium for a fact it could have read from five titles is how it ends up on a CAPTCHA.
 *
 * WHY TAVILY. The result is passages with links, which is what a citation needs. The call leaves
 * the deployment, so it is judged by the same policy MCP is and written on the trail the same way.
 * It is not MCP: there is no grant table and no vendor catalogue. Offered when this deployment has
 * a key, the way company knowledge is offered when there is something to search.
 *
 * SAYING NOTHING IS AN ANSWER. An empty result is a sentence, not an empty string, because a model
 * handed nothing fills the gap from training and cites a page that was not returned.
 */

export const WEB_SEARCH_TOOL_NAME = "search_web";

const NOTHING_FOUND =
  "No public page matched that. Say so plainly rather than answering from memory, and do not cite anything.";

const parameters = z.object({
  query: z
    .string()
    .describe(
      "What to look up on the public web, in the words a person would use.",
    ),
});

export function webSearchTool(options: {
  search: WebSearch;
  auditStore: AuditStore;
  policy: () => ActionPolicy;
  botId: string;
  actorId: string;
  /** A real `users` row, when there is one. The audit table has a foreign key to it. */
  actorUserId?: string;
}): GrantedTool {
  const { search, auditStore, policy, botId, actorId, actorUserId } = options;

  return {
    name: WEB_SEARCH_TOOL_NAME,
    description:
      "Search the public web and return matching pages with a link and a short passage from each. " +
      "Use this for current facts, news, and anything that is not in the company's own documents. " +
      "Do not open a browser just to look something up.",
    parameters,
    execute: async (args: unknown) => {
      const parsed = parameters.safeParse(args);
      if (!parsed.success) {
        return "That search needs a query: a short phrase describing what to look up.";
      }

      const query = parsed.data.query.trim();
      if (!query) {
        return "That search needs a query: a short phrase describing what to look up.";
      }

      const context: PolicyContext = {
        tool: { name: WEB_SEARCH_TOOL_NAME },
        bot: { id: botId },
        actor: { id: actorId },
        page: { url: "", host: "" },
        element: { ref: "", role: "", name: "", type: "" },
        key: "",
        file: { path: "", name: "", extension: "" },
        command: "",
        intent: "read_tool",
      };

      const verdict = evaluateActionPolicy(policy(), context);
      if (!verdict.forward) {
        await writeSearch(auditStore, {
          botId,
          actorId,
          actorUserId,
          query,
          urls: [],
          matched: 0,
          verdict,
        });
        return `${REFUSAL_MARKER} ${verdict.reason}`;
      }

      let hits: Awaited<ReturnType<WebSearch["search"]>>;
      try {
        hits = await search.search(query);
      } catch (error) {
        return error instanceof Error
          ? `The web search could not be run: ${error.message}`
          : "The web search could not be run.";
      }

      /*
       * After the search, like company knowledge: nothing is being acted on, and the interesting
       * fact is what came back. The query and the addresses, never the passages. A snippet is the
       * page's text under another name, and `content` is already on the redaction list; leaving it
       * off the row is cheaper than relying on that.
       */
      await writeSearch(auditStore, {
        botId,
        actorId,
        actorUserId,
        query,
        urls: hits.map((hit) => hit.url),
        matched: hits.length,
        verdict,
      });

      if (hits.length === 0) return NOTHING_FOUND;

      return hits
        .map((hit) => `${hit.title || hit.url}\n${hit.url}\n${hit.snippet}`)
        .join("\n\n");
    },
  };
}

async function writeSearch(
  auditStore: AuditStore,
  entry: {
    botId: string;
    actorId: string;
    actorUserId?: string;
    query: string;
    urls: string[];
    matched: number;
    verdict: {
      allowed: boolean;
      mode: string;
      matched: string | null;
      source: string;
      forward: boolean;
    };
  },
) {
  await recordAuditEvent(auditStore, {
    eventType: entry.verdict.forward ? "web.searched" : "web.search_refused",
    targetType: "web",
    targetId: entry.botId,
    ...(entry.actorUserId ? { actorUserId: entry.actorUserId } : {}),
    payload: {
      bot: entry.botId,
      actor: entry.actorId,
      query: entry.query,
      matched: entry.matched,
      urls: entry.urls,
      decision: {
        allowed: entry.verdict.allowed,
        mode: entry.verdict.mode,
        source: entry.verdict.source,
        rule: entry.verdict.matched,
        carriedOut: entry.verdict.forward,
      },
    },
  });
}
