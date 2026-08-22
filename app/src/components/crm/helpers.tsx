import type { CrmCreatedBy } from "@/lib/crm/queries";
import { cn } from "@/lib/utils";

const RELATIVE_UNITS = [
  { limit: 60_000, divisor: 1_000, unit: "second" },
  { limit: 3_600_000, divisor: 60_000, unit: "minute" },
  { limit: 86_400_000, divisor: 3_600_000, unit: "hour" },
  { limit: 604_800_000, divisor: 86_400_000, unit: "day" },
  { limit: Number.POSITIVE_INFINITY, divisor: 604_800_000, unit: "week" },
] as const;

const relativeFormat = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

export function relativeTime(iso: string) {
  const elapsed = Date.now() - new Date(iso).getTime();
  const scale =
    RELATIVE_UNITS.find(({ limit }) => Math.abs(elapsed) < limit) ??
    RELATIVE_UNITS[RELATIVE_UNITS.length - 1];
  return relativeFormat.format(
    -Math.round(elapsed / scale.divisor),
    scale.unit,
  );
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function createdByLabel(createdBy: CrmCreatedBy) {
  if (createdBy.kind === "system") return "System";
  return createdBy.name || (createdBy.kind === "bot" ? "Bot" : "System");
}

export function AvatarInitials({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground",
        className,
      )}
    >
      {initials(name)}
    </div>
  );
}

export function CompanyMark({
  name,
  domain,
}: {
  name: string;
  domain: string | null;
}) {
  const host = domain?.replace(/^https?:\/\//, "").split("/")[0] ?? "";
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {host ? (
        <img
          alt=""
          className="size-4 shrink-0 rounded-sm"
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`}
        />
      ) : (
        <span className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted text-[9px] font-medium text-muted-foreground">
          {initials(name).slice(0, 1)}
        </span>
      )}
      <span className="truncate">{name}</span>
    </span>
  );
}
