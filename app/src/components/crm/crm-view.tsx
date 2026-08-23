import { Dialog } from "@base-ui/react/dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Briefcase,
  Building2,
  Calendar,
  Check,
  ChevronDown,
  ContactRound,
  List,
  Mail,
  MessagesSquare,
  Phone,
  Plus,
  Settings2,
  UserRound,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { CampaignsPanel } from "@/components/crm/campaigns-panel";
import { CompaniesPanel } from "@/components/crm/companies-panel";
import { ContactRecord } from "@/components/crm/contact-record";
import { ConversationsPanel } from "@/components/crm/conversations-panel";
import {
  avatarHue,
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
import { DealBoard } from "@/components/crm/deal-board";
import { stageLabel, stageStyle } from "@/lib/crm/colors";
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

const PREVIEW_WIDTH_KEY = "t1.crm.previewWidth";
const PREVIEW_WIDTH_MIN = 280;
const PREVIEW_WIDTH_MAX = 480;
const PREVIEW_WIDTH_DEFAULT = 340;

function clampPreviewWidth(px: number, containerW?: number) {
  let max = PREVIEW_WIDTH_MAX;
  if (containerW && containerW > 0) {
    max = Math.min(
      PREVIEW_WIDTH_MAX,
      Math.max(PREVIEW_WIDTH_MIN, Math.floor(containerW * 0.55)),
    );
  }
  return Math.min(max, Math.max(PREVIEW_WIDTH_MIN, Math.round(px)));
}

export function CrmView({
  mode,
  stageFilter,
  onModeChange,
  onStageChange,
}: {
  mode: CrmObjectMode;
  stageFilter: string;
  onModeChange: (mode: CrmObjectMode) => void;
  onStageChange: (stage: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [viewsOpen, setViewsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [companiesCreateOpen, setCompaniesCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recordMode, setRecordMode] = useState<"preview" | "full">("preview");
  const [previewWidth, setPreviewWidth] = useState(PREVIEW_WIDTH_DEFAULT);
  const [previewResizing, setPreviewResizing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const crmSplitRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setSearchDebounced(search.trim()),
      220,
    );
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(PREVIEW_WIDTH_KEY));
      if (Number.isFinite(saved) && saved > 0) {
        setPreviewWidth(clampPreviewWidth(saved));
      }
    } catch {
      // ignore
    }
  }, []);

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
    "All People",
    stageFilter,
  );
  const segmentLabel = activeSegmentLabel(segments, stageFilter, "All People");
  const segmentCount = activeSegmentCount(segments, stageFilter);
  const selected = rows.find((person) => person.id === selectedId) ?? null;
  const railOpen = Boolean(selected) && recordMode === "preview";
  const visibleSelectedCount = rows.filter((person) =>
    selectedIds.has(person.id),
  ).length;
  const allVisibleSelected =
    rows.length > 0 && rows.every((person) => selectedIds.has(person.id));

  function selectContact(id: string | null) {
    setSelectedId(id);
    setRecordMode("preview");
  }

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

  const onPreviewResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = previewWidth;
      const container = crmSplitRef.current?.getBoundingClientRect().width;
      setPreviewResizing(true);
      const onMove = (move: PointerEvent) => {
        setPreviewWidth(
          clampPreviewWidth(startWidth + (startX - move.clientX), container),
        );
      };
      const onUp = () => {
        setPreviewResizing(false);
        setPreviewWidth((width) => {
          const next = clampPreviewWidth(width, container);
          try {
            localStorage.setItem(PREVIEW_WIDTH_KEY, String(next));
          } catch {
            // ignore
          }
          return next;
        });
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [previewWidth],
  );

  function onPreviewResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const delta = event.key === "ArrowLeft" ? 16 : -16;
      setPreviewWidth((width) => {
        const next = clampPreviewWidth(
          width + delta,
          crmSplitRef.current?.getBoundingClientRect().width,
        );
        try {
          localStorage.setItem(PREVIEW_WIDTH_KEY, String(next));
        } catch {
          // ignore
        }
        return next;
      });
    }
  }

  return (
    <div
      ref={crmSplitRef}
      className={cn(
        "ui-crm-split ui-crm-split-twenty relative flex h-full min-h-0 flex-row overflow-hidden bg-white",
        previewResizing && "ui-crm-split-resizing",
      )}
    >
      <div
        className={cn(
          "ui-crm-pane ui-crm-pane-twenty relative flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden bg-white",
          railOpen && "min-w-0 basis-0",
        )}
      >
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-white">
          <div className="ui-twenty-header">
            <div className="ui-twenty-header-lead">
              {mode === "people" ? (
                <ContactRound
                  className="h-4 w-4 shrink-0 text-[color:var(--t-color-blue)]"
                  strokeWidth={1.6}
                  aria-hidden
                />
              ) : mode === "companies" ? (
                <Building2
                  className="h-4 w-4 shrink-0 text-[color:var(--t-color-blue)]"
                  strokeWidth={1.6}
                  aria-hidden
                />
              ) : mode === "conversations" ? (
                <MessagesSquare
                  className="h-4 w-4 shrink-0 text-[color:var(--t-color-blue)]"
                  strokeWidth={1.6}
                  aria-hidden
                />
              ) : null}
              <h2 className="min-w-0 flex-1 truncate">{crmModeLabel(mode)}</h2>
              {mode !== "people" ? (
                <div className="ui-crm-search ui-twenty-header-search ms-1 px-2.5">
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search…"
                    aria-label={`Search ${crmModeLabel(mode).toLowerCase()}`}
                  />
                </div>
              ) : null}
            </div>
            {mode === "people" ? (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="ui-twenty-new-btn shrink-0"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                New Person
              </button>
            ) : mode === "companies" ? (
              <button
                type="button"
                onClick={() => setCompaniesCreateOpen(true)}
                className="ui-twenty-new-btn shrink-0"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                New
              </button>
            ) : null}
          </div>
          <ObjectTabs mode={mode} onSelect={onModeChange} />
          {mode === "people" ? (
            <div className="ui-twenty-toolbar">
              <ViewsMenu
                segments={segments}
                activeKey={stageFilter}
                label={segmentLabel}
                count={segmentCount}
                countKnown={!people.isPending && !people.error}
                open={viewsOpen}
                onOpenChange={setViewsOpen}
                onSelect={(key) => {
                  onStageChange(key);
                  setViewsOpen(false);
                }}
              />
            </div>
          ) : null}

          {mode === "campaigns" ? (
            <CampaignsPanel
              onSelectContact={(id) => {
                onModeChange("people");
                selectContact(id);
              }}
            />
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
              onOpenContactRecord={(id) => {
                onModeChange("people");
                selectContact(id);
              }}
            />
          ) : people.isPending ? null : people.error ? (
            <CrmLoadError
              label="contacts"
              onRetry={() => void people.refetch()}
            />
          ) : (
            <div className="ui-crm-index-scroll min-h-0 min-w-0 flex-1 overflow-auto">
              {rows.length === 0 ? (
                <CrmEmptyState
                  searching={Boolean(searchDebounced)}
                  onCreate={() => setCreateOpen(true)}
                />
              ) : (
                <PeopleIndex
                  rows={rows}
                  selectedId={selectedId}
                  selectedIds={selectedIds}
                  allVisibleSelected={allVisibleSelected}
                  onSelect={selectContact}
                  onToggleRow={toggleRow}
                  onToggleAll={toggleSelectAllVisible}
                  onCreate={() => setCreateOpen(true)}
                />
              )}
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
        </div>
      </div>

      {railOpen && selected ? (
        <>
          <div
            aria-hidden
            className="fixed inset-0 z-30 bg-[var(--scrim)] backdrop-blur-[2px] md:hidden"
            onClick={() => selectContact(null)}
          />
          {/* biome-ignore lint/a11y/useSemanticElements: a resize grip is not a horizontal rule */}
          <div
            className="ui-chat-resize max-md:hidden"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize contact panel"
            aria-valuemin={PREVIEW_WIDTH_MIN}
            aria-valuemax={PREVIEW_WIDTH_MAX}
            aria-valuenow={previewWidth}
            tabIndex={0}
            data-active={previewResizing ? "true" : undefined}
            onPointerDown={onPreviewResizePointerDown}
            onKeyDown={onPreviewResizeKeyDown}
          >
            <span className="ui-chat-resize-grip" aria-hidden />
          </div>
          <div
            className={cn(
              "ui-crm-preview flex h-full min-h-0 flex-col overflow-hidden",
              "max-md:absolute max-md:inset-0 max-md:z-40 max-md:w-full",
            )}
            style={
              {
                "--crm-preview-w": `${previewWidth}px`,
                flex: `0 0 ${previewWidth}px`,
                width: previewWidth,
                minWidth: previewWidth,
                maxWidth: previewWidth,
              } as CSSProperties
            }
          >
            <ContactRecord
              person={selected}
              fullscreen={false}
              onClose={() => selectContact(null)}
            />
          </div>
        </>
      ) : null}

      {selected && recordMode === "full" ? (
        <div className="absolute inset-0 z-40 flex min-h-0 w-full flex-col overflow-hidden p-2">
          <ContactRecord
            person={selected}
            fullscreen
            onClose={() => selectContact(null)}
          />
        </div>
      ) : null}

      <NewContactDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(person) => {
          const placement = createdPlacement({
            stageFilter,
            search: searchDebounced,
          });
          const inView = placement.inView(person.stageKey);
          selectContact(person.id);
          setCreateOpen(false);
          toast.success(
            inView
              ? "Contact created"
              : `Contact created in ${activeSegmentLabel(segments, person.stageKey)}`,
          );
        }}
      />
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
    <>
      <table className="ui-crm-table ui-crm-table-twenty">
        <thead>
          <tr>
            <th className="!w-[var(--t-table-checkbox-column-width)] !ps-2 !pe-0">
              <label className="ui-twenty-check-hit">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={onToggleAll}
                  aria-label="Select all visible contacts"
                  className="ui-twenty-check"
                />
              </label>
            </th>
            <IconColumnHeader icon={UserRound} label="Name" />
            <IconColumnHeader
              icon={Mail}
              label="Emails"
              className="ui-crm-col-email"
            />
            <IconColumnHeader
              icon={Settings2}
              label="Created by"
              className="ui-crm-col-meta"
            />
            <IconColumnHeader icon={Building2} label="Company" />
            <IconColumnHeader
              icon={Phone}
              label="Phones"
              className="ui-crm-col-aux"
            />
            <IconColumnHeader
              icon={Calendar}
              label="Creation date"
              className="ui-crm-col-aux"
            />
            <IconColumnHeader
              icon={Briefcase}
              label="Job Title"
              className="ui-crm-col-aux"
            />
            <th className="ui-crm-col-aux">
              <span className="inline-flex items-center gap-1.5">
                <LinkedInMark className="h-3.5 w-3.5 opacity-70" />
                Linkedin
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((person) => {
            const initial = person.name.trim().charAt(0).toUpperCase() || "?";
            const avatarBg = `oklch(0.72 0.14 ${avatarHue(person.name)})`;
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
                className={cn(
                  "cursor-pointer outline-none",
                  selectedIds.has(person.id) &&
                    selectedId !== person.id &&
                    "bg-[var(--bg-muted)]",
                )}
              >
                <td
                  className="!w-[var(--t-table-checkbox-column-width)] !ps-2 !pe-0"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <label className="ui-twenty-check-hit">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(person.id)}
                      onChange={() => undefined}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleRow(person.id, event.shiftKey);
                      }}
                      aria-label={`Select ${person.name}`}
                      className="ui-twenty-check"
                    />
                  </label>
                </td>
                <td>
                  <span className="ui-crm-pill ui-crm-pill-name">
                    <span
                      className="ui-twenty-avatar"
                      style={{ background: avatarBg }}
                      aria-hidden
                    >
                      {initial}
                    </span>
                    <span className="min-w-0 truncate" title={person.name}>
                      {person.name}
                    </span>
                  </span>
                </td>
                <td className="ui-crm-col-email">
                  {person.emails[0] ? (
                    <span className="ui-crm-pill" title={person.emails[0]}>
                      <span>{person.emails[0]}</span>
                    </span>
                  ) : null}
                </td>
                <td className="ui-crm-col-meta">
                  <span className="ui-crm-pill ui-twenty-actor">
                    <BotMark />
                    <span>System</span>
                  </span>
                </td>
                <td>
                  {person.company?.name ? (
                    <span className="ui-crm-pill" title={person.company.name}>
                      {faviconDomain ? (
                        <img
                          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(faviconDomain)}&sz=32`}
                          alt=""
                          width={14}
                          height={14}
                          className="ui-crm-company-favicon"
                        />
                      ) : (
                        <span className="ui-crm-company-mark" aria-hidden>
                          {person.company.name.trim().charAt(0).toUpperCase()}
                        </span>
                      )}
                      <span>{person.company.name}</span>
                    </span>
                  ) : null}
                </td>
                <td className="ui-crm-col-aux">
                  {person.phones[0] ? (
                    <span className="ui-crm-pill">
                      <span>{person.phones[0]}</span>
                    </span>
                  ) : null}
                </td>
                <td className="ui-crm-col-aux">
                  <span className="ui-twenty-date">
                    {formatRelativeCreated(person.createdAt)}
                  </span>
                </td>
                <td className="ui-crm-col-aux">
                  {person.jobTitle ? (
                    <span className="ui-crm-pill">
                      <span>{person.jobTitle}</span>
                    </span>
                  ) : null}
                </td>
                <td className="ui-crm-col-aux">
                  {person.linkedinUrl ? (
                    <a
                      href={person.linkedinUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => event.stopPropagation()}
                      className="ui-crm-pill"
                      aria-label="LinkedIn profile"
                    >
                      <LinkedInMark className="h-3.5 w-3.5" />
                      <span>LinkedIn</span>
                    </a>
                  ) : null}
                </td>
              </tr>
            );
          })}
          <tr className="ui-crm-add-row">
            <td />
            <td colSpan={8}>
              <button
                type="button"
                onClick={onCreate}
                className="ui-twenty-add-new"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.6} />
                Add New
              </button>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr className="ui-crm-calc-tr">
            <td />
            <td>
              <button type="button" className="ui-twenty-link-btn !ps-0">
                Calculate
                <ChevronDown className="ms-0.5 h-3 w-3 opacity-50" />
              </button>
            </td>
            <td className="ui-crm-col-email">
              <span className="ui-crm-calc-stat">
                Unique of Emails{" "}
                <strong>
                  {
                    new Set(
                      rows.flatMap((person) => person.emails).filter(Boolean),
                    ).size
                  }
                </strong>
              </span>
            </td>
            <td className="ui-crm-col-meta" />
            <td />
            <td className="ui-crm-col-aux">
              <span className="ui-crm-calc-stat">
                Empty of Phones{" "}
                <strong>
                  {rows.length
                    ? `${Math.round(
                        (rows.filter((person) => person.phones.length === 0)
                          .length /
                          rows.length) *
                          100,
                      )}%`
                    : "0%"}
                </strong>
              </span>
            </td>
            <td className="ui-crm-col-aux">
              <span className="ui-crm-calc-stat">
                Earliest{" "}
                <strong>
                  {formatRelativeCreated(
                    rows
                      .map((person) => person.createdAt)
                      .filter(Boolean)
                      .sort()[0] || null,
                  )}
                </strong>
              </span>
            </td>
            <td className="ui-crm-col-aux" />
            <td className="ui-crm-col-aux" />
          </tr>
        </tfoot>
      </table>
      <ul className="ui-crm-cards">
        {rows.map((person) => (
          <ContactCard
            key={person.id}
            person={person}
            open={selectedId === person.id}
            selected={selectedIds.has(person.id)}
            onOpen={() => onSelect(person.id)}
            onToggleSelect={() => onToggleRow(person.id, false)}
          />
        ))}
        <li className="px-1 pt-1">
          <button
            type="button"
            onClick={onCreate}
            className="ui-twenty-add-new !h-11"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.6} />
            Add New
          </button>
        </li>
      </ul>
    </>
  );
}

function ContactCard({
  person,
  open,
  selected,
  onOpen,
  onToggleSelect,
}: {
  person: CrmPerson;
  open: boolean;
  selected: boolean;
  onOpen: () => void;
  onToggleSelect: () => void;
}) {
  const stage = stageStyle(person.stageKey);
  return (
    <li className="ui-crm-card" data-selected={selected} data-open={open}>
      <button type="button" onClick={onOpen} className="ui-crm-card-open">
        <span className="ui-crm-card-name">
          <span
            className="ui-twenty-avatar"
            style={{
              background: `oklch(0.72 0.14 ${avatarHue(person.name)})`,
            }}
            aria-hidden
          >
            {person.name.trim().charAt(0).toUpperCase() || "?"}
          </span>
          <span>{person.name}</span>
        </span>
        <span
          className={cn(
            "ui-crm-card-line",
            !person.emails[0] && "ui-crm-card-empty",
          )}
        >
          {person.emails[0] || "No email"}
        </span>
        <span className="ui-crm-card-meta">
          {person.company?.name ? (
            <span className="ui-crm-pill" title={person.company.name}>
              <span>{person.company.name}</span>
            </span>
          ) : null}
          <span
            className="ui-crm-pill"
            style={{ background: stage.soft, color: stage.solid }}
            title={stageLabel(person.stageKey)}
          >
            <span>{stageLabel(person.stageKey)}</span>
          </span>
          {person.jobTitle ? (
            <span className="ui-crm-pill">
              <span>{person.jobTitle}</span>
            </span>
          ) : null}
        </span>
      </button>
      <button
        type="button"
        onClick={onToggleSelect}
        aria-pressed={selected}
        aria-label={`Select ${person.name}`}
        className="ui-crm-card-select"
      >
        <span className="ui-crm-card-select-box" aria-hidden>
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      </button>
    </li>
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
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="ui-crm-sheet-backdrop" />
        <Dialog.Popup className="ui-crm-sheet">
          {open ? (
            <NewContactForm onClose={onClose} onCreated={onCreated} />
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function NewContactForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (person: CrmPerson) => void;
}) {
  const createPerson = useMutation(createCrmPersonMutationOptions(queryClient));
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [stageKey, setStageKey] = useState("new");

  async function submit() {
    const name = fullName.trim();
    if (!name) {
      toast.error("Name required");
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
      toast.error(
        err instanceof Error ? err.message : "Couldn’t create contact",
      );
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-start justify-between gap-3 border-b border-[var(--hairline)] px-5 py-4">
        <div className="min-w-0">
          <Dialog.Title className="text-16 font-medium tracking-[-0.02em] text-[var(--text)]">
            New contact
          </Dialog.Title>
          <Dialog.Description className="mt-1.5 text-13 leading-relaxed text-[var(--text-secondary)]">
            Give a name and email. The agent can enrich title, company, and next
            play from there.
          </Dialog.Description>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-[var(--text-secondary)] hover:bg-[var(--bg-muted)]"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-5 py-5">
        <label className="block">
          <span className="mb-1.5 block text-13 font-medium text-[var(--text)]">
            Name
          </span>
          <input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="Full name"
            className="h-10 min-h-10 w-full rounded-[8px] border border-[var(--hairline)] bg-[var(--bg-solid)] px-3 text-13 text-[var(--text)] outline-none focus:border-[var(--text-muted)]"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-13 font-medium text-[var(--text)]">
            Email
          </span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@company.com"
            className="h-10 min-h-10 w-full rounded-[8px] border border-[var(--hairline)] bg-[var(--bg-solid)] px-3 text-13 text-[var(--text)] outline-none focus:border-[var(--text-muted)]"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-13 font-medium text-[var(--text)]">
            Company
          </span>
          <input
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            placeholder="Company"
            className="h-10 min-h-10 w-full rounded-[8px] border border-[var(--hairline)] bg-[var(--bg-solid)] px-3 text-13 text-[var(--text)] outline-none focus:border-[var(--text-muted)]"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-13 font-medium text-[var(--text)]">
            Stage
          </span>
          <select
            value={stageKey}
            onChange={(event) => setStageKey(event.target.value)}
            className="ui-crm-select h-10 min-h-10 w-full !rounded-[8px] text-13"
          >
            {CONTACT_STAGE_DEFS.map((stage) => (
              <option key={stage.key} value={stage.key}>
                {stage.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-[var(--hairline)] px-5 py-3">
        <Dialog.Close
          type="button"
          disabled={createPerson.isPending}
          className="inline-flex min-h-10 items-center rounded-[8px] px-3 text-13 font-medium text-[var(--text-secondary)] transition-colors duration-[var(--duration-quick)] hover:bg-[var(--bg-muted)] hover:text-[var(--text)] disabled:opacity-50"
        >
          Cancel
        </Dialog.Close>
        <button
          type="button"
          disabled={createPerson.isPending || !fullName.trim()}
          onClick={() => void submit()}
          className="ui-btn inline-flex min-h-10 items-center px-3.5 text-13 active:scale-[0.96] disabled:opacity-50"
        >
          {createPerson.isPending ? "Creating…" : "Create"}
        </button>
      </footer>
    </div>
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
      <div className="pointer-events-auto flex min-h-12 flex-wrap items-center gap-2 rounded-[12px] bg-[var(--text)] px-3 py-2 shadow-[var(--shadow-md)]">
        <span className="ps-1 text-12 font-semibold tabular-nums text-[var(--bg-solid)]">
          {count} selected
        </span>
        <select
          value=""
          disabled={busy}
          onChange={(event) => {
            if (event.target.value) onMove(event.target.value);
          }}
          aria-label="Move selected to stage"
          className="min-h-9 rounded-[8px] bg-[oklch(1_0_0/0.14)] px-2 text-12 font-medium text-[var(--bg-solid)] outline-none disabled:opacity-50"
        >
          <option value="">{busy ? "Moving…" : "Move to stage…"}</option>
          {CONTACT_STAGE_DEFS.map((stage) => (
            <option
              key={stage.key}
              value={stage.key}
              className="text-[var(--text)]"
            >
              {stage.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onClear}
          disabled={busy}
          className="inline-flex min-h-9 items-center rounded-[8px] px-2.5 text-12 font-medium text-[oklch(1_0_0/0.7)] transition-colors duration-[var(--duration-quick)] hover:text-[var(--bg-solid)] disabled:opacity-50"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

function IconColumnHeader({
  icon: Icon,
  label,
  className,
}: {
  icon: typeof UserRound;
  label: string;
  className?: string;
}) {
  return (
    <th className={className}>
      <span className="inline-flex items-center gap-1">
        <Icon className="h-4 w-4" strokeWidth={1.6} aria-hidden />
        {label}
      </span>
    </th>
  );
}

function ViewsMenu({
  segments,
  activeKey,
  label,
  count,
  countKnown,
  open,
  onOpenChange,
  onSelect,
}: {
  segments: Array<{ key: string; label: string; count: number }>;
  activeKey: string;
  label: string;
  count: number;
  countKnown: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (key: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) onOpenChange(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-filtered={activeKey !== ALL_SEGMENT ? "true" : undefined}
        className="ui-twenty-view-btn shrink-0"
      >
        <List className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden />
        <span>{label}</span>
        {countKnown ? (
          <span className="ui-twenty-count">{count}</span>
        ) : (
          <span className="ui-twenty-count animate-pulse" aria-hidden />
        )}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-[color:var(--t-font-color-tertiary)] transition-transform duration-[var(--duration-quick)]",
            open && "rotate-180",
          )}
          strokeWidth={2}
        />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Views"
          className={cn(
            "ui-crm-menu-scroll absolute start-0 top-[calc(100%+4px)] z-50",
            "max-h-[min(70vh,34rem)] overflow-y-auto",
            "rounded-[10px] border border-[var(--hairline)] bg-[var(--bg-solid)] p-1 shadow-[var(--shadow-md)]",
            "w-[15rem] max-md:w-[calc(100vw-2.5rem)]",
          )}
        >
          {segments.map((segment) => (
            <button
              key={segment.key}
              type="button"
              role="menuitemradio"
              aria-checked={segment.key === activeKey}
              onClick={() => onSelect(segment.key)}
              className={cn(
                "flex min-h-11 w-full items-center gap-2 rounded-[7px] px-2.5 text-start text-13 text-[var(--text)]",
                "hover:bg-[var(--bg-muted)]",
                segment.key === activeKey && "bg-[var(--bg-muted)] font-medium",
              )}
            >
              <Check
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  segment.key === activeKey ? "opacity-100" : "opacity-0",
                )}
                strokeWidth={2.4}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate capitalize">
                {segment.label}
              </span>
              <span className="tabular-nums text-12 text-[var(--text-muted)]">
                {segment.count}
              </span>
            </button>
          ))}
        </div>
      ) : null}
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
  return (
    <div className="ui-crm-objects" role="tablist" aria-label="CRM objects">
      {CRM_OBJECT_TABS.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={mode === id}
          onClick={() => onSelect(id)}
          data-active={mode === id}
          className="ui-crm-segment-item"
        >
          {crmModeLabel(id)}
        </button>
      ))}
    </div>
  );
}

function CrmLoadError({
  label,
  onRetry,
}: {
  label: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="max-w-sm text-center">
        <p className="text-14 font-medium tracking-[-0.01em] text-[var(--text)]">
          Couldn’t load {label}
        </p>
        <p className="mt-1.5 text-13 leading-relaxed text-[var(--text-secondary)]">
          Check your connection and try again.
        </p>
        <button type="button" onClick={onRetry} className="ui-crm-retry mt-4">
          Try again
        </button>
      </div>
    </div>
  );
}

function CrmEmptyState({
  searching,
  onCreate,
}: {
  searching: boolean;
  onCreate?: () => void;
}) {
  return (
    <div className="flex h-full flex-1 items-center justify-center px-4 py-12">
      <div className="max-w-sm text-center">
        <p className="text-14 font-medium tracking-[-0.01em] text-[var(--text)]">
          {searching ? "No matches" : "No contacts yet"}
        </p>
        <p className="mt-1.5 text-13 leading-relaxed text-pretty text-[var(--text-secondary)]">
          {searching
            ? "Try a different name, company, or email."
            : "Add a person."}
        </p>
        {!searching && onCreate ? (
          <button
            type="button"
            onClick={onCreate}
            className="ui-btn mt-4 inline-flex min-h-10 items-center gap-1.5 px-3.5 text-12 active:scale-[0.96]"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            New contact
          </button>
        ) : null}
      </div>
    </div>
  );
}
