import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ContactNotes } from "@/components/crm/contact-notes";
import { ContactThread } from "@/components/crm/contact-thread";
import { RecordPage } from "@/components/crm/record-page";
import { crmControlClassName, CrmError } from "@/components/crm/crm-ui";
import { stageLabel } from "@/lib/crm/colors";
import {
  createCrmOpportunityMutationOptions,
  findOrCreateCrmCompany,
  updateCrmPersonMutationOptions,
} from "@/lib/crm/mutations";
import {
  crmOpportunitiesQueryOptions,
  crmPersonQueryOptions,
} from "@/lib/crm/queries";
import { CONTACT_STAGE_DEFS } from "@/lib/crm/stages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { queryClient } from "@/query-client";

function isOpenDeal(stageKey: string): boolean {
  return stageKey !== "won" && stageKey !== "lost";
}

function formatUsd(amountCents?: number | null): string {
  if (amountCents == null || !Number.isFinite(amountCents)) return "—";
  const amount = amountCents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: amount >= 1000 ? 0 : 2,
  }).format(amount);
}

export function ContactRecord({
  personId,
}: {
  personId: string;
  onClose: () => void;
}) {
  const personQuery = useQuery(crmPersonQueryOptions(personId));
  const person = personQuery.data;
  const updatePerson = useMutation(updateCrmPersonMutationOptions(queryClient));
  const createDeal = useMutation(
    createCrmOpportunityMutationOptions(queryClient),
  );
  const deals = useQuery(crmOpportunitiesQueryOptions("", personId));
  const [dealCreateOpen, setDealCreateOpen] = useState(false);
  const [dealName, setDealName] = useState("");
  const [movingStage, setMovingStage] = useState(false);

  const openDeals = useMemo(
    () => (deals.data?.items ?? []).filter((deal) => isOpenDeal(deal.stage)),
    [deals.data?.items],
  );

  const stats = useMemo(() => {
    const openPipelineUsd = openDeals.reduce(
      (sum, deal) => sum + (deal.amountCents ?? 0) / 100,
      0,
    );
    const closes = openDeals
      .map((deal) => deal.expectedCloseAt)
      .filter(Boolean)
      .map((value) => new Date(value as string))
      .filter((date) => !Number.isNaN(date.getTime()))
      .sort((left, right) => left.getTime() - right.getTime());
    return {
      openDeals: openDeals.length,
      openPipelineUsd,
      nextClose: closes[0]
        ? closes[0].toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })
        : null,
    };
  }, [openDeals]);

  if (personQuery.isPending) return null;
  if (personQuery.error || !person) {
    return (
      <CrmError
        label="this person"
        onRetry={() => void personQuery.refetch()}
      />
    );
  }
  const record = person;

  const details = [
    {
      key: "email",
      label: "Email",
      value: record.emails[0] ?? null,
      inputType: "email" as const,
    },
    {
      key: "phone",
      label: "Phone",
      value: record.phones[0] ?? null,
      inputType: "tel" as const,
    },
    { key: "title", label: "Title", value: record.jobTitle },
    { key: "companyName", label: "Company", value: record.company?.name },
    { key: "stageKey", label: "Stage", value: stageLabel(record.stageKey) },
    { key: "location", label: "Location", value: record.location },
    { key: "timezone", label: "Timezone", value: record.timezone },
    {
      key: "source",
      label: "Source",
      value: record.source?.replace(/_/g, " ") ?? null,
    },
    {
      key: "linkedinUrl",
      label: "LinkedIn",
      value: record.linkedinUrl,
      inputType: "url" as const,
    },
  ];

  const subtitle =
    [record.jobTitle, record.company?.name, record.location]
      .filter(Boolean)
      .join(" · ") ||
    record.emails[0] ||
    undefined;

  const links: Array<{ label: string; href: string }> = [];
  if (record.linkedinUrl) {
    links.push({ label: "LinkedIn", href: record.linkedinUrl });
  }
  if (record.company?.domain) {
    const href = record.company.domain.startsWith("http")
      ? record.company.domain
      : `https://${record.company.domain}`;
    links.push({
      label: record.company.domain.replace(/^https?:\/\//, ""),
      href,
    });
  }
  if (record.emails[0]) {
    links.push({ label: "Email", href: `mailto:${record.emails[0]}` });
  }

  async function saveField(key: string, value: string) {
    if (key === "stageKey") return;
    try {
      if (key === "email") {
        await updatePerson.mutateAsync({
          id: record.id,
          input: { emails: value ? [value] : [] },
        });
        return;
      }
      if (key === "phone") {
        await updatePerson.mutateAsync({
          id: record.id,
          input: { phones: value ? [value] : [] },
        });
        return;
      }
      if (key === "title") {
        await updatePerson.mutateAsync({
          id: record.id,
          input: { jobTitle: value || null },
        });
        return;
      }
      if (key === "companyName") {
        if (!value) {
          await updatePerson.mutateAsync({
            id: record.id,
            input: { companyId: null },
          });
          return;
        }
        const company = await findOrCreateCrmCompany(value);
        await updatePerson.mutateAsync({
          id: record.id,
          input: { companyId: company.id },
        });
        return;
      }
      if (
        key === "location" ||
        key === "timezone" ||
        key === "source" ||
        key === "linkedinUrl"
      ) {
        await updatePerson.mutateAsync({
          id: record.id,
          input: { [key]: value || null },
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t save");
      throw err;
    }
  }

  async function moveStage(stageKey: string) {
    if (stageKey === record.stageKey) return;
    setMovingStage(true);
    try {
      await updatePerson.mutateAsync({
        id: record.id,
        input: { stageKey, doNotContact: stageKey === "dnc" },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t move");
    } finally {
      setMovingStage(false);
    }
  }

  async function createOpportunity() {
    const name = dealName.trim();
    if (!name) {
      toast.error("Name required");
      return;
    }
    try {
      await createDeal.mutateAsync({
        name,
        personId: record.id,
        companyId: record.companyId,
      });
      setDealCreateOpen(false);
      toast.success("Deal created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t create deal");
    }
  }

  return (
    <RecordPage
      name={record.name}
      subtitle={subtitle}
      stats={stats}
      details={details}
      about={record.notes}
      links={links}
      tabCounts={{ deals: deals.data?.items.length }}
      timeline={<ContactThread personId={record.id} />}
      onAddDeal={() => {
        setDealName(record.company?.name || record.name);
        setDealCreateOpen(true);
      }}
      dealsPanel={
        <DealsPanel
          deals={(deals.data?.items ?? []).map((deal) => ({
            id: deal.id,
            name: deal.name,
            stageKey: deal.stage,
            amountCents: deal.amountCents,
          }))}
          createOpen={dealCreateOpen}
          name={dealName}
          busy={createDeal.isPending}
          onNameChange={setDealName}
          onCreateOpenChange={setDealCreateOpen}
          onCreate={() => void createOpportunity()}
        />
      }
      notesPanel={<ContactNotes personId={record.id} />}
      overviewFooter={
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-xs font-medium">Relationship</span>
          <select
            className={crmControlClassName}
            value={record.stageKey}
            disabled={movingStage}
            onChange={(event) => void moveStage(event.target.value)}
            aria-label="Relationship stage"
          >
            {CONTACT_STAGE_DEFS.map((stage) => (
              <option key={stage.key} value={stage.key}>
                {stage.label}
              </option>
            ))}
          </select>
        </label>
      }
      onSaveField={saveField}
    />
  );
}

function DealsPanel({
  deals,
  createOpen,
  name,
  busy,
  onNameChange,
  onCreateOpenChange,
  onCreate,
}: {
  deals: Array<{
    id: string;
    name: string;
    stageKey: string;
    amountCents: number | null;
  }>;
  createOpen: boolean;
  name: string;
  busy: boolean;
  onNameChange: (value: string) => void;
  onCreateOpenChange: (open: boolean) => void;
  onCreate: () => void;
}) {
  if (createOpen) {
    return (
      <div className="flex flex-col gap-2">
        <Input
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="Deal name"
          aria-label="Deal name"
          onKeyDown={(event) => {
            if (event.key === "Enter") onCreate();
            if (event.key === "Escape") onCreateOpenChange(false);
          }}
        />
        <div className="flex items-center gap-2">
          <Button
            disabled={busy || !name.trim()}
            onClick={onCreate}
            size="sm"
          >
            {busy ? "Creating…" : "Save"}
          </Button>
          <Button
            onClick={() => onCreateOpenChange(false)}
            size="sm"
            variant="ghost"
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Button
        className="self-start"
        onClick={() => onCreateOpenChange(true)}
        size="sm"
        variant="ghost"
      >
        Add deal
      </Button>
      {deals.length === 0 ? (
        <p className="text-muted-foreground text-sm">No deals yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {deals.map((deal) => (
            <li
              key={deal.id}
              className="flex items-baseline justify-between gap-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{deal.name}</p>
                <p className="mt-0.5 capitalize text-muted-foreground text-xs">
                  {deal.stageKey}
                </p>
              </div>
              <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                {formatUsd(deal.amountCents)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
