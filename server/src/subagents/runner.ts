import { HttpAgent } from "@ag-ui/client";
import { z } from "zod";
import type { AgentProfileStore } from "../agents/profile-store";
import type { WakeJob } from "../channels/wake";
import { standingRoleMessage } from "../copilot";
import type { GrantedTool } from "../plugins/tools";
import { briefOf, type SubagentGateway } from "./gateway";
import type { SubagentStore } from "./store";

export type SubagentRunner = (job: WakeJob) => Promise<string | null>;

/**
 * Run a child in the background on the parent's Bot profile.
 *
 * The parent has already been told the id. This is the later half: load the brief, run the
 * endpoint, and if the child never called `report_subagent`, take its last words as the report
 * so the parent is still woken. A follow-up that landed while this job was running is picked
 * up after the report and enqueued as the same worker.
 */
export function createSubagentRunner(options: {
  profiles: AgentProfileStore;
  runs: SubagentStore;
  subagents: () => SubagentGateway;
  loadTools: (job: WakeJob) => Promise<GrantedTool[]>;
  signRun?: (input: {
    botId: string;
    actorId: string;
    runId: string;
    subagentId: string;
  }) => string;
  enqueue: (job: WakeJob) => void;
}): SubagentRunner {
  const { profiles, runs, subagents, loadTools, signRun, enqueue } = options;

  return async (job) => {
    if (!job.subagentId) return null;

    const run = await runs.get(job.actor, job.subagentId);
    if (!run) return null;

    const startedAt = new Date();
    await runs.markRunning(run.id);

    const profile = await profiles.get(job.actor, job.botId);
    if (!profile || profile.deletedAt || !profile.endpoint) {
      await subagents().report({
        botId: job.botId,
        actor: job.actor,
        subagentId: run.id,
        status: "failed",
        result:
          "This coworker has no endpoint to run a sub-agent, so the work could not start.",
      });
      return null;
    }

    const tools = await loadTools(job);
    const reply = await runChild({
      botId: job.botId,
      name: profile.name,
      title: profile.title,
      roleDescription: profile.roleDescription,
      endpoint: profile.endpoint,
      brief: briefOf(run),
      inboundId: job.inbound.id,
      tools,
      runAssertion: signRun?.({
        botId: job.botId,
        actorId: job.actor.id,
        runId: job.inbound.id,
        subagentId: run.id,
      }),
    });

    const latest = await runs.get(job.actor, run.id);
    if (latest && (latest.status === "queued" || latest.status === "running")) {
      await subagents().report({
        botId: job.botId,
        actor: job.actor,
        subagentId: run.id,
        status: reply ? "done" : "failed",
        result: reply ?? "The sub-agent finished without a report.",
      });
    }

    const after = await runs.get(job.actor, run.id);
    if (after?.followUpAt && after.followUpAt > startedAt) {
      enqueue({
        ...job,
        subagentId: after.id,
      });
    }

    return reply;
  };
}

async function runChild(input: {
  botId: string;
  name: string;
  title: string;
  roleDescription: string;
  endpoint: string;
  brief: string;
  inboundId: string;
  tools: GrantedTool[];
  runAssertion?: string;
}): Promise<string | null> {
  const standing = standingRoleMessage({
    id: input.botId,
    name: input.name,
    title: input.title,
    roleDescription: input.roleDescription,
  });

  const agent = new HttpAgent({
    url: input.endpoint,
    agentId: input.botId,
  });
  agent.setMessages([
    standing,
    {
      id: `subagent-brief:${input.inboundId}`,
      role: "system",
      content: [
        "You are a sub-agent. You do not talk to the person.",
        "You have one finite job. Use the tools you were offered to do it.",
        "You have this coworker's computer: the same browser, files, and shell.",
        "A person is not watching this run. They will see what you did on the audit trail.",
        "When you need to look at a page, call computer_navigate. Never claim you cannot browse.",
        "To act on a page: computer_snapshot first, then computer_type and computer_click with those refs and the snapshotId.",
        "Never invent a ref. If refs are stale, snapshot again.",
        "If you need a person — a sign-in, a password, a code, a CAPTCHA — call computer_request_help or computer_request_secret.",
        "That reports blocked to the parent with what they must do. Do not wait. Do not poll.",
        "If an action says a person has control, call report_subagent with status blocked and what they need to do. Do not retry.",
        "When the brief is met, or when a real blocker stops you, call report_subagent.",
        "Do not message a coworker. Do not start another sub-agent. Do not acknowledge.",
        "",
        input.brief,
      ].join("\n"),
    },
    {
      id: input.inboundId,
      role: "user",
      content: input.brief,
    },
  ]);

  try {
    await agent.runAgent({
      tools: input.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: z.toJSONSchema(tool.parameters) as Record<string, unknown>,
      })),
      forwardedProps: {
        openbotBotId: input.botId,
        openbotDeploymentTools: input.tools.map((tool) => tool.name),
        ...(input.runAssertion ? { openbotRun: input.runAssertion } : {}),
      },
    } as never);
  } catch (error) {
    console.error(
      JSON.stringify({
        type: "subagent-run-failed",
        botId: input.botId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }

  const last = [...agent.messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const content = typeof last?.content === "string" ? last.content : "";
  return content.trim() ? content : null;
}
