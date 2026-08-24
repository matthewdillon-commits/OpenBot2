import {
  IconArrowBackUp,
  IconEye,
  IconMail,
  IconPointer,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

export type ChipState = "on" | "off" | "unknown" | "pending";

export type Engagement = {
  sent: boolean;
  opened: boolean;
  clicked: boolean;
  replied: boolean;
  bounced: boolean;
  rawOpens: number;
  realOpens: number;
  rawClicks: number;
  realClicks: number;
  tracked: boolean;
};

function Chip({
  state,
  icon: Icon,
  title,
}: {
  state: ChipState;
  icon: typeof IconMail;
  title: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex size-6 items-center justify-center rounded-md",
        state === "on" && "bg-foreground/8 text-foreground",
        state === "off" && "text-muted-foreground/50",
        state === "unknown" && "text-muted-foreground/35",
        state === "pending" && "text-muted-foreground",
      )}
      title={title}
      aria-label={title}
    >
      <Icon className="size-3.5" aria-hidden />
    </span>
  );
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

export function openTitle(engagement: Engagement): string {
  if (!engagement.tracked) return "Open tracking was off for this email";
  if (engagement.realOpens > 0) {
    const real = plural(engagement.realOpens, "open", "opens");
    const machines = engagement.rawOpens - engagement.realOpens;
    return machines > 0
      ? `${real} · ${machines} filtered as automatic`
      : real;
  }
  if (engagement.rawOpens > 0) {
    return `${plural(engagement.rawOpens, "load", "loads")}, all automatic`;
  }
  return "Not opened";
}

export function clickTitle(engagement: Engagement): string {
  if (!engagement.tracked) return "Link tracking was off for this email";
  if (engagement.realClicks > 0) {
    const real = plural(engagement.realClicks, "click", "clicks");
    const machines = engagement.rawClicks - engagement.realClicks;
    return machines > 0 ? `${real} · ${machines} filtered as automatic` : real;
  }
  if (engagement.rawClicks > 0) {
    return `${plural(engagement.rawClicks, "visit", "visits")}, all from link scanners`;
  }
  return "No links clicked";
}

function trackedState(happened: boolean, tracked: boolean): ChipState {
  if (happened) return "on";
  return tracked ? "off" : "unknown";
}

export function EngagementChips({
  engagement,
  pending,
  className,
}: {
  engagement: Engagement;
  pending?: boolean;
  className?: string;
}) {
  if (pending) {
    return (
      <span className={cn("inline-flex items-center gap-0.5", className)}>
        <Chip state="pending" icon={IconMail} title="Queued to send" />
        <Chip state="pending" icon={IconEye} title="Not sent yet" />
        <Chip state="pending" icon={IconPointer} title="Not sent yet" />
        <Chip state="pending" icon={IconArrowBackUp} title="Not sent yet" />
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      <Chip
        state={engagement.sent ? "on" : "off"}
        icon={IconMail}
        title={engagement.bounced ? "Sent, then bounced" : "Sent"}
      />
      <Chip
        state={trackedState(engagement.opened, engagement.tracked)}
        icon={IconEye}
        title={openTitle(engagement)}
      />
      <Chip
        state={trackedState(engagement.clicked, engagement.tracked)}
        icon={IconPointer}
        title={clickTitle(engagement)}
      />
      <Chip
        state={engagement.replied ? "on" : "off"}
        icon={IconArrowBackUp}
        title={engagement.replied ? "Replied" : "No reply yet"}
      />
    </span>
  );
}
