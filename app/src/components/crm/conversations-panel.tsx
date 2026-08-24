import { IconX } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState, type ReactNode } from "react";
import {
  EngagementChips,
  type Engagement,
} from "@/components/crm/engagement-chips";
import { CrmAvatar, CrmEmpty, CrmError } from "@/components/crm/crm-ui";
import { Button } from "@/components/ui/button";
import { SPRING_NO_BOUNCE } from "@/lib/motion";
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

const STATUS_COPY: Record<ConversationStatus, string> = {
  no_activity: "No activity",
  draft: "Not sent",
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  opened: "Opened",
  clicked: "Clicked",
  replied: "Replied",
  bounced: "Bounced",
  failed: "Failed",
  discarded: "Discarded",
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

function formatSent(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function engagementOf(thread: CrmThread): Engagement {
  const tracking = thread.latestSend?.tracking;
  const status = thread.status;
  return {
    sent: Boolean(thread.latestSend) && status !== "draft" && status !== "queued",
    opened:
      (tracking?.uniqueOpens ?? 0) > 0 ||
      status === "opened" ||
      status === "clicked",
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
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3">
          <fieldset className="flex flex-wrap gap-1" aria-label="Filter by status">
            {(
              [
                ["all", "All"],
                ["draft", "Not sent"],
                ["sent", "Sent"],
                ["opened", "Opened"],
                ["replied", "Replied"],
                ["failed", "Failed"],
              ] as Array<[ConversationStatus | "all", string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatusFilter(value)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-sm",
                  "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  statusFilter === value
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </fieldset>
          {replyRate !== null ? (
            <span className="text-muted-foreground text-xs tabular-nums">
              {replyRate}% replied of those contacted
            </span>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 pb-6">
          {threads.isPending ? null : threads.error ? (
            <CrmError
              label="conversations"
              onRetry={() => void threads.refetch()}
            />
          ) : rows.length === 0 ? (
            <CrmEmpty
              title={
                search || statusFilter !== "all"
                  ? "No matches"
                  : "No conversations yet"
              }
              description="Once an agent sends an email, it shows up here with how it landed."
            />
          ) : (
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Message</th>
                  <th>Status</th>
                  <th>Sent by</th>
                  <th>Sent</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((thread) => {
                  const status = conversationStatus(thread);
                  const engagement = engagementOf(thread);
                  const pending =
                    thread.latestSend?.status === "draft" ||
                    thread.latestSend?.status === "queued";
                  return (
                    <tr
                      key={thread.person.id}
                      aria-selected={
                        selected?.thread.person.id === thread.person.id
                      }
                      onClick={() =>
                        setSelected({ thread, tab: "messages" })
                      }
                    >
                      <td>
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <CrmAvatar name={thread.person.name} />
                          <span className="truncate font-medium">
                            {thread.person.name}
                          </span>
                        </span>
                      </td>
                      <td>
                        {thread.latestSend ? (
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate font-medium">
                              {thread.latestSend.subject || "(no subject)"}
                            </span>
                            <span className="truncate text-muted-foreground text-xs">
                              {thread.latestSend.body || "No preview"}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            Nothing sent yet
                          </span>
                        )}
                      </td>
                      <td>
                        {pending || status === "no_activity" ? (
                          <span className="text-sm text-muted-foreground">
                            {STATUS_COPY[status]}
                          </span>
                        ) : (
                          <EngagementChips engagement={engagement} />
                        )}
                      </td>
                      <td className="text-muted-foreground">
                        {thread.latestSend?.createdBy.name ||
                          thread.latestSend?.toAddress ||
                          "—"}
                      </td>
                      <td className="whitespace-nowrap text-muted-foreground tabular-nums">
                        {formatSent(
                          thread.latestSend?.sentAt ||
                            thread.latestSend?.createdAt ||
                            null,
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
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
  const shouldReduceMotion = useReducedMotion();

  return (
    <aside
      className="flex h-full w-[min(24rem,42%)] shrink-0 flex-col border-s border-border bg-sidebar"
      aria-label={`${thread.person.name} conversation`}
    >
      <header className="flex items-start justify-between gap-2 px-3 py-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-sm">{thread.person.name}</p>
          <p className="truncate text-muted-foreground text-xs">
            {[thread.person.emails[0], thread.person.company?.name]
              .filter(Boolean)
              .join(" · ") || "No email on file"}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {onOpenContactRecord ? (
            <Button
              onClick={() => onOpenContactRecord(thread.person.id)}
              size="sm"
              variant="ghost"
            >
              Record
            </Button>
          ) : null}
          <Button aria-label="Close" onClick={onClose} size="icon" variant="ghost">
            <IconX />
          </Button>
        </div>
      </header>

      <div className="flex gap-1 px-3 pb-2" role="tablist" aria-label="Conversation">
        {(
          [
            ["details", "Details"],
            ["messages", "Messages"],
          ] as const
        ).map(([value, label]) => {
          const active = tab === value;
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onTab(value)}
              className={cn(
                "relative rounded-lg px-2.5 py-1.5 text-sm",
                "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {active ? (
                <motion.span
                  layoutId="crm-conversation-tab"
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

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {tab === "details" ? (
          <dl className="divide-y divide-border">
            <DetailRow
              label="Stage"
              value={
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="size-1.5 rounded-full"
                    style={{ background: stage.solid }}
                    aria-hidden
                  />
                  {stageLabel(thread.person.stageKey)}
                </span>
              }
            />
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
          </dl>
        ) : sends.isPending ? null : (
          <ul className="flex flex-col gap-3">
            {(sends.data?.items ?? []).map((send) => (
              <li
                key={send.id}
                className="rounded-lg border border-border px-3 py-2.5"
              >
                <p className="text-sm font-medium">
                  {send.subject || send.kind}
                </p>
                <p className="mt-0.5 text-muted-foreground text-xs">
                  {send.body || send.toAddress}
                </p>
                <p className="mt-1 text-muted-foreground text-xs tabular-nums">
                  {formatSent(send.sentAt || send.createdAt)}
                </p>
              </li>
            ))}
            {(sends.data?.items ?? []).length === 0 ? (
              <li className="py-6 text-muted-foreground text-sm">
                Nothing sent yet
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </aside>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string | ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="shrink-0 text-muted-foreground text-xs">{label}</dt>
      <dd className="min-w-0 truncate text-sm">{value}</dd>
    </div>
  );
}
