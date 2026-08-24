/**
 * Shape Composio's toolkit and connection payloads into the catalogue the pages draw.
 *
 * The HTTP client keeps the wire format. This file is the one place that decides what a plugin
 * is to OpenBot: a slug, a name, a category list, and whether this organisation already connected
 * it. Tests pin the popularity order here so a change in field names cannot silently reorder the
 * page.
 */

export type ComposioPlugin = {
  slug: string;
  name: string;
  description: string;
  logoUrl: string | null;
  categories: string[];
  noAuth: boolean;
  connected: boolean;
  connectionId: string | null;
};

export type ComposioConnection = {
  id: string;
  slug: string;
  status: string;
  userId: string;
};

export type ComposioSection = {
  name: string;
  plugins: ComposioPlugin[];
};

const FEATURED_COUNT = 8;
/** How many Composio categories become filter pills. The rest stay reachable by search. */
const PILL_CATEGORY_COUNT = 8;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function categoryName(value: unknown): string | null {
  if (typeof value === "string") return asString(value);
  const record = asRecord(value);
  if (!record) return null;
  return asString(record.name) ?? asString(record.id);
}

/**
 * One toolkit as the catalogue needs it. Returns null when Composio omitted the slug, which is
 * the one field the connect call cannot invent.
 */
export function parseToolkit(
  raw: unknown,
): Omit<ComposioPlugin, "connected" | "connectionId"> | null {
  const record = asRecord(raw);
  if (!record) return null;
  const meta = asRecord(record.meta) ?? asRecord(record.metadata) ?? {};
  const slug =
    asString(record.slug) ?? asString(record.key) ?? asString(record.appName);
  const name = asString(record.name) ?? asString(record.displayName) ?? slug;
  if (!slug || !name) return null;

  const categorySource =
    record.categories ?? meta.categories ?? record.tags ?? [];
  const categories = Array.isArray(categorySource)
    ? categorySource
        .map(categoryName)
        .filter((entry): entry is string => entry !== null)
    : [];

  const uniqueCategories: string[] = [];
  for (const category of categories) {
    if (
      !uniqueCategories.some(
        (entry) => entry.toLowerCase() === category.toLowerCase(),
      )
    ) {
      uniqueCategories.push(category);
    }
  }

  return {
    slug,
    name,
    description:
      asString(record.description) ??
      asString(meta.description) ??
      asString(record.longDescription) ??
      "",
    logoUrl:
      asString(record.logo) ??
      asString(meta.logo) ??
      asString(record.logoUrl) ??
      asString(record.image) ??
      null,
    categories: uniqueCategories,
    noAuth: record.no_auth === true || record.noAuth === true,
  };
}

export function parseConnection(raw: unknown): ComposioConnection | null {
  const record = asRecord(raw);
  if (!record) return null;
  const toolkit = asRecord(record.toolkit) ?? asRecord(record.app) ?? {};
  const id =
    asString(record.id) ?? asString(record.nanoid) ?? asString(record.uuid);
  const slug =
    asString(toolkit.slug) ??
    asString(record.toolkit_slug) ??
    asString(record.toolkitSlug) ??
    asString(record.appName);
  if (!id || !slug) return null;
  return {
    id,
    slug,
    status: (asString(record.status) ?? "ACTIVE").toUpperCase(),
    userId:
      asString(record.user_id) ??
      asString(record.userId) ??
      asString(record.entity_id) ??
      "",
  };
}

export function isActiveConnection(connection: ComposioConnection): boolean {
  return (
    connection.status === "ACTIVE" ||
    connection.status === "CONNECTED" ||
    connection.status === "INITIATED"
  );
}

/**
 * Attach this organisation's connections to a usage-ordered toolkit list. The incoming order is
 * Composio's popularity order and is left alone — most used stays first.
 */
export function attachConnections(
  toolkits: Omit<ComposioPlugin, "connected" | "connectionId">[],
  connections: ComposioConnection[],
): ComposioPlugin[] {
  const bySlug = new Map<string, ComposioConnection>();
  for (const connection of connections) {
    if (!isActiveConnection(connection)) continue;
    if (!bySlug.has(connection.slug)) bySlug.set(connection.slug, connection);
  }
  return toolkits.map((toolkit) => {
    const connection = bySlug.get(toolkit.slug);
    return {
      ...toolkit,
      connected: connection !== undefined,
      connectionId: connection?.id ?? null,
    };
  });
}

/**
 * Featured is the first slice of the usage-ordered list. Remaining sections follow the first
 * time a category appears, so more popular plugins pull their category higher.
 */
export function groupCatalog(plugins: ComposioPlugin[]): {
  featured: ComposioPlugin[];
  sections: ComposioSection[];
} {
  const featured = plugins.slice(0, FEATURED_COUNT);
  const seen = new Map<string, ComposioPlugin[]>();
  for (const plugin of plugins) {
    const names = plugin.categories.length > 0 ? plugin.categories : ["Other"];
    for (const name of names) {
      const list = seen.get(name) ?? [];
      list.push(plugin);
      seen.set(name, list);
    }
  }
  const sections = [...seen.entries()].map(([name, items]) => ({
    name,
    plugins: items,
  }));
  return { featured, sections };
}

/**
 * The category pills a catalogue page can show without becoming a tag cloud.
 *
 * Composio sends dozens of overlapping tags. Rank by how many toolkits carry each name, skip
 * "Featured" (that slice has its own row), and keep a short list. Search still finds the rest.
 */
export function topCategories(
  plugins: ComposioPlugin[],
  limit = PILL_CATEGORY_COUNT,
): string[] {
  const counts = new Map<string, number>();
  for (const plugin of plugins) {
    for (const name of plugin.categories) {
      if (name.toLowerCase() === "featured") continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name);
}

export { FEATURED_COUNT, PILL_CATEGORY_COUNT };
