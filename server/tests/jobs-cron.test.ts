import { describe, expect, test } from "bun:test";
import {
  CronParseError,
  isValidTimeZone,
  nextCronOccurrence,
  parseCron,
} from "../src/jobs/cron";

describe("cron schedules", () => {
  test("parses five fields with lists, ranges and steps", () => {
    const schedule = parseCron("*/15 9-17 * * 1-5");
    expect(schedule.minute.has(0)).toBe(true);
    expect(schedule.minute.has(15)).toBe(true);
    expect(schedule.minute.has(7)).toBe(false);
    expect(schedule.hour.has(9)).toBe(true);
    expect(schedule.hour.has(17)).toBe(true);
    expect(schedule.hour.has(8)).toBe(false);
    expect(schedule.weekday.has(1)).toBe(true);
    expect(schedule.weekday.has(0)).toBe(false);
  });

  test("treats Sunday as 0 or 7", () => {
    expect(parseCron("0 0 * * 7").weekday.has(0)).toBe(true);
    expect(parseCron("0 0 * * SUN").weekday.has(0)).toBe(true);
  });

  test("refuses a field count that is not five", () => {
    expect(() => parseCron("0 9 * *")).toThrow(CronParseError);
  });

  test("weekday-bounded daily 9am skips Saturday and Sunday", () => {
    // Friday 22 Aug 2026 10:00 UTC. Next weekday 9:00 America/Toronto is Monday.
    const friday = new Date("2026-08-21T14:00:00.000Z");
    const next = nextCronOccurrence("0 9 * * *", friday, "UTC", true);
    expect(next?.toISOString()).toBe("2026-08-24T09:00:00.000Z");
  });

  test("weekday-bounded off still fires on Saturday", () => {
    const friday = new Date("2026-08-21T14:00:00.000Z");
    const next = nextCronOccurrence("0 9 * * *", friday, "UTC", false);
    expect(next?.toISOString()).toBe("2026-08-22T09:00:00.000Z");
  });

  test("evaluates the cron in the named timezone", () => {
    // 2026-01-15 12:00 UTC is 07:00 America/Toronto. Next 9:00 there is 14:00 UTC.
    const noonUtc = new Date("2026-01-15T12:00:00.000Z");
    const next = nextCronOccurrence(
      "0 9 * * *",
      noonUtc,
      "America/Toronto",
      true,
    );
    expect(next?.toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });

  test("does not return the same minute as `from`", () => {
    const at = new Date("2026-01-15T09:00:00.000Z");
    const next = nextCronOccurrence("0 9 * * *", at, "UTC", true);
    expect(next?.toISOString()).toBe("2026-01-16T09:00:00.000Z");
  });

  test("a Saturday-only cron with weekday bounding never matches", () => {
    const next = nextCronOccurrence(
      "0 9 * * 6",
      new Date("2026-01-15T00:00:00.000Z"),
      "UTC",
      true,
    );
    expect(next).toBeNull();
  });

  test("isValidTimeZone accepts IANA names and refuses junk", () => {
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("America/Toronto")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });
});
