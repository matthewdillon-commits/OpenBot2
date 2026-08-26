import type { LoopStage } from "./queries";

/** Loop-stage chrome on the goal only. Statuses stay Active | Needs you | Done. */
export const LOOP_STAGE_LABEL: Record<LoopStage, string> = {
  observe: "Observe",
  understand: "Understand",
  prioritize: "Prioritize",
  act: "Act",
  measure: "Measure",
  improve: "Improve",
};

export function loopStageLabel(
  stage: LoopStage | null | undefined,
): string | null {
  return stage ? LOOP_STAGE_LABEL[stage] : null;
}

/**
 * Before/After on the approval card. Stored JSON from an older write is
 * flattened so the owner reads fields, not a dump.
 */
export function readableLoopText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => String(entry)).join(", ");
    }
    if (!parsed || typeof parsed !== "object") return value;
    const parts = Object.entries(parsed as Record<string, unknown>)
      .filter(
        ([, entry]) => entry !== undefined && entry !== null && entry !== "",
      )
      .map(([key, entry]) => {
        const label = key.replace(/_/g, " ");
        if (
          typeof entry === "string" ||
          typeof entry === "number" ||
          typeof entry === "boolean"
        ) {
          return `${label}: ${entry}`;
        }
        try {
          return `${label}: ${JSON.stringify(entry)}`;
        } catch {
          return label;
        }
      });
    return parts.length > 0 ? parts.join(" · ") : value;
  } catch {
    return value;
  }
}
