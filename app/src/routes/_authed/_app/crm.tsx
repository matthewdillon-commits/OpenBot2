import { IconPlus } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Toaster } from "sonner";
import { z } from "zod";
import { ContactRecord } from "@/components/crm/contact-record";
import {
  type CrmObjectMode,
  migrateLegacyCrmMode,
} from "@/components/crm/crm-object-nav";
import { CrmView } from "@/components/crm/crm-view";
import { DetailPanel } from "@/components/layout/detail-panel";
import { Button } from "@/components/ui/button";
import { crmPersonQueryOptions } from "@/lib/crm/queries";

/**
 * CRM is a table and a board. PageShell's prose column would wrap every row, so
 * this screen fills the main pane the way Agents fills it — header, then a
 * scannable index, with the record in DetailPanel. The OpenBot sidebar stays.
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
  person: z.string().optional(),
});

export const Route = createFileRoute("/_authed/_app/crm")({
  validateSearch: crmSearchSchema,
  component: CrmPage,
});

function CrmPage() {
  const { tab: tabParam, stage: stageParam, person: personId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const mode: CrmObjectMode = tabParam ?? "people";
  const stageFilter = stageParam?.trim() || "all";
  const [createOpen, setCreateOpen] = useState(false);
  const selected = useQuery({
    ...crmPersonQueryOptions(personId ?? ""),
    enabled: Boolean(personId),
  });

  function setSearch(next: {
    tab?: CrmObjectMode;
    stage?: string;
    person?: string;
  }) {
    const tab = next.tab ?? mode;
    const stage = next.stage ?? stageFilter;
    void navigate({
      search: {
        tab: tab === "people" ? undefined : tab,
        stage: tab === "people" && stage !== "all" ? stage : undefined,
        person: next.person,
      },
    });
  }

  return (
    <DetailPanel
      detail={
        personId ? (
          <ContactRecord
            personId={personId}
            onClose={() => setSearch({ person: undefined })}
          />
        ) : null
      }
      detailWidth={440}
      onClose={() => setSearch({ person: undefined })}
      open={Boolean(personId)}
      title={
        selected.data ? (
          <span className="truncate font-medium text-sm">
            {selected.data.name}
          </span>
        ) : null
      }
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <Toaster position="bottom-right" />
        <header className="shrink-0 px-4 pt-8 pb-4">
          <div className="flex items-center justify-between gap-4">
            <h1 className="font-bold text-2xl tracking-tight text-balance">
              CRM
            </h1>
            {mode === "people" ? (
              <Button
                onClick={() => setCreateOpen(true)}
                size="sm"
                variant="ghost"
              >
                <IconPlus />
                New person
              </Button>
            ) : null}
          </div>
          <p className="mt-2 max-w-prose text-pretty text-muted-foreground text-sm leading-relaxed">
            People, companies, and deals this organization is working.
          </p>
        </header>
        <CrmView
          createOpen={createOpen}
          mode={mode}
          personId={personId}
          stageFilter={stageFilter}
          onCreateOpenChange={setCreateOpen}
          onModeChange={(tab) => setSearch({ tab, person: personId })}
          onOpenPerson={(id) => setSearch({ person: id })}
          onStageChange={(stage) => setSearch({ stage, person: personId })}
        />
      </div>
    </DetailPanel>
  );
}
