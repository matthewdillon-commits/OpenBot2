import { useQuery } from "@tanstack/react-query";
import { crmSendsQueryOptions } from "@/lib/crm/queries";

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function ContactThread({ personId }: { personId: string }) {
  const sends = useQuery(crmSendsQueryOptions("", "", personId));
  const rows = sends.data?.items ?? [];

  if (sends.isPending) return null;
  if (sends.error) {
    return (
      <p className="text-muted-foreground text-sm">
        Couldn’t load the timeline.
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No timeline activity yet.</p>
    );
  }

  return (
    <ol className="m-0 flex list-none flex-col gap-3 p-0">
      {rows.map((send) => (
        <li key={send.id} className="rounded-lg border border-border px-3.5 py-3">
          <p className="capitalize text-muted-foreground text-xs">
            {send.kind} · {send.status} ·{" "}
            <span className="tabular-nums">
              {formatWhen(send.sentAt || send.createdAt)}
            </span>
          </p>
          {send.subject ? (
            <p className="mt-1 text-sm font-medium">{send.subject}</p>
          ) : null}
          {send.body ? (
            <p className="mt-1 whitespace-pre-wrap text-pretty text-muted-foreground text-sm leading-relaxed">
              {send.body}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
