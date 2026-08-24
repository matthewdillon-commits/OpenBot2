import { IconCheck, IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { CampaignsPanel } from "@/components/crm/campaigns-panel";
import { CompaniesPanel } from "@/components/crm/companies-panel";
import { ConversationsPanel } from "@/components/crm/conversations-panel";
import {
  BotMark,
  faviconDomainFromContact,
  formatRelativeCreated,
  LinkedInMark,
} from "@/components/crm/crm-marks";
import {
  CRM_OBJECT_TABS,
  type CrmObjectMode,
  crmModeLabel,
} from "@/components/crm/crm-object-nav";
import {
  CrmAvatar,
  CrmEmpty,
  CrmError,
  CrmField,
  crmControlClassName,
} from "@/components/crm/crm-ui";
import { DealBoard } from "@/components/crm/deal-board";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SPRING_NO_BOUNCE } from "@/lib/motion";
import {
  ALL_SEGMENT,
  activeSegmentCount,
  activeSegmentLabel,
  createdPlacement,
  indexSegments,
} from "@/lib/crm/index-view";
import {
  createCrmPersonMutationOptions,
  findOrCreateCrmCompany,
  updateCrmPersonMutationOptions,
} from "@/lib/crm/mutations";
import { type CrmPerson, crmPeopleQueryOptions } from "@/lib/crm/queries";
import { CONTACT_STAGE_DEFS } from "@/lib/crm/stages";
import { cn } from "@/lib/utils";
import { queryClient } from "@/query-client";

export function CrmView({
  mode,
  stageFilter,
  personId,
  createOpen,
  onCreateOpenChange,
  onModeChange,
  onStageChange,
  onOpenPerson,
}: {
  mode: CrmObjectMode;
  stageFilter: string;
  personId?: string;
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  onModeChange: (mode: CrmObjectMode) => void;
  onStageChange: (stage: string) => void;
  onOpenPerson: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [companiesCreateOpen, setCompaniesCreateOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setSearchDebounced(search.trim()),
      220,
    );
    return () => window.clearTimeout(timer);
  }, [search]);

  const people = useQuery(
    crmPeopleQueryOptions(
      searchDebounced,
      stageFilter === ALL_SEGMENT ? "" : stageFilter,
    ),
  );
  const updatePerson = useMutation(updateCrmPersonMutationOptions(queryClient));
  const rows = people.data?.items ?? [];
  const segments = indexSegments(
    CONTACT_STAGE_DEFS,
    people.data?.stageCounts ?? {},
    people.data?.totalAllStages ?? people.data?.total ?? 0,
    "All people",
    stageFilter,
  );
  const allVisibleSelected =
    rows.length > 0 && rows.every((person) => selectedIds.has(person.id));
  const visibleSelectedCount = rows.filter((person) =>
    selectedIds.has(person.id),
  ).length;

  function toggleRow(id: string, shift: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (shift && lastClickedId) {
        const start = rows.findIndex((person) => person.id === lastClickedId);
        const end = rows.findIndex((person) => person.id === id);
        if (start >= 0 && end >= 0) {
          const [from, to] = start < end ? [start, end] : [end, start];
          for (let index = from; index <= to; index += 1) {
            const row = rows[index];
            if (row) next.add(row.id);
          }
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setLastClickedId(id);
  }

  function toggleSelectAllVisible() {
    setSelectedIds((current) => {
      if (allVisibleSelected) {
        const next = new Set(current);
        for (const person of rows) next.delete(person.id);
        return next;
      }
      const next = new Set(current);
      for (const person of rows) next.add(person.id);
      return next;
    });
  }

  async function bulkMoveStage(stageKey: string) {
    const ids = rows
      .filter((person) => selectedIds.has(person.id))
      .map((person) => person.id);
    try {
      await Promise.all(
        ids.map((id) =>
          updatePerson.mutateAsync({
            id,
            input: { stageKey, doNotContact: stageKey === "dnc" },
          }),
        ),
      );
      setSelectedIds(new Set());
      toast.success("Stage updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t move");
    }
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ObjectTabs mode={mode} onSelect={onModeChange} />

      {mode === "people" ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pb-3">
          <ViewsMenu
            segments={segments}
            activeKey={stageFilter}
            label={activeSegmentLabel(segments, stageFilter, "All people")}
            count={activeSegmentCount(segments, stageFilter)}
            countKnown={!people.isPending && !people.error}
            onSelect={onStageChange}
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search people"
            aria-label="Search people"
            className="max-w-xs"
          />
        </div>
      ) : mode !== "opportunities" && mode !== "campaigns" ? (
        <div className="flex shrink-0 items-center gap-2 px-4 pb-3">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`Search ${crmModeLabel(mode).toLowerCase()}`}
            aria-label={`Search ${crmModeLabel(mode).toLowerCase()}`}
            className="max-w-xs"
          />
          {mode === "companies" ? (
            <Button
              onClick={() => setCompaniesCreateOpen(true)}
              size="sm"
              variant="ghost"
            >
              <IconPlus />
              New company
            </Button>
          ) : null}
        </div>
      ) : null}

      {mode === "campaigns" ? (
        <CampaignsPanel onSelectContact={onOpenPerson} />
      ) : mode === "opportunities" ? (
        <DealBoard />
      ) : mode === "companies" ? (
        <CompaniesPanel
          search={searchDebounced}
          createOpen={companiesCreateOpen}
          onCreateOpenChange={setCompaniesCreateOpen}
        />
      ) : mode === "conversations" ? (
        <ConversationsPanel
          search={searchDebounced}
          onOpenContactRecord={onOpenPerson}
        />
      ) : people.isPending ? null : people.error ? (
        <CrmError label="people" onRetry={() => void people.refetch()} />
      ) : rows.length === 0 ? (
        <CrmEmpty
          title={searchDebounced ? "No matches" : "No people yet"}
          description={
            searchDebounced
              ? "Try a different name, company, or email."
              : "Add a person this organization is working with."
          }
          actionLabel={searchDebounced ? undefined : "New person"}
          onAction={
            searchDebounced ? undefined : () => onCreateOpenChange(true)
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-16">
          <PeopleIndex
            rows={rows}
            selectedId={personId ?? null}
            selectedIds={selectedIds}
            allVisibleSelected={allVisibleSelected}
            onSelect={onOpenPerson}
            onToggleRow={toggleRow}
            onToggleAll={toggleSelectAllVisible}
            onCreate={() => onCreateOpenChange(true)}
          />
        </div>
      )}

      {mode === "people" && visibleSelectedCount > 0 ? (
        <BulkActionBar
          count={visibleSelectedCount}
          busy={updatePerson.isPending}
          onMove={(stageKey) => void bulkMoveStage(stageKey)}
          onClear={() => setSelectedIds(new Set())}
        />
      ) : null}

      <NewContactDialog
        open={createOpen}
        onClose={() => onCreateOpenChange(false)}
        onCreated={(person) => {
          const placement = createdPlacement({
            stageFilter,
            search: searchDebounced,
          });
          onOpenPerson(person.id);
          onCreateOpenChange(false);
          toast.success(
            placement.inView(person.stageKey)
              ? "Person created"
              : `Created in ${activeSegmentLabel(segments, person.stageKey)}`,
          );
        }}
      />
    </div>
  );
}

function ObjectTabs({
  mode,
  onSelect,
}: {
  mode: CrmObjectMode;
  onSelect: (mode: CrmObjectMode) => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  return (
    <div
      className="flex shrink-0 gap-1 overflow-x-auto px-4 pb-3"
      role="tablist"
      aria-label="CRM objects"
    >
      {CRM_OBJECT_TABS.map((id) => {
        const active = mode === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(id)}
            className={cn(
              "relative rounded-lg px-2.5 py-1.5 text-sm transition-colors",
              "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              active
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active ? (
              <motion.span
                layoutId="crm-object-tab"
                className="absolute inset-0 rounded-lg bg-muted"
                transition={
                  shouldReduceMotion
                    ? { duration: 0 }
                    : SPRING_NO_BOUNCE
                }
              />
            ) : null}
            <span className="relative">{crmModeLabel(id)}</span>
          </button>
        );
      })}
    </div>
  );
}

function PeopleIndex({
  rows,
  selectedId,
  selectedIds,
  allVisibleSelected,
  onSelect,
  onToggleRow,
  onToggleAll,
  onCreate,
}: {
  rows: CrmPerson[];
  selectedId: string | null;
  selectedIds: Set<string>;
  allVisibleSelected: boolean;
  onSelect: (id: string) => void;
  onToggleRow: (id: string, shift: boolean) => void;
  onToggleAll: () => void;
  onCreate: () => void;
}) {
  return (
    <table className="crm-table">
      <thead>
        <tr>
          <th className="w-10">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={onToggleAll}
              aria-label="Select all visible people"
              className="crm-check"
            />
          </th>
          <th>Name</th>
          <th>Email</th>
          <th>Company</th>
          <th>Title</th>
          <th>Created</th>
          <th>Created by</th>
          <th>LinkedIn</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((person) => {
          const faviconDomain = faviconDomainFromContact({
            email: person.emails[0],
            companyName: person.company?.name,
            companyDomain: person.company?.domain,
          });
          return (
            <tr
              key={person.id}
              tabIndex={0}
              aria-selected={selectedId === person.id}
              aria-label={person.name}
              onClick={() => onSelect(person.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(person.id);
                }
              }}
            >
              <td
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(person.id)}
                  onChange={() => undefined}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleRow(person.id, event.shiftKey);
                  }}
                  aria-label={`Select ${person.name}`}
                  className="crm-check"
                />
              </td>
              <td>
                <span className="inline-flex min-w-0 items-center gap-2">
                  <CrmAvatar name={person.name} />
                  <span className="truncate font-medium" title={person.name}>
                    {person.name}
                  </span>
                </span>
              </td>
              <td>
                <span className="truncate text-muted-foreground" title={person.emails[0]}>
                  {person.emails[0] || "—"}
                </span>
              </td>
              <td>
                {person.company?.name ? (
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    {faviconDomain ? (
                      <img
                        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(faviconDomain)}&sz=32`}
                        alt=""
                        width={14}
                        height={14}
                        className="size-3.5 rounded-sm outline outline-foreground/10 -outline-offset-0"
                      />
                    ) : null}
                    <span className="truncate" title={person.company.name}>
                      {person.company.name}
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td>
                <span className="truncate text-muted-foreground">
                  {person.jobTitle || "—"}
                </span>
              </td>
              <td>
                <span className="whitespace-nowrap text-muted-foreground tabular-nums">
                  {formatRelativeCreated(person.createdAt)}
                </span>
              </td>
              <td>
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <BotMark />
                  System
                </span>
              </td>
              <td>
                {person.linkedinUrl ? (
                  <a
                    href={person.linkedinUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="inline-flex items-center gap-1 text-sm hover:underline"
                  >
                    <LinkedInMark className="size-3.5" />
                    Profile
                  </a>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={8} className="!border-0 !h-12">
            <Button onClick={onCreate} size="sm" variant="ghost">
              <IconPlus />
              Add person
            </Button>
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function NewContactDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (person: CrmPerson) => void;
}) {
  const createPerson = useMutation(createCrmPersonMutationOptions(queryClient));
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [stageKey, setStageKey] = useState("new");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setFullName("");
      setEmail("");
      setCompanyName("");
      setStageKey("new");
      setError(null);
    }
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const name = fullName.trim();
    if (!name) {
      setError("Name is required.");
      return;
    }
    try {
      let companyId: string | null = null;
      if (companyName.trim()) {
        const company = await findOrCreateCrmCompany(companyName.trim());
        companyId = company.id;
      }
      const person = await createPerson.mutateAsync({
        name,
        emails: email.trim() ? [email.trim()] : [],
        companyId,
        stageKey: stageKey || "new",
      });
      onCreated(person);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t create person");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New person</DialogTitle>
          <DialogDescription>
            A name is enough. Email and company can wait.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="mt-4">
          <form
            id="crm-new-person"
            className="flex flex-col gap-4"
            onSubmit={(event) => void submit(event)}
          >
            {error ? (
              <p className="text-destructive text-sm" id="crm-person-error" role="alert">
                {error}
              </p>
            ) : null}
            <CrmField htmlFor="crm-person-name" label="Name">
              <Input
                id="crm-person-name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="Full name"
                autoComplete="name"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "crm-person-error" : undefined}
              />
            </CrmField>
            <CrmField htmlFor="crm-person-email" label="Email">
              <Input
                id="crm-person-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@company.com"
                autoComplete="email"
              />
            </CrmField>
            <CrmField htmlFor="crm-person-company" label="Company">
              <Input
                id="crm-person-company"
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                placeholder="Company"
              />
            </CrmField>
            <CrmField htmlFor="crm-person-stage" label="Stage">
              <select
                id="crm-person-stage"
                value={stageKey}
                onChange={(event) => setStageKey(event.target.value)}
                className={crmControlClassName}
              >
                {CONTACT_STAGE_DEFS.map((stage) => (
                  <option key={stage.key} value={stage.key}>
                    {stage.label}
                  </option>
                ))}
              </select>
            </CrmField>
          </form>
        </DialogBody>
        <DialogFooter className="mt-4">
          <Button
            type="button"
            disabled={createPerson.isPending}
            onClick={onClose}
            size="sm"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            disabled={createPerson.isPending || !fullName.trim()}
            form="crm-new-person"
            size="sm"
            type="submit"
          >
            {createPerson.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkActionBar({
  count,
  busy,
  onMove,
  onClear,
}: {
  count: number;
  busy: boolean;
  onMove: (stageKey: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4">
      <div className="pointer-events-auto flex min-h-11 flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-md">
        <span
          className="ps-1 text-sm font-medium tabular-nums"
          aria-live="polite"
        >
          {count} selected
        </span>
        <select
          value=""
          disabled={busy}
          onChange={(event) => {
            if (event.target.value) onMove(event.target.value);
          }}
          aria-label="Move selected to stage"
          className={cn(crmControlClassName, "w-auto min-w-40")}
        >
          <option value="">{busy ? "Moving…" : "Move to stage…"}</option>
          {CONTACT_STAGE_DEFS.map((stage) => (
            <option key={stage.key} value={stage.key}>
              {stage.label}
            </option>
          ))}
        </select>
        <Button disabled={busy} onClick={onClear} size="sm" variant="ghost">
          Clear
        </Button>
      </div>
    </div>
  );
}

function ViewsMenu({
  segments,
  activeKey,
  label,
  count,
  countKnown,
  onSelect,
}: {
  segments: Array<{ key: string; label: string; count: number }>;
  activeKey: string;
  label: string;
  count: number;
  countKnown: boolean;
  onSelect: (key: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={`View: ${label}`}
            size="sm"
            variant="outline"
          />
        }
      >
        <span>{label}</span>
        {countKnown ? (
          <span className="tabular-nums text-muted-foreground">{count}</span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        {segments.map((segment) => (
          <DropdownMenuItem
            key={segment.key}
            onClick={() => onSelect(segment.key)}
          >
            <IconCheck
              className={cn(
                "size-3.5",
                segment.key === activeKey ? "opacity-100" : "opacity-0",
              )}
            />
            <span className="min-w-0 flex-1 truncate capitalize">
              {segment.label}
            </span>
            <span className="tabular-nums text-muted-foreground text-xs">
              {segment.count}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
