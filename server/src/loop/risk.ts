/**
 * High vs low risk from the live gateway's own intents and tool names.
 *
 * Not a second policy engine. Reads, search, navigate, and clicks still auto-run
 * once the gateway permits them. Writes that move the business wait as an
 * approval card on the goal.
 */
import {
  CRM_CREATE_TOOL,
  CRM_SEND_TOOL,
  CRM_UPDATE_TOOL,
} from "../crm/gateway";
import type { PolicyContext } from "../computer/policy";

export type ActionRisk = "low" | "high";

const HIGH_RISK_TOOLS = new Set([
  CRM_CREATE_TOOL,
  CRM_UPDATE_TOOL,
  CRM_SEND_TOOL,
  "computer_write_file",
  "computer_run_command",
]);

export function toolNameRisk(name: string): ActionRisk {
  return HIGH_RISK_TOOLS.has(name) ? "high" : "low";
}

export function actionRisk(context: PolicyContext): ActionRisk {
  if (
    context.intent === "write_tool" ||
    context.intent === "write_file" ||
    context.intent === "run_command"
  ) {
    return "high";
  }
  if (context.intent === "crm") {
    return toolNameRisk(context.tool.name);
  }
  return toolNameRisk(context.tool.name);
}
