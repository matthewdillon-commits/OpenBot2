import { ArrowLeft, ExternalLink, Sparkles, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";

export type RecordDetailField = {
  key: string;
  label: string;
  value?: string | null;
  state?: "known" | "suggested" | "blank";
  provenance?: string | null;
  proposedValue?: string | null;
  suggestionId?: string | null;
  inputType?: "text" | "email" | "tel" | "url";
};

export type RecordPageProps = {
  kind: "contact" | "company";
  id: string;
  name: string;
  subtitle?: string;
  logoUrl?: string | null;
  logoColor?: string;
  initials?: string;
  stats?: {
    openPipelineUsd?: number;
    openDeals?: number;
    nextClose?: string | null;
    ownerName?: string | null;
    ownerInitials?: string | null;
  };
  details: RecordDetailField[];
  about?: string | null;
  links?: Array<{ label: string; href: string; icon?: ReactNode }>;
  tabCounts?: { deals?: number; contacts?: number };
  timeline?: ReactNode;
  dealsPanel?: ReactNode;
  notesPanel?: ReactNode;
  overviewFooter?: ReactNode;
  backLabel?: string | null;
  onBack?: () => void;
  onClose: () => void;
  onResearch?: () => void;
  onAddDeal?: () => void;
  researching?: boolean;
  onResolveSuggestion?: (id: string, action: "accept" | "reject") => void;
  onReportWrong?: (fieldKey: string) => void;
  onSaveField?: (key: string, value: string) => Promise<void>;
  compact?: boolean;
  className?: string;
};

type RecordTab = "overview" | "notes" | "timeline" | "deals";

function formatPipelineUsd(value?: number): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

function tabCountLabel(label: string, count?: number): string {
  if (count == null || count <= 0) return label;
  return `${label} ${count}`;
}

function FieldCell({
  field,
  onResolveSuggestion,
  onReportWrong,
  onSaveField,
}: {
  field: RecordDetailField;
  onResolveSuggestion?: (id: string, action: "accept" | "reject") => void;
  onReportWrong?: (fieldKey: string) => void;
  onSaveField?: (key: string, value: string) => Promise<void>;
}) {
  const state = field.state ?? (field.value ? "known" : "blank");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(field.value ?? "");
  const [busy, setBusy] = useState(false);

  async function commit() {
    if (!onSaveField) {
      setEditing(false);
      return;
    }
    const next = draft.trim();
    if (next === (field.value || "").trim()) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onSaveField(field.key, next);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0 py-0.5">
      <p className="text-12 leading-none text-[var(--text-muted)]">
        {field.label}
      </p>
      <div className="mt-1.5 min-w-0">
        {editing && onSaveField ? (
          <input
            type={field.inputType ?? "text"}
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void commit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setDraft(field.value ?? "");
                setEditing(false);
              }
            }}
            className="h-8 w-full rounded-[8px] bg-[var(--bg-muted)] px-2 text-13 text-[var(--text)] outline-none ring-1 ring-[var(--accent)]"
            aria-label={field.label}
          />
        ) : state === "blank" || (!field.value && state !== "suggested") ? (
          <button
            type="button"
            disabled={!onSaveField}
            onClick={() => {
              setDraft("");
              setEditing(true);
            }}
            className="text-13 text-[var(--text-muted)] disabled:cursor-default"
          >
            —
          </button>
        ) : state === "suggested" ? (
          <div className="ui-field-suggested -ms-2 inline-flex max-w-full flex-wrap items-center gap-2">
            <span className="truncate text-13 font-medium text-[var(--text)]">
              {field.proposedValue ?? field.value ?? "—"}
            </span>
            <span className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                disabled={!field.suggestionId || !onResolveSuggestion}
                onClick={() => {
                  if (field.suggestionId) {
                    onResolveSuggestion?.(field.suggestionId, "accept");
                  }
                }}
                className="rounded-[6px] px-1.5 py-0.5 text-12 font-medium text-[var(--text)] hover:bg-[var(--bg-hover)] active:scale-[0.96] disabled:opacity-50"
              >
                Keep
              </button>
              <button
                type="button"
                disabled={!field.suggestionId || !onResolveSuggestion}
                onClick={() => {
                  if (field.suggestionId) {
                    onResolveSuggestion?.(field.suggestionId, "reject");
                  }
                }}
                className="rounded-[6px] px-1.5 py-0.5 text-12 font-medium text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] active:scale-[0.96] disabled:opacity-50"
              >
                Change
              </button>
            </span>
          </div>
        ) : (
          <div className="flex min-w-0 max-w-full items-center gap-1.5">
            <button
              type="button"
              disabled={!onSaveField}
              onClick={() => {
                setDraft(field.value ?? "");
                setEditing(true);
              }}
              className="min-w-0 flex-1 truncate text-left text-13 font-medium text-[var(--text)] disabled:cursor-default"
            >
              {field.value}
            </button>
            {field.provenance ? (
              <button
                type="button"
                title={field.provenance}
                aria-label={`Source: ${field.provenance}. Report if wrong.`}
                onClick={() => onReportWrong?.(field.key)}
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full hover:bg-[var(--bg-hover)] active:scale-[0.96]"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
              </button>
            ) : (
              <span
                aria-hidden
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--text-muted)] opacity-50" />
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ui-record-stat min-w-0 flex-1 px-4 py-3">
      <p className="text-12 leading-none text-[var(--text-muted)]">{label}</p>
      <div className="mt-1.5 min-w-0 text-14 font-medium tracking-[-0.01em] text-[var(--text)]">
        {children}
      </div>
    </div>
  );
}

export function RecordPage({
  name,
  subtitle,
  logoUrl,
  logoColor = "var(--bg-grouped)",
  initials,
  stats,
  details,
  about,
  links = [],
  tabCounts,
  timeline,
  dealsPanel,
  notesPanel,
  overviewFooter,
  backLabel,
  onBack,
  onClose,
  onResearch,
  onAddDeal,
  researching = false,
  onResolveSuggestion,
  onReportWrong,
  onSaveField,
  compact = false,
  className,
}: RecordPageProps) {
  const [tab, setTab] = useState<RecordTab>("overview");

  const openDeals = stats?.openDeals ?? 0;
  const openPipeline = stats?.openPipelineUsd ?? 0;
  const statsCollapsed = openDeals === 0 && openPipeline === 0;

  const logoInitials =
    initials ??
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("");

  const tabs: Array<{ id: RecordTab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "notes", label: "Notes" },
    { id: "timeline", label: "Timeline" },
    { id: "deals", label: tabCountLabel("Deals", tabCounts?.deals) },
  ];

  return (
    <div
      className={cn(
        "ui-record-card flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--bg-solid)] text-[var(--text)]",
        className,
      )}
    >
      {backLabel ? (
        <div className="ui-record-band shrink-0 px-3 pt-2">
          <button
            type="button"
            onClick={onBack ?? onClose}
            className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-control)] px-1.5 text-12 font-medium text-[var(--text-secondary)] transition-[background-color,color,transform] duration-[var(--duration-quick)] ease-[var(--ease-apple)] hover:bg-[var(--bg-muted)] hover:text-[var(--text)] active:scale-[0.96]"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span className="max-w-[8rem] truncate">{backLabel}</span>
          </button>
        </div>
      ) : null}

      <header
        className={cn(
          "ui-record-band flex shrink-0 items-start gap-3.5 px-5",
          compact ? "py-3.5" : "py-5",
        )}
      >
        <div
          className={cn(
            "flex shrink-0 items-center justify-center overflow-hidden rounded-[12px] font-semibold tracking-tight text-[var(--text-secondary)]",
            compact ? "h-10 w-10 text-12" : "h-11 w-11 text-13",
          )}
          style={{ background: logoColor }}
        >
          {logoUrl ? (
            <img src={logoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            logoInitials
          )}
        </div>

        <div className="min-w-0 flex-1 pt-0.5">
          <h1
            className={cn(
              "truncate font-semibold leading-none tracking-[-0.03em] text-[var(--text)]",
              compact ? "text-[18px]" : "text-[22px]",
            )}
          >
            {name}
          </h1>
          {subtitle ? (
            <p className="mt-1.5 line-clamp-2 text-12 leading-snug text-[var(--text-muted)]">
              {subtitle}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1 pt-0.5">
          {onResearch ? (
            <button
              type="button"
              onClick={onResearch}
              disabled={researching}
              aria-label="Ask about this person"
              title="Ask about this person"
              className="ui-btn ui-stroke inline-flex h-8 w-8 min-h-8 items-center justify-center !rounded-full bg-[var(--bg-solid)] p-0 text-[var(--text-muted)] hover:text-[var(--text)] active:scale-[0.96] disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close record"
            className="ui-btn ui-stroke inline-flex h-8 w-8 min-h-8 items-center justify-center !rounded-full bg-[var(--bg-solid)] p-0 text-[var(--text-muted)] hover:text-[var(--text)] active:scale-[0.96]"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </header>

      <div className="ui-record-band shrink-0">
        {statsCollapsed ? (
          <div className="flex items-center justify-between gap-3 px-5 py-3.5">
            <p className="text-13 text-[var(--text-muted)]">No open deals</p>
            {onAddDeal ? (
              <button
                type="button"
                onClick={() => {
                  setTab("deals");
                  onAddDeal();
                }}
                className="text-12 font-medium text-[var(--text)] hover:opacity-80 active:scale-[0.96]"
              >
                Add deal
              </button>
            ) : null}
          </div>
        ) : (
          <div className="ui-record-stats">
            <StatCell label="Open pipeline">
              <span className="tabular-nums">
                {formatPipelineUsd(stats?.openPipelineUsd)}
              </span>
            </StatCell>
            <StatCell label="Open deals">
              <span className="tabular-nums">{openDeals}</span>
            </StatCell>
            <StatCell label="Next close">
              {stats?.nextClose ?? (
                <span className="text-[var(--text-muted)]">—</span>
              )}
            </StatCell>
            <StatCell label="Owner">
              {stats?.ownerName ? (
                <div className="flex min-w-0 items-center gap-2">
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg-grouped)] text-11 font-semibold text-[var(--text-secondary)]">
                    {stats.ownerInitials ??
                      stats.ownerName
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((part) => part[0]?.toUpperCase() ?? "")
                        .join("")}
                  </span>
                  <span className="truncate">{stats.ownerName}</span>
                </div>
              ) : (
                <span className="text-[var(--text-muted)]">—</span>
              )}
            </StatCell>
          </div>
        )}
      </div>

      <div
        className="ui-record-band flex shrink-0 flex-wrap gap-0 px-3"
        role="tablist"
        aria-label="Record sections"
      >
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            data-active={tab === id}
            onClick={() => setTab(id)}
            className="ui-record-tab shrink-0 px-3.5 py-3 text-13 text-[var(--text-muted)] transition-[color,box-shadow,font-weight] duration-[var(--duration-quick)] ease-[var(--ease-apple)] hover:text-[var(--text)] active:scale-[0.98]"
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "overview" ? (
          <>
            <section className="ui-record-band px-5 py-5">
              <h2 className="ui-label-section mb-3">Details</h2>
              <div
                className={cn(
                  "grid gap-y-4",
                  compact ? "grid-cols-1 gap-x-0" : "grid-cols-2 gap-x-6",
                )}
              >
                {details.map((field) => (
                  <FieldCell
                    key={field.key}
                    field={field}
                    onResolveSuggestion={onResolveSuggestion}
                    onReportWrong={onReportWrong}
                    onSaveField={onSaveField}
                  />
                ))}
              </div>
            </section>

            {overviewFooter ? (
              <section className="ui-record-band px-5 py-5">
                {overviewFooter}
              </section>
            ) : null}

            {notesPanel ? (
              <section className="ui-record-band px-5 py-5">
                <h2 className="ui-label-section mb-3">Notes</h2>
                {notesPanel}
              </section>
            ) : null}

            <section className="ui-record-band px-5 py-5">
              <h2 className="ui-label-section mb-3">About</h2>
              {about ? (
                <p className="text-13 leading-relaxed text-pretty text-[var(--text)]">
                  {about}
                </p>
              ) : (
                <p className="text-13 text-[var(--text-muted)]">—</p>
              )}
            </section>

            <section className="ui-record-band px-5 py-5">
              <h2 className="ui-label-section mb-3">Links</h2>
              {links.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {links.map((link) => (
                    <a
                      key={`${link.label}-${link.href}`}
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ui-stroke inline-flex items-center gap-1.5 rounded-full bg-[var(--bg-solid)] px-3 py-1.5 text-12 font-medium text-[var(--text)] transition-[border-color,transform,background-color] duration-[var(--duration-quick)] ease-[var(--ease-apple)] hover:bg-[var(--bg-muted)] active:scale-[0.96]"
                    >
                      {link.icon ?? (
                        <ExternalLink
                          className="h-3 w-3 shrink-0 text-[var(--text-muted)]"
                          strokeWidth={1.75}
                        />
                      )}
                      {link.label}
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-13 text-[var(--text-muted)]">—</p>
              )}
            </section>
          </>
        ) : null}

        {tab === "notes" ? (
          <div className="px-5 py-5">
            {notesPanel ?? (
              <p className="text-13 text-[var(--text-muted)]">No notes yet.</p>
            )}
          </div>
        ) : null}

        {tab === "timeline" ? (
          <div className="px-5 py-5">
            {timeline ?? (
              <p className="text-13 text-[var(--text-muted)]">
                No timeline activity yet.
              </p>
            )}
          </div>
        ) : null}

        {tab === "deals" ? (
          <div className="px-5 py-5">
            {dealsPanel ?? (
              <p className="text-13 text-[var(--text-muted)]">No deals yet.</p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
