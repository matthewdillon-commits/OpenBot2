/**
 * Server tools for a coworker run, built the same way an open-tab turn builds them.
 *
 * `loadToolsForActor` used to live only in the API process. An unattended run has to offer the
 * same CRM, search, knowledge, and granted MCP tools — and must not register computer_* or
 * gallery components, which still execute in the tab. Extracting the factory means the worker
 * cannot drift from the API list.
 *
 * User-oauth tools fail closed: if a tool is marked as needing a per-user connection and the
 * acting user has none, the execute path refuses rather than calling out as the org.
 */
import type { AgentActor } from "../agents/profile-types";
import type { AuditStore } from "../audit";
import type { ActionPolicy } from "../computer/policy";
import type { CrmGateway } from "../crm/gateway";
import { crmTools } from "../crm/tools";
import type { Database } from "../db/client";
import { askerFor, type KnowledgeSearch } from "../knowledge/search";
import { knowledgeSearchTool } from "../knowledge/tool";
import { orgIdOf } from "../orgs/constants";
import { REFUSAL_MARKER } from "../plugins/refusal";
import type { PluginStore } from "../plugins/store";
import { type GrantedTool, grantedTools } from "../plugins/tools";
import type { WebSearch } from "../web-search/tavily";
import { webSearchTool } from "../web-search/tool";

export type UserOAuthLookup = {
  hasConnection: (input: {
    userId: string;
    orgId: string;
    toolName: string;
  }) => Promise<boolean>;
};

export type LoadToolsForActorDeps = {
  pluginStore: PluginStore;
  knowledgeSearch: KnowledgeSearch;
  database: Database;
  auditStore: AuditStore;
  policyFor: (orgId: string) => ActionPolicy;
  crmGateway: CrmGateway;
  publicOrigin?: string;
  webSearch?: WebSearch;
  /**
   * Per-acting-user OAuth connections. Absent means none are connected, so any tool marked
   * `requiresUserOAuth` refuses. Org-scoped Composio / MCP grants are not user-oauth.
   */
  userOAuth?: UserOAuthLookup;
};

const FRONTEND_ONLY_TOOL = /^(computer_|gallery)/;

export function isFrontendOnlyTool(name: string): boolean {
  return FRONTEND_ONLY_TOOL.test(name);
}

export function serverSideToolsOnly(tools: GrantedTool[]): GrantedTool[] {
  return tools.filter((tool) => !isFrontendOnlyTool(tool.name));
}

const USER_OAUTH_REFUSAL = `${REFUSAL_MARKER} This tool needs a connected account for the acting user, and none is connected.`;

export async function gateUserOAuthTools(
  tools: GrantedTool[],
  actor: { id: string; orgId: string },
  lookup?: UserOAuthLookup,
): Promise<GrantedTool[]> {
  return Promise.all(
    tools.map(async (tool) => {
      if (!tool.requiresUserOAuth) return tool;
      const connected = lookup
        ? await lookup.hasConnection({
            userId: actor.id,
            orgId: actor.orgId,
            toolName: tool.name,
          })
        : false;
      if (connected) return tool;
      return {
        ...tool,
        execute: async () => USER_OAUTH_REFUSAL,
      };
    }),
  );
}

/**
 * What one Bot may call, for an explicit actor, with no Request.
 *
 * Same list as an open-tab turn: granted MCP, knowledge when there are documents, `search_web`
 * when a Tavily key exists, and CRM. The gateway still decides every acting call.
 */
export function createLoadToolsForActor(deps: LoadToolsForActorDeps) {
  return (actorId: string, orgId?: string) => async (botId: string) => {
    const scoped = orgIdOf({ orgId });
    const granted = await grantedTools({
      store: deps.pluginStore,
      botId,
      actorId,
      orgId: scoped,
    });
    const extra: GrantedTool[] = [];
    if (await deps.knowledgeSearch.anyDocuments(scoped)) {
      extra.push(
        knowledgeSearchTool({
          search: deps.knowledgeSearch,
          auditStore: deps.auditStore,
          asker: await askerFor(deps.database, actorId),
          botId,
          orgId: scoped,
        }),
      );
    }
    if (deps.webSearch) {
      extra.push(
        webSearchTool({
          search: deps.webSearch,
          auditStore: deps.auditStore,
          policy: () => deps.policyFor(scoped),
          botId,
          actorId,
          actorUserId: actorId,
          orgId: scoped,
        }),
      );
    }
    extra.push(
      ...crmTools({
        crm: deps.crmGateway,
        botId,
        actor: {
          id: actorId,
          role: "user",
          orgId: scoped,
        } satisfies AgentActor,
        publicOrigin: deps.publicOrigin,
      }),
    );
    const combined = extra.length === 0 ? granted : [...granted, ...extra];
    return gateUserOAuthTools(
      combined,
      { id: actorId, orgId: scoped },
      deps.userOAuth,
    );
  };
}
