import { createFileRoute } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { z } from "zod";
import { CrmView } from "@/components/crm/crm-view";
import {
  migrateLegacyCrmMode,
  type CrmObjectMode,
} from "@/components/crm/crm-object-nav";

/**
 * LimitlessAI-2's Twenty CRM, full-bleed in the main pane.
 *
 * This is not a PageShell settings list. Nick's CRM is a table, a views menu,
 * a deal board you drag, and conversations derived from sends. The layout
 * skill does not apply — the request is to copy that screen exactly.
 */
const crmSearchSchema = z.object({
  tab: z.preprocess((value) => {
    if (value === "sends" || value === "activity") return "conversations";
    return migrateLegacyCrmMode(typeof value === "string" ? value : null) ?? value;
  }, z.enum(["people", "companies", "opportunities", "campaigns", "conversations"]).optional()),
  stage: z.string().optional(),
});

export const Route = createFileRoute("/_authed/_app/crm")({
  validateSearch: crmSearchSchema,
  component: CrmPage,
});

function CrmPage() {
  const { tab: tabParam, stage: stageParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const mode: CrmObjectMode = tabParam ?? "people";
  const stageFilter = stageParam?.trim() || "all";

  return (
    <div className="lai2-crm absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-white">
      <Toaster position="bottom-right" theme="light" />
      <CrmView
        mode={mode}
        stageFilter={stageFilter}
        onModeChange={(next) => {
          void navigate({
            search: {
              tab: next === "people" ? undefined : next,
              stage: next === "people" && stageFilter !== "all" ? stageFilter : undefined,
            },
          });
        }}
        onStageChange={(next) => {
          void navigate({
            search: {
              tab: mode === "people" ? undefined : mode,
              stage: next === "all" ? undefined : next,
            },
          });
        }}
      />
    </div>
  );
}
