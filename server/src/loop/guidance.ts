import type { GoalLoop } from "./types";

/**
 * What the orchestrator is told on the next turn about this goal's loop.
 *
 * Keep / revise / revert and the last outcome have to be visible here, or the
 * system cannot learn from the owner's answer.
 */
export function orchestratorContextFromLoop(loop: GoalLoop): string | null {
  const lines: string[] = [];
  if (loop.expectedImpact) {
    lines.push(`Expected impact: ${loop.expectedImpact}`);
  }
  if (loop.outcome) {
    lines.push(`Measured outcome: ${loop.outcome}`);
  }
  if (loop.approval?.status === "waiting") {
    lines.push(
      [
        "An approval card is waiting on this goal. Do not silently retry the pending action.",
        `Rationale: ${loop.approval.rationale}`,
        `Proposed after: ${loop.approval.after}`,
        `Rollback: ${loop.approval.rollback}`,
      ].join(" "),
    );
  }
  if (loop.lastDecision) {
    const note = loop.lastDecision.note
      ? ` Note: ${loop.lastDecision.note}`
      : "";
    const tool = loop.lastDecision.toolName
      ? ` (was ${loop.lastDecision.toolName})`
      : "";
    lines.push(
      `Owner's last decision on this goal: ${loop.lastDecision.decision}${tool} at ${loop.lastDecision.at}.${note}`,
    );
  }
  if (loop.decisions.length > 1) {
    const prior = loop.decisions
      .slice(0, 5)
      .map(
        (item) => `${item.decision}${item.toolName ? ` ${item.toolName}` : ""}`,
      )
      .join("; ");
    lines.push(`Prior keep/revise/revert on this goal: ${prior}.`);
  }
  if (lines.length === 0) return null;
  return [
    "Goal loop (this goal — measure and improve on the same object):",
    ...lines,
  ].join("\n");
}
