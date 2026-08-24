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
import { crmPersonQueryOptions } from "@/lib/crm/queries";

/**
 * CRM is a table and a board. PageShell's prose column would wrap every row, so
 * this screen fills the main pane the way Agents fills it. The sidebar stays.
 * The sidebar already names the page; there is no second title.
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
  const { tab: tabParam, person: personId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const mode: CrmObjectMode = tabParam ?? "people";
  const [createOpen, setCreateOpen] = useState(false);
  const selected = useQuery({
    ...crmPersonQueryOptions(personId ?? ""),
    enabled: Boolean(personId),
  });

  function setSearch(next: { tab?: CrmObjectMode; person?: string }) {
    const tab = next.tab ?? mode;
    void navigate({
      search: {
        tab: tab === "people" ? undefined : tab,
        person: next.person,
      },
    });
  }

  return (
    <DetailPanel
      detail={personId ? <ContactRecord personId={personId} /> : null}
      detailWidth={400}
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
        <CrmView
          createOpen={createOpen}
          mode={mode}
          personId={personId}
          onCreateOpenChange={setCreateOpen}
          onModeChange={(tab) => {
            setCreateOpen(false);
            setSearch({ tab, person: personId });
          }}
          onOpenPerson={(id) => setSearch({ person: id })}
        />
      </div>
    </DetailPanel>
  );
}
