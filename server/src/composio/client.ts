/**
 * Talk to Composio's REST API, and nothing else.
 *
 * The key travels in `x-api-key`, never in a query string a proxy log would print. Toolkits are
 * fetched usage-sorted so the catalogue can render most popular first without a second ranking
 * pass. Connections are always addressed with the organisation id as `user_id`, so two tenants
 * sharing a deployment never see each other's OAuth grants.
 */

import {
  attachConnections,
  type ComposioConnection,
  type ComposioPlugin,
  parseConnection,
  parseToolkit,
  topCategories,
} from "./map";

const COMPOSIO_API = "https://backend.composio.dev/api/v3.1";
const TOOLKIT_PAGE = 100;
const TOOLKIT_PAGES = 3;
const CATALOGUE_TTL_MS = 10 * 60 * 1000;

export type ComposioCatalog = {
  configured: boolean;
  plugins: ComposioPlugin[];
  categories: string[];
};

export type ComposioConnectResult = {
  redirectUrl: string | null;
  alreadyConnected: boolean;
};

type FetchLike = typeof fetch;

type CachedToolkits = {
  at: number;
  items: Omit<ComposioPlugin, "connected" | "connectionId">[];
};

export function composioClient(
  apiKey: string,
  fetchImpl: FetchLike = fetch,
  options: { gmailAuthConfigId?: string } = {},
) {
  const toolkitCache: { current: CachedToolkits | null } = { current: null };
  const authConfigBySlug = new Map<string, string>();
  const pinnedGmailAuthConfigId =
    options.gmailAuthConfigId?.trim() || undefined;

  async function request(
    path: string,
    init: RequestInit = {},
  ): Promise<{ ok: boolean; status: number; body: unknown }> {
    const headers = new Headers(init.headers);
    headers.set("x-api-key", apiKey);
    headers.set("accept", "application/json");
    if (init.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    const response = await fetchImpl(`${COMPOSIO_API}${path}`, {
      ...init,
      headers,
    });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = { message: text };
      }
    }
    return { ok: response.ok, status: response.status, body };
  }

  function composioMessage(body: unknown, fallback: string): string {
    const record = asRecord(body);
    const error = asRecord(record?.error);
    return (
      (typeof error?.message === "string" && error.message) ||
      (typeof record?.message === "string" && record.message) ||
      (typeof record?.error === "string" && record.error) ||
      fallback
    );
  }

  function itemsOf(body: unknown): unknown[] {
    const record = asRecord(body);
    if (!record) return [];
    if (Array.isArray(record.items)) return record.items;
    if (Array.isArray(record.data)) return record.data;
    if (Array.isArray(body)) return body as unknown[];
    return [];
  }

  function nextCursor(body: unknown): string | null {
    const record = asRecord(body);
    if (!record) return null;
    const cursor =
      record.next_cursor ??
      record.nextCursor ??
      asRecord(record.page)?.next_cursor;
    return typeof cursor === "string" && cursor ? cursor : null;
  }

  async function listToolkits(): Promise<
    Omit<ComposioPlugin, "connected" | "connectionId">[]
  > {
    const cached = toolkitCache.current;
    if (cached && Date.now() - cached.at < CATALOGUE_TTL_MS) {
      return cached.items;
    }
    const collected: Omit<ComposioPlugin, "connected" | "connectionId">[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < TOOLKIT_PAGES; page += 1) {
      const params = new URLSearchParams({
        sort_by: "usage",
        limit: String(TOOLKIT_PAGE),
      });
      if (cursor) params.set("cursor", cursor);
      const { ok, status, body } = await request(`/toolkits?${params}`);
      if (!ok) {
        throw new Error(
          composioMessage(body, `Composio refused the catalogue (${status}).`),
        );
      }
      for (const raw of itemsOf(body)) {
        const toolkit = parseToolkit(raw);
        if (toolkit) collected.push(toolkit);
      }
      cursor = nextCursor(body);
      if (!cursor) break;
    }
    toolkitCache.current = { at: Date.now(), items: collected };
    return collected;
  }

  async function listConnections(
    userId: string,
  ): Promise<ComposioConnection[]> {
    const params = new URLSearchParams({
      user_ids: userId,
      limit: "100",
    });
    const { ok, status, body } = await request(`/connected_accounts?${params}`);
    if (!ok) {
      throw new Error(
        composioMessage(
          body,
          `Composio refused the connection list (${status}).`,
        ),
      );
    }
    return itemsOf(body)
      .map(parseConnection)
      .filter((entry): entry is ComposioConnection => entry !== null)
      .filter((entry) => !entry.userId || entry.userId === userId);
  }

  async function findAuthConfigId(slug: string): Promise<string | null> {
    const cached = authConfigBySlug.get(slug);
    if (cached) return cached;
    const params = new URLSearchParams({ toolkit: slug, limit: "10" });
    const { ok, body } = await request(`/auth_configs?${params}`);
    if (!ok) return null;
    for (const raw of itemsOf(body)) {
      const record = asRecord(raw);
      if (!record) continue;
      const toolkit = asRecord(record.toolkit);
      const toolkitSlug =
        asString(toolkit?.slug) ??
        asString(record.toolkit_slug) ??
        asString(record.toolkitSlug);
      if (toolkitSlug && toolkitSlug !== slug) continue;
      const id =
        asString(record.id) ?? asString(asRecord(record.auth_config)?.id);
      if (id) {
        authConfigBySlug.set(slug, id);
        return id;
      }
    }
    return null;
  }

  async function createAuthConfig(slug: string): Promise<string> {
    const { ok, status, body } = await request("/auth_configs", {
      method: "POST",
      body: JSON.stringify({
        toolkit: { slug },
        auth_config: { type: "use_composio_managed_auth" },
      }),
    });
    if (!ok) {
      throw new Error(
        composioMessage(
          body,
          `Composio could not create an auth config (${status}).`,
        ),
      );
    }
    const record = asRecord(body) ?? {};
    const nested = asRecord(record.auth_config) ?? asRecord(record.authConfig);
    const id =
      asString(record.id) ??
      asString(nested?.id) ??
      asString(asRecord(record.data)?.id);
    if (!id) {
      throw new Error(
        "Composio created an auth config but did not return its id.",
      );
    }
    authConfigBySlug.set(slug, id);
    return id;
  }

  async function ensureAuthConfig(slug: string): Promise<string> {
    return (await findAuthConfigId(slug)) ?? createAuthConfig(slug);
  }

  return {
    async catalog(userId: string): Promise<ComposioCatalog> {
      const [toolkits, connections] = await Promise.all([
        listToolkits(),
        listConnections(userId),
      ]);
      const plugins = attachConnections(toolkits, connections);
      return {
        configured: true,
        plugins,
        categories: topCategories(plugins),
      };
    },

    async connect(
      userId: string,
      slug: string,
      callbackUrl: string,
    ): Promise<ComposioConnectResult> {
      const connections = await listConnections(userId);
      const existing = connections.find(
        (entry) => entry.slug === slug && entry.status !== "EXPIRED",
      );
      if (existing && existing.status === "ACTIVE") {
        return { redirectUrl: null, alreadyConnected: true };
      }
      const authConfigId =
        slug === "gmail" &&
        pinnedGmailAuthConfigId &&
        !isLoopbackCallback(callbackUrl)
          ? pinnedGmailAuthConfigId
          : await ensureAuthConfig(slug);
      const { ok, status, body } = await request("/connected_accounts/link", {
        method: "POST",
        body: JSON.stringify({
          user_id: userId,
          auth_config_id: authConfigId,
          callback_url: callbackUrl,
        }),
      });
      if (!ok) {
        throw new Error(
          composioMessage(
            body,
            `Composio could not start the connection (${status}).`,
          ),
        );
      }
      const record = asRecord(body) ?? {};
      const redirectUrl =
        asString(record.redirect_url) ??
        asString(record.redirectUrl) ??
        asString(asRecord(record.data)?.redirect_url);
      return { redirectUrl, alreadyConnected: false };
    },

    async disconnect(userId: string, connectionId: string): Promise<void> {
      const connections = await listConnections(userId);
      const match = connections.find((entry) => entry.id === connectionId);
      if (!match) {
        throw new Error("That connection is not this organisation's.");
      }
      const { ok, status, body } = await request(
        `/connected_accounts/${encodeURIComponent(connectionId)}`,
        { method: "DELETE" },
      );
      if (!ok && status !== 404) {
        throw new Error(
          composioMessage(
            body,
            `Composio could not disconnect that plugin (${status}).`,
          ),
        );
      }
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * A laptop callback cannot complete OAuth against a production Gmail auth config: that
 * config's Google redirect is the deployed host, not localhost. Skip the pin so Composio
 * managed auth can send the person back here.
 */
function isLoopbackCallback(callbackUrl: string): boolean {
  try {
    const host = new URL(callbackUrl).hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "[::1]" ||
      host === "::1"
    );
  } catch {
    return false;
  }
}
