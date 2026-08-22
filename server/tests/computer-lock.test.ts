import { describe, expect, test } from "bun:test";
import { withComputerLock } from "../src/computer/lock";

describe("the computer lock", () => {
  test("two jobs on the same Bot take turns", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withComputerLock("risk-turns", async () => {
      order.push("first-start");
      await held;
      order.push("first-end");
      return "a";
    });
    const second = withComputerLock("risk-turns", async () => {
      order.push("second");
      return "b";
    });

    for (let i = 0; i < 50 && !order.includes("first-start"); i++) {
      await Promise.resolve();
    }
    expect(order).toEqual(["first-start"]);
    releaseFirst();
    expect(await first).toBe("a");
    expect(await second).toBe("b");
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  test("two Bots do not wait on each other", async () => {
    let releaseRisk!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseRisk = resolve;
    });
    let legalStarted = false;

    const risk = withComputerLock("risk-parallel", () =>
      held.then(() => "risk"),
    );
    const legal = withComputerLock("legal-parallel", async () => {
      legalStarted = true;
      return "legal";
    });

    for (let i = 0; i < 50 && !legalStarted; i++) {
      await Promise.resolve();
    }
    expect(legalStarted).toBe(true);
    expect(await legal).toBe("legal");
    releaseRisk();
    expect(await risk).toBe("risk");
  });

  test("a failed job does not block the next one on that Bot", async () => {
    const first = withComputerLock("risk", async () => {
      throw new Error("boom");
    });
    const second = withComputerLock("risk", async () => "ok");
    await expect(first).rejects.toThrow("boom");
    expect(await second).toBe("ok");
  });
});
