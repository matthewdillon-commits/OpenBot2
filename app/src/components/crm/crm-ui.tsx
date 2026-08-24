import { IconPlus } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { stageLabel, stageStyle } from "@/lib/crm/colors";
import { avatarHue, personInitials } from "@/components/crm/crm-marks";
import { cn } from "@/lib/utils";

export function CrmAvatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const hue = avatarHue(name);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-[0.65rem] font-medium",
        className,
      )}
      style={{
        background: `oklch(0.92 0.04 ${hue})`,
        color: `oklch(0.38 0.08 ${hue})`,
      }}
    >
      {personInitials(name)}
    </span>
  );
}

/** Stage is a label first. The dot is a second signal, not the only one. */
export function CrmStage({ stageKey }: { stageKey: string }) {
  const stage = stageStyle(stageKey);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: stage.solid }}
      />
      <span className="truncate text-foreground">{stageLabel(stageKey)}</span>
    </span>
  );
}

export function CrmEmpty({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <Empty className="h-full min-h-[12rem] border border-dashed">
      <EmptyHeader>
        <EmptyTitle className="text-muted-foreground">{title}</EmptyTitle>
        <p className="max-w-prose text-pretty text-muted-foreground text-sm">
          {description}
        </p>
        {actionLabel && onAction ? (
          <Button className="mt-2" onClick={onAction} size="sm" variant="ghost">
            <IconPlus />
            {actionLabel}
          </Button>
        ) : null}
      </EmptyHeader>
    </Empty>
  );
}

export function CrmError({
  label,
  onRetry,
}: {
  label: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="max-w-sm text-center">
        <p className="font-medium text-sm text-balance" role="alert">
          Couldn’t load {label}.
        </p>
        <p className="mt-1.5 text-pretty text-muted-foreground text-sm">
          Check your connection and try again.
        </p>
        <Button className="mt-4" onClick={onRetry} size="sm" variant="outline">
          Try again
        </Button>
      </div>
    </div>
  );
}

export function CrmField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

export const crmControlClassName =
  "h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";
