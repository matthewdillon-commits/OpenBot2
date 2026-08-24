import { useQuery } from "@tanstack/react-query";
import { CrmEmpty, CrmError } from "@/components/crm/crm-ui";
import {
  type CrmThread,
  type CrmThreadStatus,
  crmThreadsQueryOptions,
} from "@/lib/crm/queries";

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
  no_activity: "—",
  draft: "Draft",
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
  }).format(date);
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
  const rows = threads.data?.items ?? [];

  if (threads.isPending) return null;
  if (threads.error) {
    return (
      <CrmError
        label="conversations"
        error={threads.error.message}
        onRetry={() => void threads.refetch()}
      />
    );
  }
  if (rows.length === 0) {
    return (
      <CrmEmpty
        title={search ? "No matches" : "No conversations yet"}
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 pb-6">
      <table className="crm-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Message</th>
            <th>Status</th>
            <th>Sent</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((thread) => {
            const status = conversationStatus(thread);
            return (
              <tr
                key={thread.person.id}
                tabIndex={onOpenContactRecord ? 0 : undefined}
                onClick={() => onOpenContactRecord?.(thread.person.id)}
                onKeyDown={(event) => {
                  if (!onOpenContactRecord) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpenContactRecord(thread.person.id);
                  }
                }}
              >
                <td>
                  <span className="truncate font-medium">
                    {thread.person.name}
                  </span>
                </td>
                <td className="text-muted-foreground">
                  {thread.latestSend?.subject || "—"}
                </td>
                <td className="text-muted-foreground">
                  {STATUS_COPY[status]}
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
    </div>
  );
}
