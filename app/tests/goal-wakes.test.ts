import { describe, expect, test } from "bun:test";
import {
  inboundEmailUrl,
  inboundWebhookUrl,
  intervalLabel,
  wakeKindLabel,
  wakeSummary,
} from "@/lib/triggers/copy";
import { cronWakeInputFrom, INTERVAL_PRESETS } from "@/lib/triggers/form";
import { triggerKeys, triggerListQueryOptions } from "@/lib/triggers/queries";

describe("standing wake copy", () => {
  test("names kinds in owner language", () => {
    expect(wakeKindLabel("cron")).toBe("Schedule");
    expect(wakeKindLabel("webhook")).toBe("Webhook");
    expect(wakeKindLabel("email")).toBe("Mailbox");
  });

  test("formats intervals without infra words", () => {
    expect(intervalLabel(900)).toBe("every 15 minutes");
    expect(intervalLabel(3600)).toBe("every hour");
    expect(intervalLabel(86_400)).toBe("every day");
    expect(intervalLabel(45)).toBe("every 45 seconds");
    expect(INTERVAL_PRESETS.map((preset) => preset.seconds)).toEqual([
      900, 3600, 21_600, 86_400,
    ]);
  });

  test("webhook and inbound email URLs stay on this origin", () => {
    expect(inboundWebhookUrl("https://app.example.test", "jtr_1")).toBe(
      "https://app.example.test/api/inbound/webhook/jtr_1",
    );
    expect(inboundEmailUrl("https://app.example.test/")).toBe(
      "https://app.example.test/api/inbound/email",
    );
    expect(
      inboundWebhookUrl("https://app.example.test", "jtr_1"),
    ).not.toContain("COMPUTER_SUPERVISOR");
  });

  test("summarizes last fire and next run", () => {
    const now = Date.parse("2026-08-26T12:00:00.000Z");
    expect(
      wakeSummary(
        {
          id: "jtr_1",
          orgId: "org_local",
          kind: "cron",
          channelId: "channel_1",
          goalId: "channel_1",
          threadId: "thread-1",
          coworkerId: "researcher",
          actingUserId: "user-1",
          prompt: "Morning brief.",
          enabled: true,
          everySeconds: 3600,
          nextRunAt: "2026-08-26T13:00:00.000Z",
          mailbox: null,
          hasSecret: false,
          lastEnqueuedAt: "2026-08-26T11:00:00.000Z",
          lastError: null,
          createdAt: "2026-08-26T10:00:00.000Z",
          updatedAt: "2026-08-26T11:00:00.000Z",
        },
        now,
      ),
    ).toBe("every hour · last started 1 hour ago · next in 1 hour");
  });
});

describe("standing wake data access", () => {
  test("lists wakes per goal and maps a cron onto that goal", () => {
    expect(triggerKeys.list("channel_1")).toEqual([
      "job-triggers",
      "list",
      { channelId: "channel_1" },
    ]);
    expect(triggerListQueryOptions("channel_1").queryKey).toEqual(
      triggerKeys.list("channel_1"),
    );
    expect(
      cronWakeInputFrom("channel_1", { prompt: "Brief.", everySeconds: 3600 }),
    ).toEqual({
      kind: "cron",
      channelId: "channel_1",
      goalId: "channel_1",
      prompt: "Brief.",
      everySeconds: 3600,
    });
  });
});
