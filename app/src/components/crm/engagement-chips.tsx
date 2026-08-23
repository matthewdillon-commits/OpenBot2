import { Eye, Mail, MousePointerClick, Reply } from "lucide-react";
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
  icon: typeof Mail;
  title: string;
}) {
  return (
    <span
      className={cn("ui-engage-chip")}
      data-state={state}
      title={title}
      aria-label={title}
      role="img"
    >
      <Icon className="h-3 w-3" strokeWidth={2} aria-hidden />
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
    return `${plural(engagement.rawOpens, "load", "loads")}, all automatic — Apple and scanners fetch images on delivery, so this is not a read`;
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
      <span className={cn("ui-engage-row", className)}>
        <Chip state="pending" icon={Mail} title="Queued to send" />
        <Chip state="pending" icon={Eye} title="Not sent yet" />
        <Chip state="pending" icon={MousePointerClick} title="Not sent yet" />
        <Chip state="pending" icon={Reply} title="Not sent yet" />
      </span>
    );
  }

  return (
    <span className={cn("ui-engage-row", className)}>
      <Chip
        state={engagement.sent ? "on" : "off"}
        icon={Mail}
        title={engagement.bounced ? "Sent, then bounced" : "Sent"}
      />
      <Chip
        state={trackedState(engagement.opened, engagement.tracked)}
        icon={Eye}
        title={openTitle(engagement)}
      />
      <Chip
        state={trackedState(engagement.clicked, engagement.tracked)}
        icon={MousePointerClick}
        title={clickTitle(engagement)}
      />
      <Chip
        state={engagement.replied ? "on" : "off"}
        icon={Reply}
        title={engagement.replied ? "Replied" : "No reply yet"}
      />
    </span>
  );
}
