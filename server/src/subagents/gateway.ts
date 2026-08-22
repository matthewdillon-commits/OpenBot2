import type { AgentActor } from "../agents/profile-types";
import { type AuditStore, recordAuditEvent } from "../audit";
import { isEmptyOrAck, MAX_MESSAGE_HOP } from "../channels/ack";
import type { ChannelMessageStore } from "../channels/messages";
import type { AgentChannel, ChannelStore } from "../channels/routes";
import type { WakeQueue } from "../channels/wake";
import {
  type ActionPolicy,
  evaluateActionPolicy,
  type PolicyContext,
  type PolicyDecision,
} from "../computer/policy";
import { REFUSAL_MARKER } from "../plugins/tools";
import type { SubagentRun, SubagentStatus, SubagentStore } from "./store";

export const SPAWN_SUBAGENT_TOOL = "spawn_subagent";
export const REPORT_SUBAGENT_TOOL = "report_subagent";

export type SubagentGateway = {
  spawn(input: {
    botId: string;
    actor: AgentActor;
    goal: string;
    successCriteria: string;
    reportBack: string;
    subagentId?: string;
  }): Promise<string>;
  report(input: {
    botId: string;
    actor: AgentActor;
    subagentId: string;
    status: "done" | "blocked" | "failed";
    result: string;
  }): Promise<string>;
};

export function createSubagentGateway(options: {
  runs: SubagentStore;
  channels: ChannelStore;
  messages: ChannelMessageStore;
  auditStore: AuditStore;
  policy: () => ActionPolicy | undefined;
  wake: WakeQueue;
}): SubagentGateway {
  const { runs, channels, messages, auditStore, policy, wake } = options;

  const decide = async (input: {
    botId: string;
    actor: AgentActor;
    tool: typeof SPAWN_SUBAGENT_TOOL | typeof REPORT_SUBAGENT_TOOL;
    text: string;
    hop: number;
    channelId: string;
    subagentId: string | null;
  }): Promise<
    | { ok: false; refused: string }
    | { ok: true; text: string; verdict: PolicyDecision }
  > => {
    const trimmed = input.text.trim();
    if (isEmptyOrAck(trimmed)) {
      return {
        ok: false,
        refused: `${REFUSAL_MARKER} A sub-agent needs a real brief, not an acknowledgement.`,
      };
    }
    if (input.hop > MAX_MESSAGE_HOP) {
      return {
        ok: false,
        refused: `${REFUSAL_MARKER} That sub-agent has gone far enough without a person.`,
      };
    }

    const verdict = evaluateActionPolicy(
      policy(),
      policyContext({
        tool: input.tool,
        botId: input.botId,
        actorId: input.actor.id,
        channelId: input.channelId,
        subagentId: input.subagentId,
      }),
    );

    await writeAudit(auditStore, {
      actor: input.actor,
      botId: input.botId,
      channelId: input.channelId,
      subagentId: input.subagentId,
      tool: input.tool,
      hop: input.hop,
      text: trimmed,
      verdict,
      event:
        input.tool === REPORT_SUBAGENT_TOOL
          ? verdict.forward
            ? "subagent.reported"
            : "subagent.refused"
          : verdict.forward
            ? "subagent.started"
            : "subagent.refused",
    });

    if (!verdict.forward) {
      return { ok: false, refused: `${REFUSAL_MARKER} ${verdict.reason}` };
    }
    return { ok: true, text: trimmed, verdict };
  };

  return {
    async spawn(input) {
      const existingId = input.subagentId?.trim();
      if (existingId) {
        return followUp(input, existingId);
      }

      const goal = input.goal.trim();
      const successCriteria = input.successCriteria.trim();
      const reportBack = input.reportBack.trim();
      if (!goal || !successCriteria || !reportBack) {
        return `${REFUSAL_MARKER} A new sub-agent needs a goal, success criteria, and what to report back.`;
      }
      if (
        isEmptyOrAck(goal) ||
        isEmptyOrAck(successCriteria) ||
        isEmptyOrAck(reportBack)
      ) {
        return `${REFUSAL_MARKER} A sub-agent needs a real brief, not an acknowledgement.`;
      }

      const decided = await decide({
        botId: input.botId,
        actor: input.actor,
        tool: SPAWN_SUBAGENT_TOOL,
        text: [goal, successCriteria, reportBack].join("\n"),
        hop: 1,
        channelId: "",
        subagentId: null,
      });
      if (!decided.ok) return decided.refused;

      let channel: AgentChannel;
      try {
        channel = await channels.create(input.actor, [input.botId], {
          kind: "task",
          name: taskName(goal),
        });
      } catch (error) {
        return `${REFUSAL_MARKER} ${error instanceof Error ? error.message : "That sub-agent could not be started."}`;
      }

      const run = await runs.create({
        parentAgentId: input.botId,
        actor: input.actor,
        channelId: channel.id,
        goal,
        successCriteria,
        reportBack,
      });

      const posted = await messages.post({
        channelId: channel.id,
        senderAgentId: input.botId,
        body: briefOf(run),
        hop: 1,
      });

      wake.enqueue({
        channelId: channel.id,
        botId: input.botId,
        actor: input.actor,
        inbound: posted,
        subagentId: run.id,
      });

      return `Started sub-agent ${run.id}. It will report back when done or when it hits a real blocker. Do not wait.`;
    },

    async report(input) {
      const run = await runs.getForParent(
        input.actor,
        input.botId,
        input.subagentId,
      );
      if (!run) {
        return `${REFUSAL_MARKER} That sub-agent was not found.`;
      }
      if (
        run.status === "completed" ||
        run.status === "blocked" ||
        run.status === "failed"
      ) {
        return `${REFUSAL_MARKER} That sub-agent has already reported.`;
      }

      const decided = await decide({
        botId: input.botId,
        actor: input.actor,
        tool: REPORT_SUBAGENT_TOOL,
        text: input.result,
        hop: run.hop,
        channelId: run.channelId,
        subagentId: run.id,
      });
      if (!decided.ok) return decided.refused;

      const status = reportStatus(input.status);
      const completed = await runs.complete(run.id, status, decided.text);
      const posted = await messages.post({
        channelId: completed.channelId,
        senderAgentId: completed.parentAgentId,
        body: resultOf(completed),
        hop: completed.hop,
      });

      wake.enqueue({
        channelId: completed.channelId,
        botId: completed.parentAgentId,
        actor: input.actor,
        inbound: posted,
      });

      return "Reported to the parent. They will see it and may continue; do not wait.";
    },
  };

  async function followUp(
    input: {
      botId: string;
      actor: AgentActor;
      goal: string;
    },
    subagentId: string,
  ): Promise<string> {
    const run = await runs.getForParent(input.actor, input.botId, subagentId);
    if (!run) {
      return `${REFUSAL_MARKER} That sub-agent was not found.`;
    }

    const hop = run.hop + 1;
    const decided = await decide({
      botId: input.botId,
      actor: input.actor,
      tool: SPAWN_SUBAGENT_TOOL,
      text: input.goal,
      hop,
      channelId: run.channelId,
      subagentId: run.id,
    });
    if (!decided.ok) return decided.refused;

    const nextStatus: SubagentStatus =
      run.status === "running" ? "running" : "queued";
    const updated = await runs.setFollowUp(
      run.id,
      decided.text,
      hop,
      nextStatus,
    );

    const posted = await messages.post({
      channelId: updated.channelId,
      senderAgentId: updated.parentAgentId,
      body: `Follow-up from the parent:\n${decided.text}`,
      hop,
    });

    wake.enqueue({
      channelId: updated.channelId,
      botId: updated.parentAgentId,
      actor: input.actor,
      inbound: posted,
      subagentId: updated.id,
    });

    return `Sent the follow-up to sub-agent ${updated.id}. It will report back; do not wait.`;
  }
}

function reportStatus(
  status: "done" | "blocked" | "failed",
): "completed" | "blocked" | "failed" {
  if (status === "blocked") return "blocked";
  if (status === "failed") return "failed";
  return "completed";
}

function taskName(goal: string): string {
  const flattened = goal.replace(/\s+/g, " ").trim();
  const codePoints = Array.from(flattened);
  if (codePoints.length <= 80) return `Sub-agent: ${flattened}`;
  return `Sub-agent: ${codePoints.slice(0, 79).join("")}…`;
}

export function briefOf(run: SubagentRun): string {
  const lines = [
    `Goal:\n${run.goal}`,
    `Success criteria:\n${run.successCriteria}`,
    `What to report back:\n${run.reportBack}`,
  ];
  if (run.followUp) {
    lines.push(`Follow-up from the parent:\n${run.followUp}`);
  }
  if (run.result) {
    lines.push(`Your previous report:\n${run.result}`);
  }
  return lines.join("\n\n");
}

function resultOf(run: SubagentRun): string {
  const label =
    run.status === "blocked"
      ? "blocked"
      : run.status === "failed"
        ? "failed"
        : "done";
  return `Sub-agent ${run.id} ${label}:\n${run.result ?? ""}`.trim();
}

function policyContext(input: {
  tool: string;
  botId: string;
  actorId: string;
  channelId: string;
  subagentId: string | null;
}): PolicyContext {
  return {
    tool: { name: input.tool },
    bot: { id: input.botId },
    actor: { id: input.actorId },
    page: { url: "", host: "" },
    element: { ref: "", role: "", name: "", type: "" },
    key: "",
    file: { path: "", name: "", extension: "" },
    command: "",
    intent: "spawn",
    channel: { id: input.channelId },
    recipient: { id: input.subagentId ?? "" },
  };
}

async function writeAudit(
  auditStore: AuditStore,
  entry: {
    actor: AgentActor;
    botId: string;
    channelId: string;
    subagentId: string | null;
    tool: string;
    hop: number;
    text: string;
    verdict: PolicyDecision;
    event: "subagent.started" | "subagent.refused" | "subagent.reported";
  },
) {
  await recordAuditEvent(auditStore, {
    eventType: entry.event,
    targetType: "subagent",
    targetId: entry.subagentId || entry.botId,
    actorUserId: entry.actor.id,
    payload: {
      bot: entry.botId,
      actor: entry.actor.id,
      tool: entry.tool,
      hop: entry.hop,
      subagent: entry.subagentId,
      channel: entry.channelId || null,
      text: entry.text,
      decision: {
        allowed: entry.verdict.allowed,
        mode: entry.verdict.mode,
        source: entry.verdict.source,
        rule: entry.verdict.matched,
        carriedOut: entry.verdict.forward,
      },
    },
  });
}
