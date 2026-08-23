import { CONTACT_STAGE_DEFS, contactStageLabel } from "@/lib/crm/stages";

/** Pipeline stage colors — copied from LimitlessAI-2 `src/lib/crm/colors.ts`. */
export const STAGE_PALETTE: Record<
  string,
  { solid: string; soft: string; label: string }
> = {
  new: {
    solid: "oklch(0.55 0.012 286)",
    soft: "oklch(0.55 0.012 286 / 0.12)",
    label: "New",
  },
  researched: {
    solid: "oklch(0.5 0.1 256)",
    soft: "oklch(0.5 0.1 256 / 0.12)",
    label: "Researched",
  },
  contacted: {
    solid: "oklch(0.52 0.14 256)",
    soft: "oklch(0.52 0.14 256 / 0.12)",
    label: "Contacted",
  },
  replied: {
    solid: "oklch(0.55 0.16 256)",
    soft: "oklch(0.55 0.16 256 / 0.14)",
    label: "Replied",
  },
  interested: {
    solid: "oklch(0.52 0.14 150)",
    soft: "oklch(0.52 0.14 150 / 0.14)",
    label: "Interested",
  },
  booked: {
    solid: "oklch(0.55 0.16 150)",
    soft: "oklch(0.55 0.16 150 / 0.14)",
    label: "Booked",
  },
  qualified: {
    solid: "oklch(0.5 0.12 150)",
    soft: "oklch(0.5 0.12 150 / 0.14)",
    label: "Qualified",
  },
  won: {
    solid: "oklch(0.48 0.17 150)",
    soft: "oklch(0.48 0.17 150 / 0.14)",
    label: "Won",
  },
  lost: {
    solid: "oklch(0.52 0.18 28)",
    soft: "oklch(0.52 0.18 28 / 0.12)",
    label: "Lost",
  },
  nurture: {
    solid: "oklch(0.48 0.08 256)",
    soft: "oklch(0.48 0.08 256 / 0.12)",
    label: "Nurture",
  },
  dnc: {
    solid: "oklch(0.45 0.012 286)",
    soft: "oklch(0.45 0.012 286 / 0.12)",
    label: "DNC",
  },
};

export function stageStyle(key: string, fallbackColor?: string) {
  const pal = STAGE_PALETTE[key];
  if (pal) return pal;
  const def = CONTACT_STAGE_DEFS.find((stage) => stage.key === key);
  return {
    label: def?.label || key,
    solid: fallbackColor || "oklch(0.52 0.04 286)",
    soft: "oklch(0.52 0.04 286 / 0.1)",
  };
}

export function stageLabel(
  key: string,
  stages?: { key: string; label: string }[],
) {
  const fromList = stages?.find((s) => s.key === key)?.label;
  if (fromList) return fromList;
  return STAGE_PALETTE[key]?.label || contactStageLabel(key);
}

export const STATUS_PALETTE = {
  draft: {
    fg: "oklch(0.45 0.012 286)",
    bg: "oklch(0.45 0.012 286 / 0.1)",
    label: "Draft",
  },
  active: {
    fg: "oklch(0.43 0.119 150)",
    bg: "oklch(0.66 0.17 150 / 0.16)",
    label: "Active",
  },
  running: {
    fg: "oklch(0.43 0.119 150)",
    bg: "oklch(0.66 0.17 150 / 0.16)",
    label: "Active",
  },
  paused: {
    fg: "oklch(0.42 0.14 256)",
    bg: "oklch(0.55 0.19 256 / 0.12)",
    label: "Paused",
  },
  archived: {
    fg: "oklch(0.45 0.012 286)",
    bg: "oklch(0.45 0.012 286 / 0.08)",
    label: "Archived",
  },
  completed: {
    fg: "oklch(0.45 0.012 286)",
    bg: "oklch(0.45 0.012 286 / 0.08)",
    label: "Archived",
  },
} as const;

export function campaignStatusStyle(status: string) {
  const key = status as keyof typeof STATUS_PALETTE;
  return STATUS_PALETTE[key] || STATUS_PALETTE.draft;
}
