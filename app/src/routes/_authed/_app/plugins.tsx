import { createFileRoute } from "@tanstack/react-router";
import { PluginCatalog } from "@/components/plugins/plugin-catalog";

/**
 * Plugin marketplace. PageShell's prose column is for settings rows; this is a
 * searchable two-column catalogue, so it fills the main pane the way CRM does.
 * The sidebar already names the page.
 */
export const Route = createFileRoute("/_authed/_app/plugins")({
  component: PluginsPage,
});

function PluginsPage() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="mx-auto flex h-full w-full max-w-4xl min-h-0 flex-col px-6 py-6">
        <PluginCatalog />
      </div>
    </div>
  );
}
