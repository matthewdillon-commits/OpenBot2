import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ContactNotes } from "@/components/crm/contact-notes";
import { ContactThread } from "@/components/crm/contact-thread";
import {
  type RecordDetailField,
  RecordPage,
} from "@/components/crm/record-page";
import { stageLabel } from "@/lib/crm/colors";
import {
  createCrmOpportunityMutationOptions,
  findOrCreateCrmCompany,
  updateCrmPersonMutationOptions,
} from "@/lib/crm/mutations";
import {
  type CrmPerson,
  crmOpportunitiesQueryOptions,
} from "@/lib/crm/queries";
import { CONTACT_STAGE_DEFS } from "@/lib/crm/stages";
import { queryClient } from "@/query-client";

function knownField(
  key: string,
  label: string,
  value?: string | null,
  inputType?: RecordDetailField["inputType"],
): RecordDetailField {
  return {
    key,
    label,
    value: value ?? null,
    inputType,
    state: value ? "known" : "blank",
  };
}

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
  person,
  fullscreen = false,
  onClose,
}: {
  person: CrmPerson;
  fullscreen?: boolean;
  onClose: () => void;
}) {
  const updatePerson = useMutation(updateCrmPersonMutationOptions(queryClient));
  const createDeal = useMutation(
    createCrmOpportunityMutationOptions(queryClient),
  );
  const deals = useQuery(crmOpportunitiesQueryOptions("", person.id));
  const [dealCreateOpen, setDealCreateOpen] = useState(false);
  const [dealName, setDealName] = useState(person.company?.name || person.name);
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
      ownerName: person.createdBy.name,
    };
  }, [openDeals, person.createdBy.name]);

  const details = [
    knownField("email", "Email", person.emails[0], "email"),
    knownField("phone", "Phone", person.phones[0], "tel"),
    knownField("title", "Title", person.jobTitle),
    knownField("companyName", "Company", person.company?.name),
    knownField("stageKey", "Stage", stageLabel(person.stageKey)),
    knownField("location", "Location", person.location),
    knownField("timezone", "Timezone", person.timezone),
    knownField("source", "Source", person.source?.replace(/_/g, " ") ?? null),
    knownField("linkedinUrl", "LinkedIn", person.linkedinUrl, "url"),
  ];

  const subtitle =
    [person.jobTitle, person.company?.name, person.location]
      .filter(Boolean)
      .join(" · ") ||
    person.emails[0] ||
    undefined;

  const logoColor = useMemo(() => {
    const seed = (person.company?.name || person.name || "?").trim();
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) {
      hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
    }
    return `oklch(0.92 0.04 ${hash % 360})`;
  }, [person.company?.name, person.name]);

  const links = useMemo(() => {
    const out: Array<{ label: string; href: string }> = [];
    if (person.linkedinUrl) {
      out.push({ label: "LinkedIn", href: person.linkedinUrl });
    }
    if (person.company?.domain) {
      const href = person.company.domain.startsWith("http")
        ? person.company.domain
        : `https://${person.company.domain}`;
      out.push({
        label: person.company.domain.replace(/^https?:\/\//, ""),
        href,
      });
    }
    if (person.emails[0]) {
      out.push({ label: "Email", href: `mailto:${person.emails[0]}` });
    }
    return out;
  }, [person.company?.domain, person.emails, person.linkedinUrl]);

  async function saveField(key: string, value: string) {
    if (key === "stageKey") return;
    try {
      if (key === "email") {
        await updatePerson.mutateAsync({
          id: person.id,
          input: { emails: value ? [value] : [] },
        });
        return;
      }
      if (key === "phone") {
        await updatePerson.mutateAsync({
          id: person.id,
          input: { phones: value ? [value] : [] },
        });
        return;
      }
      if (key === "title") {
        await updatePerson.mutateAsync({
          id: person.id,
          input: { jobTitle: value || null },
        });
        return;
      }
      if (key === "companyName") {
        if (!value) {
          await updatePerson.mutateAsync({
            id: person.id,
            input: { companyId: null },
          });
          return;
        }
        const company = await findOrCreateCrmCompany(value);
        await updatePerson.mutateAsync({
          id: person.id,
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
          id: person.id,
          input: { [key]: value || null },
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t save");
      throw err;
    }
  }

  async function moveStage(stageKey: string) {
    if (stageKey === person.stageKey) return;
    setMovingStage(true);
    try {
      await updatePerson.mutateAsync({
        id: person.id,
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
        personId: person.id,
        companyId: person.companyId,
      });
      setDealCreateOpen(false);
      toast.success("Deal created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t create deal");
    }
  }

  return (
    <RecordPage
      kind="contact"
      id={person.id}
      name={person.name}
      subtitle={subtitle}
      logoColor={logoColor}
      stats={stats}
      details={details}
      about={person.notes}
      links={links}
      compact={!fullscreen}
      tabCounts={{ deals: deals.data?.items.length }}
      timeline={<ContactThread personId={person.id} />}
      onAddDeal={() => {
        setDealName(person.company?.name || person.name);
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
      notesPanel={<ContactNotes personId={person.id} />}
      overviewFooter={
        <label className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
          <span className="ui-label-section shrink-0 !normal-case !tracking-normal">
            Relationship
          </span>
          <select
            className="ui-crm-select min-w-0 w-full flex-1 !min-h-9 !bg-[var(--bg-solid)]"
            value={person.stageKey}
            disabled={movingStage}
            onChange={(event) => void moveStage(event.target.value)}
          >
            {CONTACT_STAGE_DEFS.map((stage) => (
              <option key={stage.key} value={stage.key}>
                {stage.label}
              </option>
            ))}
          </select>
        </label>
      }
      onBack={onClose}
      onClose={onClose}
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
        <input
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="Deal name"
          className="ui-crm-search min-w-0 w-full px-2.5 text-13"
          onKeyDown={(event) => {
            if (event.key === "Enter") onCreate();
            if (event.key === "Escape") onCreateOpenChange(false);
          }}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={onCreate}
            className="ui-btn h-8 !min-h-0 !rounded-[8px] !px-2.5 text-12"
          >
            {busy ? "Creating…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => onCreateOpenChange(false)}
            className="h-8 rounded-[8px] px-2.5 text-12 text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (deals.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-13 text-[var(--text-muted)]">No deals yet.</p>
        <button
          type="button"
          onClick={() => onCreateOpenChange(true)}
          className="self-start text-12 font-medium text-[var(--text)] hover:opacity-80 active:scale-[0.96]"
        >
          Add deal
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => onCreateOpenChange(true)}
        className="self-start text-12 font-medium text-[var(--text)] hover:opacity-80 active:scale-[0.96]"
      >
        Add deal
      </button>
      <ul className="divide-y divide-[var(--hairline)]">
        {deals.map((deal) => (
          <li
            key={deal.id}
            className="flex items-baseline justify-between gap-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="truncate text-13 font-medium text-[var(--text)]">
                {deal.name}
              </p>
              <p className="mt-0.5 text-12 capitalize text-[var(--text-muted)]">
                {deal.stageKey}
              </p>
            </div>
            <span className="shrink-0 text-13 tabular-nums text-[var(--text-secondary)]">
              {formatUsd(deal.amountCents)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
