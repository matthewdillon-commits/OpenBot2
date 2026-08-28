import { describe, expect, test } from "bun:test";
import {
  channelKeys,
  channelListPath,
  channelListQueryOptions,
} from "../src/lib/channels/queries";
import { ENTRANCE_SECONDS } from "../src/lib/motion";
import { goalRowExitSeconds } from "../src/components/app-sidebar/goal-roster";

describe("channel list query", () => {
  test("puts search and status on the list key so two filters do not share a cache", () => {
    expect(channelKeys.list()).toEqual([
      "channels",
      "list",
      { search: "", status: "all" },
    ]);
    expect(
      channelListQueryOptions({ search: " Ada ", status: "active" }).queryKey,
    ).toEqual(["channels", "list", { search: "Ada", status: "active" }]);
    expect(channelKeys.list({ search: "Ada" })[0]).toBe(channelKeys.all[0]);
    expect(channelKeys.list({ search: "Ada" }).slice(0, 2)).toEqual(
      channelKeys.lists(),
    );
  });

  test("asks the server for the normalised query rather than filtering a loaded page", () => {
    expect(channelListPath()).toBe("/api/channels");
    expect(channelListPath({ search: "  Ada  " })).toBe(
      "/api/channels?search=Ada",
    );
    expect(channelListPath({ status: "completed" })).toBe(
      "/api/channels?status=completed",
    );
    expect(
      channelListPath({ search: "Ada", status: "active" }, "cursor-1"),
    ).toBe("/api/channels?search=Ada&status=active&cursor=cursor-1");
  });
});

describe("roster exit timing", () => {
  test("reduced motion does not hold the empty sentence for an exit fade", () => {
    expect(goalRowExitSeconds(true)).toBe(0);
    expect(goalRowExitSeconds(false)).toBe(ENTRANCE_SECONDS);
  });
});
