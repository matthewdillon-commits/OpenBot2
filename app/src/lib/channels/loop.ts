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
