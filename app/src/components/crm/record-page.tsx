import { IconExternalLink } from "@tabler/icons-react";
import { motion, useReducedMotion } from "motion/react";
import { type ReactNode, useState } from "react";
import { CrmAvatar } from "@/components/crm/crm-ui";
import { Input } from "@/components/ui/input";
import { SPRING_NO_BOUNCE } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type RecordDetailField = {
  key: string;
  label: string;
  value?: string | null;
  inputType?: "text" | "email" | "tel" | "url";
};

export type RecordPageProps = {
  name: string;
  subtitle?: string;
  details: RecordDetailField[];
  about?: string | null;
  links?: Array<{ label: string; href: string }>;
  stats?: {
    openPipelineUsd?: number;
    openDeals?: number;
    nextClose?: string | null;
    ownerName?: string | null;
  };
  tabCounts?: { deals?: number };
  timeline?: ReactNode;
  dealsPanel?: ReactNode;
  notesPanel?: ReactNode;
  overviewFooter?: ReactNode;
  onAddDeal?: () => void;
  onSaveField?: (key: string, value: string) => Promise<void>;
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

function FieldCell({
  field,
  onSaveField,
}: {
  field: RecordDetailField;
  onSaveField?: (key: string, value: string) => Promise<void>;
}) {
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
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{field.label}</p>
      <div className="mt-1.5 min-w-0">
        {editing && onSaveField ? (
          <Input
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
            aria-label={field.label}
            className="h-8"
          />
        ) : (
          <button
            type="button"
            disabled={!onSaveField}
            onClick={() => {
              setDraft(field.value ?? "");
              setEditing(true);
            }}
            className={cn(
              "min-w-0 truncate text-left text-sm",
              field.value ? "font-medium" : "text-muted-foreground",
              onSaveField &&
                "rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
            )}
          >
            {field.value || "—"}
          </button>
        )}
      </div>
    </div>
  );
}

export function RecordPage({
  name,
  subtitle,
  details,
  about,
  links = [],
  stats,
  tabCounts,
  timeline,
  dealsPanel,
  notesPanel,
  overviewFooter,
  onAddDeal,
  onSaveField,
}: RecordPageProps) {
  const [tab, setTab] = useState<RecordTab>("overview");
  const shouldReduceMotion = useReducedMotion();
  const openDeals = stats?.openDeals ?? 0;
  const openPipeline = stats?.openPipelineUsd ?? 0;
  const tabs: Array<{ id: RecordTab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "notes", label: "Notes" },
    { id: "timeline", label: "Timeline" },
    {
      id: "deals",
      label:
        tabCounts?.deals && tabCounts.deals > 0
          ? `Deals ${tabCounts.deals}`
          : "Deals",
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 px-4 pb-4">
        <div className="flex items-start gap-3">
          <CrmAvatar className="size-10 text-sm" name={name} />
          <div className="min-w-0 pt-0.5">
            <h2 className="truncate font-bold text-lg tracking-tight text-balance">
              {name}
            </h2>
            {subtitle ? (
              <p className="mt-1 line-clamp-2 text-pretty text-muted-foreground text-sm">
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>
        {openDeals === 0 && openPipeline === 0 ? (
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">No open deals</p>
            {onAddDeal ? (
              <button
                type="button"
                onClick={() => {
                  setTab("deals");
                  onAddDeal();
                }}
                className="text-sm font-medium underline-offset-4 hover:underline"
              >
                Add deal
              </button>
            ) : null}
          </div>
        ) : (
          <dl className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <dt className="text-xs text-muted-foreground">Open pipeline</dt>
              <dd className="mt-1 text-sm font-medium tabular-nums">
                {formatPipelineUsd(stats?.openPipelineUsd)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Open deals</dt>
              <dd className="mt-1 text-sm font-medium tabular-nums">
                {openDeals}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Next close</dt>
              <dd className="mt-1 text-sm">
                {stats?.nextClose ?? (
                  <span className="text-muted-foreground">—</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Owner</dt>
              <dd className="mt-1 truncate text-sm">
                {stats?.ownerName ?? (
                  <span className="text-muted-foreground">—</span>
                )}
              </dd>
            </div>
          </dl>
        )}
      </header>

      <div
        className="flex shrink-0 gap-1 px-4 pb-2"
        role="tablist"
        aria-label="Record sections"
      >
        {tabs.map(({ id, label }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(id)}
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
                  layoutId="crm-record-tab"
                  className="absolute inset-0 rounded-lg bg-muted"
                  transition={
                    shouldReduceMotion ? { duration: 0 } : SPRING_NO_BOUNCE
                  }
                />
              ) : null}
              <span className="relative">{label}</span>
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {tab === "overview" ? (
          <div className="flex flex-col gap-6 pt-2">
            <section>
              <h3 className="font-bold text-sm tracking-tight">Details</h3>
              <div className="mt-3 grid grid-cols-1 gap-4">
                {details.map((field) => (
                  <FieldCell
                    key={field.key}
                    field={field}
                    onSaveField={onSaveField}
                  />
                ))}
              </div>
            </section>
            {overviewFooter ? <section>{overviewFooter}</section> : null}
            <section>
              <h3 className="font-bold text-sm tracking-tight">About</h3>
              {about ? (
                <p className="mt-2 max-w-prose text-pretty text-sm leading-relaxed">
                  {about}
                </p>
              ) : (
                <p className="mt-2 text-muted-foreground text-sm">—</p>
              )}
            </section>
            <section>
              <h3 className="font-bold text-sm tracking-tight">Links</h3>
              {links.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {links.map((link) => (
                    <a
                      key={`${link.label}-${link.href}`}
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-sm hover:bg-muted"
                    >
                      <IconExternalLink className="size-3.5 text-muted-foreground" />
                      {link.label}
                    </a>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-muted-foreground text-sm">—</p>
              )}
            </section>
          </div>
        ) : null}

        {tab === "notes" ? (
          <div className="pt-2">
            {notesPanel ?? (
              <p className="text-muted-foreground text-sm">No notes yet.</p>
            )}
          </div>
        ) : null}

        {tab === "timeline" ? (
          <div className="pt-2">
            {timeline ?? (
              <p className="text-muted-foreground text-sm">
                No timeline activity yet.
              </p>
            )}
          </div>
        ) : null}

        {tab === "deals" ? (
          <div className="pt-2">
            {dealsPanel ?? (
              <p className="text-muted-foreground text-sm">No deals yet.</p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
