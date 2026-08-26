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
  specialist_id: z
    .string()
    .optional()
    .describe(
      "A coworker in this organization to start. Omit when a skill/playbook is enough.",
    ),
  skill_slug: z
    .string()
    .optional()
    .describe(
      "A skill or playbook in this organization for the specialist to follow.",
    ),
  with_computer: z
    .boolean()
    .default(true)
    .describe(
      "Hand the specialist this deployment's computer (browser, files, shell). Defaults to true. Set false only to withhold it.",
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
      "Start a finite specialist on this goal. They join this goal’s room, share the organization’s CRM, get this computer unless you set with_computer to false, and continue after the tab closes. Use this instead of asking the owner to pick a worker from a roster.",
    parameters,
    execute: async (args) => {
      const parsed = parameters.safeParse(args);
      if (!parsed.success) {
        return `${REFUSAL_MARKER} ${SPECIALIST_REFUSALS.TASK_REQUIRED}`;
      }
      const threadId = options.runContext?.threadId?.trim() ?? "";
      if (!threadId || !options.runContext) {
        return `${REFUSAL_MARKER} ${SPECIALIST_REFUSALS.NO_THREAD}`;
      }
      const specialistId = parsed.data.specialist_id?.trim();
      const skillSlug = parsed.data.skill_slug?.trim();
      if (!specialistId && !skillSlug) {
        return `${REFUSAL_MARKER} ${SPECIALIST_REFUSALS.NO_SPECIALIST}`;
      }
      const result = await options.start({
        actor: options.actor,
        orgId: options.actor.orgId ?? "",
        channelId: options.runContext.channelId,
        threadId,
        parentCoworkerId: options.parentCoworkerId,
        task: parsed.data.task,
        ...(specialistId ? { specialistId } : {}),
        ...(skillSlug ? { skillSlug } : {}),
        withComputer: parsed.data.with_computer,
      });
      if (!result.ok) {
        return `${REFUSAL_MARKER} ${result.error}`;
      }
      return [
        `Started specialist ${result.coworkerId} on this goal.`,
        `They share this organization’s CRM (${result.orgId}).`,
        `Unattended job ${result.jobId} is queued on thread ${result.threadId}.`,
        "They will report back on this goal when the chunk is done.",
      ].join(" ");
    },
  };
}
