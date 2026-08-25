import { describe, expect, test } from "bun:test";
import { workerStatus } from "../src/status";

describe("worker status", () => {
  test("polls for unattended coworker jobs", () => {
    expect(workerStatus()).toEqual({ status: "polling" });
  });
});
