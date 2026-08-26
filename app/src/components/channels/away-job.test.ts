import { describe, expect, test } from "bun:test";
import { AWAY_FAILED, AWAY_IN_FLIGHT, noticeForAwayJob } from "./away-job";

describe("noticeForAwayJob", () => {
  test("queued and running keep the away sentence", () => {
    expect(noticeForAwayJob({ status: "queued" })).toEqual({
      text: AWAY_IN_FLIGHT,
      tone: "status",
    });
    expect(noticeForAwayJob({ status: "running" })).toEqual({
      text: AWAY_IN_FLIGHT,
      tone: "status",
    });
  });

  test("a failed job shows the lock error instead of staying away", () => {
    expect(
      noticeForAwayJob({
        status: "failed",
        error:
          "This thread is still locked by another runner. The job stopped instead of waiting forever.",
      }),
    ).toEqual({
      text: "This thread is still locked by another runner. The job stopped instead of waiting forever.",
      tone: "alert",
    });
  });

  test("a failed job without an error still alerts", () => {
    expect(noticeForAwayJob({ status: "failed", error: null })).toEqual({
      text: AWAY_FAILED,
      tone: "alert",
    });
    expect(noticeForAwayJob({ status: "cancelled" })).toEqual({
      text: AWAY_FAILED,
      tone: "alert",
    });
  });

  test("a succeeded job is not an away notice", () => {
    expect(noticeForAwayJob({ status: "succeeded" })).toBeNull();
  });
});
