import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Building2,
  Calendar,
  Mail,
  Maximize2,
  MessagesSquare,
  UserRound,
  X,
} from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import {
  EngagementChips,
  type Engagement,
} from "@/components/crm/engagement-chips";
import { personInitials } from "@/components/crm/crm-marks";
import { stageLabel, stageStyle } from "@/lib/crm/colors";
import {
  type CrmThread,
  type CrmThreadStatus,
  crmSendsQueryOptions,
  crmThreadsQueryOptions,
} from "@/lib/crm/queries";
import { cn } from "@/lib/utils";

type ConversationStatus =
  | "no_activity"
  | "draft"
  | "scheduled"
  | "sending"
  | "sent"
  | "opened"
  | "clicked"
  | "replied"
  | "bounced"
  | "failed"
  | "discarded";

const STATUS_COPY: Record<ConversationStatus, { label: string; tone: string }> = {
  no_activity: { label: "No activity", tone: "muted" },
  draft: { label: "Not sent", tone: "attention" },
  scheduled: { label: "Scheduled", tone: "info" },
  sending: { label: "Sending", tone: "info" },
  sent: { label: "Sent", tone: "good" },
  opened: { label: "Opened", tone: "good" },
  clicked: { label: "Clicked", tone: "good" },
  replied: { label: "Replied", tone: "good" },
  bounced: { label: "Bounced", tone: "bad" },
  failed: { label: "Failed", tone: "bad" },
  discarded: { label: "Discarded", tone: "muted" },
};

const THREAD_STATUS: Record<CrmThreadStatus, ConversationStatus> = {
  none: "no_activity",
  draft: "draft",
  queued: "sending",
  logged: "sent",
  sent: "sent",
  opened: "opened",
  clicked: "clicked",
  failed: "failed",
  answered: "replied",
  no_answer: "sent",
};

function StatusPill({ status }: { status: ConversationStatus }) {
  const copy = STATUS_COPY[status];
  return (
    <span className="ui-conv-status" data-tone={copy.tone}>
      {copy.label}
    </span>
  );
}

function formatSent(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const day = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
  }).format(date);
  const year = date.getFullYear();
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(date)
    .toLowerCase();
  return `${day}, ${year} ${time}`;
}

function engagementOf(thread: CrmThread): Engagement {
  const tracking = thread.latestSend?.tracking;
  const status = thread.status;
  return {
    sent: Boolean(thread.latestSend) && status !== "draft" && status !== "queued",
    opened: (tracking?.uniqueOpens ?? 0) > 0 || status === "opened" || status === "clicked",
    clicked: (tracking?.uniqueClicks ?? 0) > 0 || status === "clicked",
    replied: status === "answered",
    bounced: false,
    rawOpens: tracking?.opens ?? 0,
    realOpens: tracking?.uniqueOpens ?? 0,
    rawClicks: tracking?.clicks ?? 0,
    realClicks: tracking?.uniqueClicks ?? 0,
    tracked: thread.latestSend?.kind === "email",
  };
}

function conversationStatus(thread: CrmThread): ConversationStatus {
  return THREAD_STATUS[thread.status] ?? "no_activity";
}

function IconColumnHeader({
  icon: Icon,
  label,
  className,
}: {
  icon: typeof Mail;
  label: string;
  className?: string;
}) {
  return (
    <th className={className}>
      <span className="inline-flex items-center gap-1.5">
        <Icon aria-hidden />
        {label}
      </span>
    </th>
  );
}

export function ConversationsPanel({
  search,
  onOpenContactRecord,
}: {
  search?: string;
  onOpenContactRecord?: (contactId: string) => void;
}) {
  const threads = useQuery(crmThreadsQueryOptions(search ?? ""));
  const [statusFilter, setStatusFilter] = useState<ConversationStatus | "all">(
    "all",
  );
  const [selected, setSelected] = useState<{
    thread: CrmThread;
    tab: "details" | "messages";
  } | null>(null);

  const rows = (threads.data?.items ?? []).filter((thread) => {
    if (statusFilter === "all") return true;
    return conversationStatus(thread) === statusFilter;
  });
  const replyRate = useMemo(() => {
    const contacted = rows.filter((row) => row.outboundCount > 0);
    if (!contacted.length) return null;
    const replied = contacted.filter((row) => row.status === "answered").length;
    return Math.round((replied / contacted.length) * 100);
  }, [rows]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="ui-twenty-toolbar">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="ui-twenty-view-btn shrink-0">
              <MessagesSquare className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden />
              <span>All Conversations</span>
              <span className="ui-twenty-count">
                {threads.data?.total ?? 0}
              </span>
            </span>
            <fieldset className="ui-conv-filters" aria-label="Filter by status">
              {(
                [
                  ["all", "All"],
                  ["draft", "Not sent"],
                  ["sent", "Sent"],
                  ["opened", "Opened"],
                  ["replied", "Replied"],
                  ["failed", "Bounced"],
                ] as Array<[ConversationStatus | "all", string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  data-active={statusFilter === value}
                  onClick={() => setStatusFilter(value)}
                  className="ui-conv-filter"
                >
                  {label}
                </button>
              ))}
            </fieldset>
          </div>
          {replyRate !== null ? (
            <span className="shrink-0 text-11 text-[var(--text-muted)]">
              {replyRate}% replied of those contacted
            </span>
          ) : null}
        </div>

        <div className="ui-crm-index-scroll min-h-0 min-w-0 flex-1 overflow-auto">
          {threads.isPending ? null : threads.error ? (
            <div className="px-5 py-16 text-center">
              <p className="text-13 text-[var(--text-secondary)]">
                Couldn’t load conversations
              </p>
            </div>
          ) : rows.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <p className="text-13 text-[var(--text-secondary)]">
                {search || statusFilter !== "all"
                  ? "No conversations match that."
                  : "No conversations yet."}
              </p>
              <p className="mt-1 text-11 text-[var(--text-muted)]">
                Once an agent sends an email, it shows up here with how it landed.
              </p>
            </div>
          ) : (
            <table className="ui-crm-table ui-crm-table-twenty ui-conv-table">
              <thead>
                <tr>
                  <IconColumnHeader icon={UserRound} label="Contact" />
                  <IconColumnHeader icon={Mail} label="Message" />
                  <IconColumnHeader icon={Activity} label="Status" />
                  <IconColumnHeader
                    icon={Building2}
                    label="Sent by"
                    className="ui-crm-col-meta"
                  />
                  <IconColumnHeader
                    icon={Calendar}
                    label="Sent"
                    className="ui-crm-col-aux"
                  />
                </tr>
              </thead>
              <tbody>
                {rows.map((thread) => {
                  const stage = stageStyle(thread.person.stageKey);
                  const status = conversationStatus(thread);
                  const engagement = engagementOf(thread);
                  const active = selected?.thread.person.id === thread.person.id;
                  const pending =
                    thread.latestSend?.status === "draft" ||
                    thread.latestSend?.status === "queued";
                  return (
                    <tr key={thread.person.id} aria-selected={active || undefined}>
                      <td>
                        <button
                          type="button"
                          onClick={() => setSelected({ thread, tab: "details" })}
                          className="ui-crm-pill ui-crm-pill-name max-w-full"
                          title={`Open ${thread.person.name}`}
                        >
                          <span
                            className="ui-conv-avatar"
                            style={{ background: stage.soft, color: stage.solid }}
                            aria-hidden
                          >
                            {personInitials(thread.person.name)}
                          </span>
                          <span>{thread.person.name}</span>
                        </button>
                      </td>
                      <td className="ui-conv-message-cell">
                        {thread.latestSend ? (
                          <button
                            type="button"
                            onClick={() => setSelected({ thread, tab: "messages" })}
                            className="ui-conv-message"
                            title="Open every message, text, and call"
                          >
                            <span className="ui-conv-subject">
                              {thread.latestSend.subject || "(no subject)"}
                            </span>
                            <span className="ui-conv-snippet">
                              {thread.latestSend.body || "No preview"}
                            </span>
                          </button>
                        ) : (
                          <span className="text-11 text-[var(--text-muted)]">
                            Nothing sent yet
                          </span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => setSelected({ thread, tab: "messages" })}
                          className="flex items-center gap-2"
                          title="Open the message tree"
                        >
                          {pending || status === "no_activity" ? (
                            <StatusPill status={status} />
                          ) : (
                            <EngagementChips engagement={engagement} />
                          )}
                        </button>
                      </td>
                      <td className="ui-crm-col-meta">
                        <span className="ui-crm-pill">
                          <span>
                            {thread.latestSend?.createdBy.name ||
                              thread.latestSend?.toAddress ||
                              "Unassigned"}
                          </span>
                        </span>
                      </td>
                      <td className="ui-crm-col-aux">
                        <span className="ui-twenty-date tabular">
                          {formatSent(
                            thread.latestSend?.sentAt ||
                              thread.latestSend?.createdAt ||
                              null,
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>
                    <div className="flex items-center gap-3">
                      <span className="ui-crm-calc-stat">
                        Showing <strong>{rows.length}</strong> of{" "}
                        <strong>{threads.data?.total ?? rows.length}</strong>
                      </span>
                    </div>
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
          {!threads.isPending && rows.length ? (
            <ul className="ui-crm-cards">
              {rows.map((thread) => {
                const stage = stageStyle(thread.person.stageKey);
                const status = conversationStatus(thread);
                const engagement = engagementOf(thread);
                const pending =
                  thread.latestSend?.status === "draft" ||
                  thread.latestSend?.status === "queued";
                return (
                  <li
                    key={thread.person.id}
                    className="ui-crm-card"
                    data-open={selected?.thread.person.id === thread.person.id}
                  >
                    <button
                      type="button"
                      onClick={() => setSelected({ thread, tab: "messages" })}
                      className="ui-crm-card-open"
                    >
                      <span className="ui-crm-card-name">
                        <span
                          className="ui-conv-avatar"
                          style={{ background: stage.soft, color: stage.solid }}
                          aria-hidden
                        >
                          {personInitials(thread.person.name)}
                        </span>
                        <span>{thread.person.name}</span>
                      </span>
                      {thread.latestSend ? (
                        <>
                          <span className="ui-crm-card-line font-medium">
                            {thread.latestSend.subject || "(no subject)"}
                          </span>
                          <span className="ui-crm-card-line ui-crm-card-empty">
                            {thread.latestSend.body || "No preview"}
                          </span>
                        </>
                      ) : (
                        <span className="ui-crm-card-line ui-crm-card-empty">
                          Nothing sent yet
                        </span>
                      )}
                      <span className="ui-crm-card-meta">
                        {pending || status === "no_activity" ? (
                          <StatusPill status={status} />
                        ) : (
                          <EngagementChips engagement={engagement} />
                        )}
                        <span className="ui-twenty-date">
                          {formatSent(
                            thread.latestSend?.sentAt ||
                              thread.latestSend?.createdAt ||
                              null,
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </div>

      {selected ? (
        <ConversationRail
          thread={selected.thread}
          tab={selected.tab}
          onTab={(tab) => setSelected({ thread: selected.thread, tab })}
          onClose={() => setSelected(null)}
          onOpenContactRecord={onOpenContactRecord}
        />
      ) : null}
    </div>
  );
}

function ConversationRail({
  thread,
  tab,
  onTab,
  onClose,
  onOpenContactRecord,
}: {
  thread: CrmThread;
  tab: "details" | "messages";
  onTab: (tab: "details" | "messages") => void;
  onClose: () => void;
  onOpenContactRecord?: (contactId: string) => void;
}) {
  const sends = useQuery({
    ...crmSendsQueryOptions("", "", thread.person.id),
    enabled: tab === "messages",
  });
  const stage = stageStyle(thread.person.stageKey);
  const engagement = engagementOf(thread);

  return (
    <>
      <button
        type="button"
        aria-label="Close panel"
        className="fixed inset-0 z-30 bg-[var(--scrim)] backdrop-blur-[2px] md:hidden"
        onClick={onClose}
      />
      <aside
        className={cn(
          "ui-conv-rail flex h-full min-h-0 flex-col overflow-hidden",
          "max-md:absolute max-md:inset-0 max-md:z-40 max-md:w-full",
        )}
        style={
          {
            flex: "0 0 380px",
            width: 380,
            minWidth: 0,
            maxWidth: "min(48%, 460px)",
          } as CSSProperties
        }
        aria-label={`${thread.person.name} conversation`}
      >
        <header className="flex items-start gap-2 border-b border-[var(--hairline)] px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-13 font-medium text-[var(--text)]">
              {thread.person.name}
            </p>
            <p className="truncate text-11 text-[var(--text-muted)]">
              {[thread.person.emails[0], thread.person.company?.name]
                .filter(Boolean)
                .join(" · ") || "No email on file"}
            </p>
          </div>
          {onOpenContactRecord ? (
            <button
              type="button"
              onClick={() => onOpenContactRecord(thread.person.id)}
              aria-label="Open full record"
              title="Open full record"
              className="ui-conv-icon-btn"
            >
              <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ui-conv-icon-btn"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </header>

        <div className="ui-conv-tabs" role="tablist">
          {(
            [
              ["details", "Details"],
              ["messages", "Messages"],
            ] as Array<["details" | "messages", string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              data-active={tab === value}
              onClick={() => onTab(value)}
              className="ui-conv-tab"
            >
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "details" ? (
            <div className="px-3.5 py-3">
              <div className="flex items-center gap-2 pb-2">
                <span
                  className="inline-flex items-center gap-1.5 rounded-[6px] px-2 py-0.5 text-11 font-medium"
                  style={{ background: stage.soft, color: stage.solid }}
                >
                  {stageLabel(thread.person.stageKey)}
                </span>
              </div>
              <div className="divide-y divide-[var(--hairline)]">
                <DetailRow label="Email" value={thread.person.emails[0] || "—"} />
                <DetailRow
                  label="Company"
                  value={thread.person.company?.name || "—"}
                />
                <DetailRow
                  label="Owner"
                  value={thread.latestSend?.createdBy.name || "Unassigned"}
                />
                <DetailRow
                  label="Emails sent"
                  value={String(thread.outboundCount)}
                />
                <DetailRow
                  label="Replies"
                  value={thread.status === "answered" ? "1" : "0"}
                />
                <DetailRow
                  label="Real opens"
                  value={
                    engagement.tracked
                      ? `${engagement.realOpens} of ${engagement.rawOpens} loads`
                      : "Not tracked"
                  }
                />
                <DetailRow
                  label="Clicks"
                  value={
                    engagement.tracked
                      ? `${engagement.realClicks} of ${engagement.rawClicks} visits`
                      : "Not tracked"
                  }
                />
              </div>
            </div>
          ) : sends.isPending ? null : (
            <ul className="ui-tree">
              {(sends.data?.items ?? []).map((send) => (
                <li key={send.id} className="ui-tree-node">
                  <span className="ui-tree-branch" aria-hidden />
                  <div
                    className="ui-tree-card"
                    data-pending={
                      send.status === "draft" || send.status === "queued"
                        ? ""
                        : undefined
                    }
                  >
                    <p className="text-12 font-medium text-[var(--text)]">
                      {send.subject || send.kind}
                    </p>
                    <p className="mt-0.5 text-11 text-[var(--text-muted)]">
                      {send.body || send.toAddress}
                    </p>
                    <p className="mt-1 text-11 text-[var(--text-muted)]">
                      {formatSent(send.sentAt || send.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
              {(sends.data?.items ?? []).length === 0 ? (
                <li className="px-2 py-6 text-12 text-[var(--text-muted)]">
                  Nothing sent yet
                </li>
              ) : null}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="shrink-0 text-11 text-[var(--text-muted)]">{label}</span>
      <span className="min-w-0 truncate text-12 text-[var(--text)]">{value}</span>
    </div>
  );
}
