/**
 * The orchestrator’s tool for a finite specialist. Execution is startSpecialist,
 * which enqueues via enqueueUnattendedJob. Close the tab and the worker still runs.
 */
import { z } from "zod";
import type { AgentActor } from "../agents/profile-types";
import { REFUSAL_MARKER } from "../plugins/refusal";
import type { GrantedTool } from "../plugins/tools";
import type { ToolRunContext } from "./run-context";
import {
  SPECIALIST_REFUSALS,
  type StartSpecialistInput,
  type StartSpecialistResult,
} from "./specialist";

const parameters = z.object({
  task: z
    .string()
    .describe(
      "The finite chunk of work. The specialist reports back on this goal when it is done.",
    ),
  kind: z
    .enum(["campaign", "research", "sales"])
    .optional()
    .describe(
      "The owner job. campaign = email campaign end to end. research = marketing research that actually researches. sales = always-on sales (standing wake). Prefer this over leftover coworker ids. The owner does not pick a bot.",
    ),
  specialist_id: z
    .string()
    .optional()
    .describe(
      "A coworker in this organization to start. Omit when kind or a skill/playbook is enough.",
    ),
  skill_slug: z
    .string()
    .optional()
    .describe(
      "A skill or playbook in this organization for the specialist to follow.",
    ),
  with_computer: z
    .boolean()
    .optional()
    .describe(
      "Whether to hand the specialist computer work. Defaults to true when this deployment has a computer.",
    ),
});

export function startSpecialistTool(options: {
  actor: AgentActor;
  parentCoworkerId: string;
  runContext?: ToolRunContext;
  start: (input: StartSpecialistInput) => Promise<StartSpecialistResult>;
}): GrantedTool {
  return {
    name: "start_specialist",
    description:
      "Stand up a specialist worker on this goal. The owner said the job; you pick kind and spawn. kind=campaign for an email campaign (audience, copy, send, track — owner is not in composer for each email). kind=research for marketing research (the worker actually researches; owner does not paste articles). kind=sales for always-on sales (standing wake; owner only when blocked). Workers join this goal’s room, share the organization’s CRM, enqueue an unattended job, and continue after the tab closes. Do not run the whole job yourself in this turn. Do not ask the owner to pick a worker from a roster.",
    parameters,
    execute: async (args) => {
      const parsed = parameters.safeParse(args);
      if (!parsed.success) {
        const task =
          typeof (args as { task?: unknown }).task === "string"
            ? (args as { task: string }).task.trim()
            : "";
        return `${REFUSAL_MARKER} ${task ? SPECIALIST_REFUSALS.NO_SPECIALIST : SPECIALIST_REFUSALS.TASK_REQUIRED}`;
      }
      const threadId = options.runContext?.threadId?.trim() ?? "";
      if (!threadId || !options.runContext) {
        return `${REFUSAL_MARKER} ${SPECIALIST_REFUSALS.NO_THREAD}`;
      }
      const kind = parsed.data.kind;
      const specialistId = parsed.data.specialist_id?.trim();
      const skillSlug = parsed.data.skill_slug?.trim();
      if (!kind && !specialistId && !skillSlug) {
        return `${REFUSAL_MARKER} ${SPECIALIST_REFUSALS.NO_SPECIALIST}`;
      }
      const result = await options.start({
        actor: options.actor,
        orgId: options.actor.orgId ?? "",
        channelId: options.runContext.channelId,
        threadId,
        parentCoworkerId: options.parentCoworkerId,
        task: parsed.data.task,
        ...(kind ? { kind } : {}),
        ...(specialistId ? { specialistId } : {}),
        ...(skillSlug ? { skillSlug } : {}),
        withComputer: parsed.data.with_computer,
      });
      if (!result.ok) {
        return `${REFUSAL_MARKER} ${result.error}`;
      }
      const lines = [
        result.kind
          ? `Started the ${result.kind} worker ${result.coworkerId} on this goal.`
          : `Started specialist ${result.coworkerId} on this goal.`,
        `They share this organization’s CRM (${result.orgId}).`,
        `Unattended job ${result.jobId} is queued on thread ${result.threadId}.`,
        "They will report back on this goal when the chunk is done.",
      ];
      if (result.standingTriggerId) {
        lines.push(
          "Always-on sales will keep going on a standing wake; the owner is pulled in only when something is blocked.",
        );
      }
      return lines.join(" ");
    },
  };
}
