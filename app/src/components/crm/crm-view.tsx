import { IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CampaignsPanel } from "@/components/crm/campaigns-panel";
import { CompaniesPanel } from "@/components/crm/companies-panel";
import { ConversationsPanel } from "@/components/crm/conversations-panel";
import {
  CRM_OBJECT_TABS,
  type CrmObjectMode,
  crmModeLabel,
} from "@/components/crm/crm-object-nav";
import {
  CrmEmpty,
  CrmError,
  CrmField,
  CrmStage,
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
import { Input } from "@/components/ui/input";
import { createCrmPersonMutationOptions } from "@/lib/crm/mutations";
import { type CrmPerson, crmPeopleQueryOptions } from "@/lib/crm/queries";
import { SPRING_NO_BOUNCE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { queryClient } from "@/query-client";

function createLabelFor(mode: CrmObjectMode): string | null {
  if (mode === "people") return "New person";
  if (mode === "companies") return "New company";
  if (mode === "opportunities") return "New opportunity";
  if (mode === "campaigns") return "New campaign";
  return null;
}

export function CrmView({
  mode,
  personId,
  createOpen,
  onCreateOpenChange,
  onModeChange,
  onOpenPerson,
}: {
  mode: CrmObjectMode;
  personId?: string;
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  onModeChange: (mode: CrmObjectMode) => void;
  onOpenPerson: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setSearchDebounced(search.trim()),
      220,
    );
    return () => window.clearTimeout(timer);
  }, [search]);

  const showSearch =
    mode === "people" || mode === "companies" || mode === "conversations";

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable=true]")
      ) {
        return;
      }
      if (!showSearch) return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSearch]);

  const people = useQuery(crmPeopleQueryOptions(searchDebounced));
  const rows = people.data?.items ?? [];
  const createLabel = createLabelFor(mode);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h1 className="sr-only">CRM</h1>
      <div className="flex shrink-0 flex-col gap-2 px-4 pt-4 pb-3 sm:flex-row sm:items-center">
        <ObjectTabs mode={mode} onSelect={onModeChange} />
        <div className="flex min-w-0 items-center gap-2">
          {showSearch ? (
            <Input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search"
              aria-label={`Search ${crmModeLabel(mode).toLowerCase()}`}
              aria-keyshortcuts="/"
              className="min-w-0 flex-1 sm:w-44 sm:flex-none sm:shrink-0"
            />
          ) : null}
          {createLabel ? (
            <Button
              onClick={() => onCreateOpenChange(true)}
              size="sm"
              variant="ghost"
              className="shrink-0"
            >
              <IconPlus />
              {createLabel}
            </Button>
          ) : null}
        </div>
      </div>

      {mode === "campaigns" ? (
        <CampaignsPanel
          createOpen={createOpen}
          onCreateOpenChange={onCreateOpenChange}
          onSelectContact={onOpenPerson}
        />
      ) : mode === "opportunities" ? (
        <DealBoard
          createOpen={createOpen}
          onCreateOpenChange={onCreateOpenChange}
        />
      ) : mode === "companies" ? (
        <CompaniesPanel
          search={searchDebounced}
          createOpen={createOpen}
          onCreateOpenChange={onCreateOpenChange}
        />
      ) : mode === "conversations" ? (
        <ConversationsPanel
          search={searchDebounced}
          onOpenContactRecord={onOpenPerson}
        />
      ) : people.isPending ? null : people.error ? (
        <CrmError
          label="people"
          error={people.error.message}
          onRetry={() => void people.refetch()}
        />
      ) : rows.length === 0 ? (
        <CrmEmpty
          title={searchDebounced ? "No matches" : "No people yet"}
          actionLabel={searchDebounced ? undefined : "New person"}
          onAction={
            searchDebounced ? undefined : () => onCreateOpenChange(true)
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-6">
          <PeopleIndex
            rows={rows}
            selectedId={personId ?? null}
            onSelect={onOpenPerson}
          />
        </div>
      )}

      <NewContactDialog
        open={mode === "people" && createOpen}
        onClose={() => onCreateOpenChange(false)}
        onCreated={(person) => {
          onOpenPerson(person.id);
          onCreateOpenChange(false);
          toast.success("Person created");
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
  const refs = useRef<Partial<Record<CrmObjectMode, HTMLButtonElement | null>>>(
    {},
  );

  function focusTab(next: CrmObjectMode) {
    onSelect(next);
    queueMicrotask(() => refs.current[next]?.focus());
  }

  return (
    <div
      className="flex w-full min-w-0 flex-1 gap-1 overflow-x-auto sm:w-auto"
      role="tablist"
      aria-label="CRM"
      onKeyDown={(event) => {
        const index = CRM_OBJECT_TABS.indexOf(mode);
        if (event.key === "ArrowRight") {
          event.preventDefault();
          focusTab(
            CRM_OBJECT_TABS[
              (index + 1 + CRM_OBJECT_TABS.length) % CRM_OBJECT_TABS.length
            ] ?? mode,
          );
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          focusTab(
            CRM_OBJECT_TABS[
              (index - 1 + CRM_OBJECT_TABS.length) % CRM_OBJECT_TABS.length
            ] ?? mode,
          );
        } else if (event.key === "Home") {
          event.preventDefault();
          focusTab(CRM_OBJECT_TABS[0] ?? mode);
        } else if (event.key === "End") {
          event.preventDefault();
          focusTab(CRM_OBJECT_TABS[CRM_OBJECT_TABS.length - 1] ?? mode);
        }
      }}
    >
      {CRM_OBJECT_TABS.map((id) => {
        const active = mode === id;
        return (
          <button
            key={id}
            ref={(node) => {
              refs.current[id] = node;
            }}
            type="button"
            role="tab"
            tabIndex={active ? 0 : -1}
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
                  shouldReduceMotion ? { duration: 0 } : SPRING_NO_BOUNCE
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
  onSelect,
}: {
  rows: CrmPerson[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <table className="crm-table">
      <thead>
        <tr>
          <th>Name</th>
          <th className="hidden sm:table-cell">Email</th>
          <th className="hidden sm:table-cell">Company</th>
          <th>Stage</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((person) => (
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
            <td>
              <span className="truncate font-medium" title={person.name}>
                {person.name}
              </span>
            </td>
            <td className="hidden sm:table-cell">
              <span
                className="truncate text-muted-foreground"
                title={person.emails[0]}
              >
                {person.emails[0] || "—"}
              </span>
            </td>
            <td className="hidden sm:table-cell">
              <span className="truncate">
                {person.company?.name || (
                  <span className="text-muted-foreground">—</span>
                )}
              </span>
            </td>
            <td>
              <CrmStage stageKey={person.stageKey} />
            </td>
          </tr>
        ))}
      </tbody>
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setFullName("");
      setEmail("");
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
      const person = await createPerson.mutateAsync({
        name,
        emails: email.trim() ? [email.trim()] : [],
        stageKey: "new",
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
          <DialogDescription className="sr-only">
            Add a name and optional email.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="mt-4">
          <form
            id="crm-new-person"
            className="flex flex-col gap-4"
            onSubmit={(event) => void submit(event)}
          >
            {error ? (
              <p
                className="text-destructive text-sm"
                id="crm-person-error"
                role="alert"
              >
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
                autoFocus
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
