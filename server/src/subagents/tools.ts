import { z } from "zod";
import type { AgentActor } from "../agents/profile-types";
import type { GrantedTool } from "../plugins/tools";
import {
  REPORT_SUBAGENT_TOOL,
  SPAWN_SUBAGENT_TOOL,
  type SubagentGateway,
} from "./gateway";

const spawnParameters = z.object({
  goal: z
    .string()
    .describe(
      "The self-contained job, or a follow-up / correction when subagent_id is set.",
    ),
  success_criteria: z
    .string()
    .optional()
    .describe(
      "How to tell the job is done. Required when starting a new sub-agent.",
    ),
  report_back: z
    .string()
    .optional()
    .describe(
      "What the parent needs back: a finding, a file, a decision. Required when starting a new sub-agent.",
    ),
  subagent_id: z
    .string()
    .optional()
    .describe(
      "An existing sub-agent to correct or continue. Omit to start a new independent one.",
    ),
});

const reportParameters = z.object({
  status: z
    .enum(["done", "blocked"])
    .describe(
      "done when the brief is met. blocked when something real stops the work.",
    ),
  result: z
    .string()
    .describe(
      "What the parent needs: the finding, or the blocker they can act on.",
    ),
});

/**
 * The tool a parent Bot uses to start a background worker, or to correct one it already started.
 *
 * Offered beside messaging: no per-Bot grant. The gateway still decides and records every spawn.
 * A follow-up names the same id so the work stays on that worker rather than opening a duplicate.
 */
export function subagentTools(options: {
  subagents: SubagentGateway;
  botId: string;
  actor: AgentActor;
}): GrantedTool[] {
  const { subagents, botId, actor } = options;

  return [
    {
      name: SPAWN_SUBAGENT_TOOL,
      description:
        "Start a sub-agent for a self-contained chunk of work, or send a follow-up to one you already started. " +
        "The call returns an id immediately — do not wait. The worker does not talk to the person; it reports to you when done or when it hits a real blocker. " +
        "Start a new one for independent work. Pass subagent_id to correct or continue the same worker. " +
        "Never use this for a standing coworker role.",
      parameters: spawnParameters,
      execute: async (args: unknown) => {
        const parsed = spawnParameters.safeParse(args);
        if (!parsed.success) {
          return "That spawn needs a goal. A new sub-agent also needs success_criteria and report_back.";
        }
        return subagents.spawn({
          botId,
          actor,
          goal: parsed.data.goal,
          successCriteria: parsed.data.success_criteria ?? "",
          reportBack: parsed.data.report_back ?? "",
          ...(parsed.data.subagent_id
            ? { subagentId: parsed.data.subagent_id.trim() }
            : {}),
        });
      },
    },
  ];
}

/**
 * The only way a child run talks back. Not offered to a parent conversation.
 */
export function reportSubagentTool(options: {
  subagents: SubagentGateway;
  botId: string;
  actor: AgentActor;
  subagentId: string;
}): GrantedTool {
  const { subagents, botId, actor, subagentId } = options;

  return {
    name: REPORT_SUBAGENT_TOOL,
    description:
      "Report the result of this sub-agent to the parent. Call this when the brief is met, or when a real blocker stops the work. " +
      "Do not talk to the person. Do not start another sub-agent.",
    parameters: reportParameters,
    execute: async (args: unknown) => {
      const parsed = reportParameters.safeParse(args);
      if (!parsed.success) {
        return "That report needs status (done or blocked) and result.";
      }
      return subagents.report({
        botId,
        actor,
        subagentId,
        status: parsed.data.status,
        result: parsed.data.result,
      });
    },
  };
}
