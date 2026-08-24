import { IconCheck, IconChevronRight, IconSearch } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  connectComposioMutationOptions,
  disconnectComposioMutationOptions,
} from "@/lib/composio/mutations";
import {
  type ComposioPlugin,
  composioCatalogQueryOptions,
} from "@/lib/composio/queries";
import { cn } from "@/lib/utils";

const FEATURED = 8;
const PREVIEW = 4;

/**
 * Marketplace grid for Composio toolkits, most popular first.
 *
 * CRM and this screen fill the main pane rather than PageShell: a two-column catalogue
 * with search and category pills is a browsing surface, not a settings list.
 */
export function PluginCatalog({
  heading = "Plugins",
  showHeading = true,
}: {
  heading?: string;
  showHeading?: boolean;
}) {
  const queryClient = useQueryClient();
  const catalog = useQuery(composioCatalogQueryOptions());
  const connect = useMutation(connectComposioMutationOptions(queryClient));
  const disconnect = useMutation(
    disconnectComposioMutationOptions(queryClient),
  );
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const plugins = catalog.data?.plugins ?? [];
  const configured = catalog.data?.configured ?? true;
  const popularCategories = catalog.data?.categories ?? [];
  const searching = query.trim().length > 0;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return plugins.filter((plugin) => {
      if (
        needle &&
        !`${plugin.name} ${plugin.slug} ${plugin.description}`
          .toLowerCase()
          .includes(needle)
      ) {
        return false;
      }
      if (category === "All" || category === "Featured") return true;
      if (category === "Installed") return plugin.connected;
      return plugin.categories.some(
        (entry) => entry.toLowerCase() === category.toLowerCase(),
      );
    });
  }, [plugins, query, category]);

  const featured = filtered.slice(0, FEATURED);
  const sections = useMemo(() => {
    const seen = new Map<string, ComposioPlugin[]>();
    for (const plugin of filtered) {
      const names =
        plugin.categories.length > 0 ? plugin.categories : ["Other"];
      for (const name of names) {
        const list = seen.get(name) ?? [];
        list.push(plugin);
        seen.set(name, list);
      }
    }
    return [...seen.entries()].map(([name, items]) => ({ name, items }));
  }, [filtered]);
  const popularSections = sections.filter((section) =>
    popularCategories.some(
      (name) => name.toLowerCase() === section.name.toLowerCase(),
    ),
  );

  const pills = [
    "All",
    "Featured",
    ...(plugins.some((plugin) => plugin.connected) ? ["Installed"] : []),
    ...popularCategories,
  ];

  const connected = plugins.filter((plugin) => plugin.connected);

  async function onAdd(plugin: ComposioPlugin) {
    setError(null);
    if (plugin.connected && plugin.connectionId) {
      try {
        await disconnect.mutateAsync(plugin.connectionId);
      } catch (thrown) {
        setError((thrown as Error).message);
      }
      return;
    }
    try {
      const result = await connect.mutateAsync({
        slug: plugin.slug,
        callbackUrl: `${window.location.origin}/plugins`,
      });
      if (result.redirectUrl) {
        window.location.assign(result.redirectUrl);
      }
    } catch (thrown) {
      setError((thrown as Error).message);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showHeading ? (
        <div className="flex items-start justify-between gap-4">
          <h1 className="font-semibold text-2xl tracking-tight">{heading}</h1>
        </div>
      ) : null}

      {connected.length > 0 ? (
        <button
          className="mt-4 flex items-center gap-2 text-left text-muted-foreground text-sm hover:text-foreground"
          onClick={() => setCategory("Installed")}
          type="button"
        >
          <span className="-space-x-1.5 flex">
            {connected.slice(0, 4).map((plugin) => (
              <PluginMark key={plugin.slug} plugin={plugin} stacked />
            ))}
          </span>
          <span>{connected.length} installed</span>
          <IconChevronRight className="size-4" />
        </button>
      ) : null}

      <InputGroup className="mt-4 bg-muted/60">
        <InputGroupAddon>
          <IconSearch />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search plugins"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search plugins"
          value={query}
        />
      </InputGroup>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {pills.map((name) => (
          <button
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              category === name
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background text-foreground hover:bg-muted",
            )}
            key={name}
            onClick={() => setCategory(name)}
            type="button"
          >
            {name}
          </button>
        ))}
      </div>

      {error ? (
        <p className="mt-4 text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-6 min-h-0 flex-1 overflow-y-auto pb-10">
        {catalog.isPending ? (
          <p className="text-muted-foreground text-sm">Loading plugins…</p>
        ) : catalog.isError ? (
          <p className="text-destructive text-sm" role="alert">
            The plugin catalogue could not be loaded.
          </p>
        ) : !configured ? (
          <p className="text-muted-foreground text-sm">
            Set COMPOSIO_API_KEY to load the plugin catalogue.
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing matches that search.
          </p>
        ) : (
          <div className="flex flex-col gap-8">
            {searching ? (
              <CatalogSection
                busySlug={connect.variables?.slug ?? null}
                expanded
                name="Results"
                onAdd={onAdd}
                onToggle={() => undefined}
                plugins={filtered}
              />
            ) : (
              <>
                {(category === "All" || category === "Featured") &&
                featured.length > 0 ? (
                  <CatalogSection
                    busySlug={connect.variables?.slug ?? null}
                    expanded
                    name="Featured"
                    onAdd={onAdd}
                    onToggle={() => undefined}
                    plugins={featured}
                  />
                ) : null}
                {category === "All"
                  ? popularSections.map((section) => (
                      <CatalogSection
                        busySlug={connect.variables?.slug ?? null}
                        expanded={expanded[section.name] === true}
                        key={section.name}
                        name={section.name}
                        onAdd={onAdd}
                        onToggle={() =>
                          setExpanded((current) => ({
                            ...current,
                            [section.name]: !current[section.name],
                          }))
                        }
                        plugins={section.items}
                      />
                    ))
                  : null}
                {category !== "All" && category !== "Featured" ? (
                  <CatalogSection
                    busySlug={connect.variables?.slug ?? null}
                    expanded
                    name={category}
                    onAdd={onAdd}
                    onToggle={() => undefined}
                    plugins={filtered}
                  />
                ) : null}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CatalogSection({
  name,
  plugins,
  expanded,
  onToggle,
  onAdd,
  busySlug,
}: {
  name: string;
  plugins: ComposioPlugin[];
  expanded: boolean;
  onToggle: () => void;
  onAdd: (plugin: ComposioPlugin) => void;
  busySlug: string | null;
}) {
  const visible = expanded ? plugins : plugins.slice(0, PREVIEW);
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-medium text-base">{name}</h2>
        {plugins.length > PREVIEW && !expanded ? (
          <button
            className="text-muted-foreground text-sm hover:text-foreground"
            onClick={onToggle}
            type="button"
          >
            View all
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
        {visible.map((plugin) => (
          <PluginRow
            busy={busySlug === plugin.slug}
            key={plugin.slug}
            onAdd={() => onAdd(plugin)}
            plugin={plugin}
          />
        ))}
      </div>
    </section>
  );
}

function PluginRow({
  plugin,
  onAdd,
  busy,
}: {
  plugin: ComposioPlugin;
  onAdd: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <PluginMark plugin={plugin} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-sm">{plugin.name}</div>
        <p className="line-clamp-1 text-muted-foreground text-xs">
          {plugin.description || plugin.slug}
        </p>
      </div>
      {plugin.connected ? (
        <button
          className="inline-flex shrink-0 items-center gap-1 font-medium text-emerald-600 text-sm"
          disabled={busy}
          onClick={onAdd}
          type="button"
        >
          <IconCheck className="size-4" />
          Added
        </button>
      ) : (
        <Button
          className="shrink-0 rounded-full"
          disabled={busy}
          onClick={onAdd}
          size="sm"
          type="button"
          variant="secondary"
        >
          Add
        </Button>
      )}
    </div>
  );
}

function PluginMark({
  plugin,
  stacked = false,
}: {
  plugin: ComposioPlugin;
  stacked?: boolean;
}) {
  const letter = plugin.name.slice(0, 1).toUpperCase();
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted text-muted-foreground text-sm",
        stacked && "size-6 rounded-md border-background",
      )}
    >
      {plugin.logoUrl ? (
        <img alt="" className="size-full object-cover" src={plugin.logoUrl} />
      ) : (
        letter
      )}
    </span>
  );
}
