import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  type CrmObjectMode,
  migrateLegacyCrmMode,
} from "@/components/crm/crm-object-nav";
import { CrmView } from "@/components/crm/crm-view";
import { CrmWorkbench } from "@/components/crm/crm-workbench";

/**
 * LimitlessAI-2's Twenty CRM, full-viewport — same workbench chrome as Nick's
 * AppShell when the CRM tab is open. OpenBot's channel sidebar does not wrap
 * this screen; the request is to copy that CRM exactly.
 */
const crmSearchSchema = z.object({
  tab: z.preprocess((value) => {
    if (value === "sends" || value === "activity") return "conversations";
    return (
      migrateLegacyCrmMode(typeof value === "string" ? value : null) ?? value
    );
  }, z
    .enum([
      "people",
      "companies",
      "opportunities",
      "campaigns",
      "conversations",
    ])
    .optional()),
  stage: z.string().optional(),
});

export const Route = createFileRoute("/_authed/crm")({
  validateSearch: crmSearchSchema,
  component: CrmPage,
});

function CrmPage() {
  const { tab: tabParam, stage: stageParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const mode: CrmObjectMode = tabParam ?? "people";
  const stageFilter = stageParam?.trim() || "all";

  return (
    <CrmWorkbench>
      <CrmView
        mode={mode}
        stageFilter={stageFilter}
        onModeChange={(next) => {
          void navigate({
            search: {
              tab: next === "people" ? undefined : next,
              stage:
                next === "people" && stageFilter !== "all"
                  ? stageFilter
                  : undefined,
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
    </CrmWorkbench>
  );
}
