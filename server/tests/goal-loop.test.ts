import { describe, expect, test } from "bun:test";
import {
  actionRisk,
  applyJobOutcomeToLoop,
  APPROVAL_WAIT_MARKER,
  createHighRiskWait,
  createMemoryGoalLoopStore,
  emptyGoalLoop,
  executePendingWithTools,
  orchestratorContextFromLoop,
  publicGoalLoop,
  recordUnknownOutcomeIfAbsent,
  toolNameRisk,
} from "../src/loop";
import { runInGoalActionScope } from "../src/loop/scope";
import type { PolicyContext } from "../src/computer/policy";

const SCOPE = {
  orgId: "org_local",
  channelId: "channel_1",
  goalId: "channel_1",
  actorId: "user-1",
  botId: "orchestrator",
  toolName: "crm_create",
  args: { kind: "person", name: "Casey" },
};

function crmWriteContext(): PolicyContext {
  return {
    tool: { name: "crm_create" },
    bot: { id: "orchestrator" },
    actor: { id: "user-1" },
    page: { url: "", host: "" },
    intent: "crm",
  };
}

describe("Phase 5 loop on the existing goal", () => {
  test("CRM writes and computer writes are high risk; reads are not", () => {
    expect(toolNameRisk("crm_create")).toBe("high");
    expect(toolNameRisk("crm_update")).toBe("high");
    expect(toolNameRisk("crm_send")).toBe("high");
    expect(toolNameRisk("crm_search")).toBe("low");
    expect(toolNameRisk("computer_write_file")).toBe("high");
    expect(toolNameRisk("computer_run_command")).toBe("high");
    expect(toolNameRisk("computer_navigate")).toBe("low");
    expect(
      actionRisk({
        tool: { name: "computer_write_file" },
        bot: { id: "bot" },
        actor: { id: "user" },
        page: { url: "", host: "" },
        intent: "write_file",
      }),
    ).toBe("high");
    expect(
      actionRisk({
        tool: { name: "computer_click" },
        bot: { id: "bot" },
        actor: { id: "user" },
        page: { url: "", host: "" },
        intent: "activate",
      }),
    ).toBe("low");
  });

  test("a high-risk permit waits as an approval card on the goal, not a silent act", async () => {
    const loopStore = createMemoryGoalLoopStore();
    const wait = createHighRiskWait({ loopStore });
    const message = await runInGoalActionScope(SCOPE, () =>
      wait({ context: crmWriteContext(), args: SCOPE.args }),
    );

    expect(message?.startsWith(APPROVAL_WAIT_MARKER)).toBe(true);
    expect(message).toContain("Rollback:");
    const loop = await loopStore.get(SCOPE.orgId, SCOPE.goalId);
    expect(loop.approval?.status).toBe("waiting");
    expect(loop.approval?.rationale).toContain("Casey");
    expect(loop.approval?.expectedImpact.length).toBeGreaterThan(0);
    expect(loop.approval?.before.length).toBeGreaterThan(0);
    expect(loop.approval?.after.length).toBeGreaterThan(0);
    expect(loop.approval?.after).not.toMatch(/^\s*[{\[]/);
    expect(loop.approval?.after).toContain("Casey");
    expect(loop.approval?.rollback.length).toBeGreaterThan(0);
    expect(loop.expectedImpact).toBe(loop.approval?.expectedImpact);
    expect(publicGoalLoop(loop).approval).not.toHaveProperty("pending");
  });

  test("without a goal scope, a permitted high-risk write still runs", async () => {
    const loopStore = createMemoryGoalLoopStore();
    const wait = createHighRiskWait({ loopStore });
    expect(await wait({ context: crmWriteContext() })).toBeNull();
    const loop = await loopStore.get(SCOPE.orgId, SCOPE.goalId);
    expect(loop.approval).toBeNull();
  });

  test("keep carries the pending action out instead of waiting again", async () => {
    const loopStore = createMemoryGoalLoopStore();
    const wait = createHighRiskWait({ loopStore });
    await runInGoalActionScope(SCOPE, () =>
      wait({ context: crmWriteContext(), args: SCOPE.args }),
    );
    const again = await runInGoalActionScope(
      { ...SCOPE, carryOutHighRisk: true },
      () => wait({ context: crmWriteContext(), args: SCOPE.args }),
    );
    expect(again).toBeNull();
  });

  test("outcome worked / didn't / unknown is stored on the same goal object", async () => {
    const loopStore = createMemoryGoalLoopStore();
    const at = "2026-08-25T12:00:00.000Z";
    await loopStore.save(SCOPE.orgId, SCOPE.goalId, {
      ...emptyGoalLoop(),
      expectedImpact: "Book the intro meeting.",
      outcome: "worked",
      outcomeAt: at,
      outcomeJobId: "job_1",
    });
    const loop = await loopStore.get(SCOPE.orgId, SCOPE.goalId);
    expect(loop.expectedImpact).toBe("Book the intro meeting.");
    expect(loop.outcome).toBe("worked");
    await loopStore.save(SCOPE.orgId, SCOPE.goalId, {
      ...loop,
      outcome: "didn't",
      outcomeAt: at,
    });
    expect((await loopStore.get(SCOPE.orgId, SCOPE.goalId)).outcome).toBe(
      "didn't",
    );
    await loopStore.save(SCOPE.orgId, SCOPE.goalId, {
      ...(await loopStore.get(SCOPE.orgId, SCOPE.goalId)),
      outcome: "unknown",
    });
    expect((await loopStore.get(SCOPE.orgId, SCOPE.goalId)).outcome).toBe(
      "unknown",
    );
  });

  test("keep / revise / revert is visible to the next orchestrator choice", async () => {
    const loop = {
      ...emptyGoalLoop(),
      expectedImpact: "Close the round.",
      outcome: "didn't" as const,
      outcomeAt: "2026-08-25T12:00:00.000Z",
      lastDecision: {
        decision: "revise" as const,
        at: "2026-08-25T12:00:00.000Z",
        by: "user-1",
        jobId: "job_1",
        note: "Too aggressive.",
        toolName: "crm_send",
      },
      decisions: [
        {
          decision: "revise" as const,
          at: "2026-08-25T12:00:00.000Z",
          by: "user-1",
          jobId: "job_1",
          note: "Too aggressive.",
          toolName: "crm_send",
        },
        {
          decision: "keep" as const,
          at: "2026-08-24T12:00:00.000Z",
          by: "user-1",
          jobId: null,
          note: null,
          toolName: "crm_create",
        },
      ],
    };
    const guidance = orchestratorContextFromLoop(loop);
    expect(guidance).toContain("Expected impact: Close the round.");
    expect(guidance).toContain("Measured outcome: didn't");
    expect(guidance).toContain("Owner's last decision on this goal: revise");
    expect(guidance).toContain("Too aggressive.");
    expect(guidance).toContain("Prior keep/revise/revert");
    expect(guidance).toContain("keep crm_create");
  });

  test("a finished job records unknown on the goal unless an approval is waiting", async () => {
    const loopStore = createMemoryGoalLoopStore();
    await recordUnknownOutcomeIfAbsent({
      loopStore,
      orgId: SCOPE.orgId,
      goalId: SCOPE.goalId,
      jobId: "job_1",
    });
    expect((await loopStore.get(SCOPE.orgId, SCOPE.goalId)).outcome).toBe(
      "unknown",
    );

    const waiting = applyJobOutcomeToLoop({
      loop: {
        ...emptyGoalLoop(),
        approval: {
          rationale: "Send it",
          expectedImpact: "A reply",
          before: "Unsent",
          after: "Sent",
          rollback: "Do not send",
          status: "waiting",
          jobId: "job_2",
          createdAt: "2026-08-25T12:00:00.000Z",
          pending: null,
        },
      },
      jobId: "job_2",
    });
    expect(waiting.outcome).toBeNull();
  });

  test("executePendingWithTools sets carryOutHighRisk so keep does not wait", async () => {
    const loopStore = createMemoryGoalLoopStore();
    const wait = createHighRiskWait({ loopStore });
    await runInGoalActionScope(SCOPE, () =>
      wait({ context: crmWriteContext(), args: SCOPE.args }),
    );
    let carried = false;
    const result = await executePendingWithTools(async () => {
      const message = await wait({
        context: crmWriteContext(),
        args: SCOPE.args,
      });
      carried = message === null;
      return "created";
    }, SCOPE);
    expect(result).toBe("created");
    expect(carried).toBe(true);
  });
});
