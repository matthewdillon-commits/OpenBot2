import { describe, expect, test } from "bun:test";
import {
  findWorkerInOrg,
  parseWorkerKind,
  standingSalesTriggerId,
  workerKindOfUnscopedId,
  WORKER_UNSCOPED_IDS,
} from "../src/jobs/worker-kinds";

describe("worker kinds", () => {
  test("parses the three owner jobs and nothing else", () => {
    expect(parseWorkerKind("campaign")).toBe("campaign");
    expect(parseWorkerKind("research")).toBe("research");
    expect(parseWorkerKind("sales")).toBe("sales");
    expect(parseWorkerKind("Sales")).toBeNull();
    expect(parseWorkerKind("ops")).toBeNull();
    expect(parseWorkerKind("")).toBeNull();
  });

  test("finds the packaged worker in an org, including a scoped copy", () => {
    const local = [{ id: WORKER_UNSCOPED_IDS.campaign }];
    const scoped = [{ id: "org_acme__research-worker" }];
    expect(findWorkerInOrg(local, "org_local", "campaign")?.id).toBe(
      "campaign-worker",
    );
    expect(findWorkerInOrg(scoped, "org_acme", "research")?.id).toBe(
      "org_acme__research-worker",
    );
    expect(findWorkerInOrg(scoped, "org_acme", "campaign")).toBeUndefined();
  });

  test("standing sales trigger id is stable for the same goal and worker", () => {
    const a = standingSalesTriggerId("org_acme", "channel_1", "sales-worker");
    const b = standingSalesTriggerId("org_acme", "channel_1", "sales-worker");
    const other = standingSalesTriggerId(
      "org_acme",
      "channel_2",
      "sales-worker",
    );
    expect(a).toBe(b);
    expect(a).not.toBe(other);
    expect(a.startsWith("jtr_sales_")).toBe(true);
    expect(workerKindOfUnscopedId("sales-worker")).toBe("sales");
  });
});
