import { describe, expect, test } from "bun:test";
import {
  seedMessage,
  stashFirstMessage,
  takeFirstMessage,
  transcriptMessages,
} from "../src/components/channels/transcript-messages";

/**
 * Brand-new channel transcript seeding: show the optimistic message until stored messages arrive.
 */

const SEED = seedMessage("what is our refund policy?", "seed-1");
const STORED = seedMessage("what is our refund policy?", "stored-1");

describe("transcriptMessages", () => {
  test("shows the seed while the agent has nothing", () => {
    expect(transcriptMessages([], SEED)).toEqual([SEED]);
  });

  test("shows the agent's messages once it has any, and drops the seed", () => {
    expect(transcriptMessages([STORED], SEED)).toEqual([STORED]);
  });

  test("shows nothing for an empty channel with no seed", () => {
    expect(transcriptMessages([], null)).toEqual([]);
  });

  test("is unaffected by a seed on an established channel", () => {
    expect(transcriptMessages([STORED], null)).toEqual([STORED]);
  });

  test("appends Bot-posted channel messages that are not already in the thread", () => {
    const posted = [
      {
        id: "msg_1",
        channelId: "channel-1",
        senderAgentId: "risk",
        senderName: "Risk",
        body: "Please review vendor 12.",
        hop: 1,
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ];
    expect(transcriptMessages([STORED], null, posted)).toEqual([
      STORED,
      {
        id: "msg_1",
        role: "assistant",
        content: "Please review vendor 12.",
        name: "Risk",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ]);
  });

  test("interleaves a Bot post between earlier and later human turns", () => {
    const morning = {
      ...seedMessage("Start the vendor review.", "human-1"),
      createdAt: "2026-08-22T09:00:00.000Z",
    };
    const afternoon = {
      ...seedMessage("Any update on vendor 12?", "human-2"),
      createdAt: "2026-08-22T11:00:00.000Z",
    };
    const posted = [
      {
        id: "msg_mid",
        channelId: "channel-1",
        senderAgentId: "knowledge",
        senderName: "Knowledge",
        body: "Vendor 12's policy expired in June.",
        hop: 2,
        createdAt: "2026-08-22T10:00:00.000Z",
      },
    ];

    expect(transcriptMessages([morning, afternoon], null, posted)).toEqual([
      morning,
      {
        id: "msg_mid",
        role: "assistant",
        content: "Vendor 12's policy expired in June.",
        name: "Knowledge",
        createdAt: "2026-08-22T10:00:00.000Z",
      },
      afternoon,
    ]);
  });
});

describe("seedMessage", () => {
  test("is a user message carrying the text", () => {
    const message = seedMessage("hello", "id-1");
    expect(message).toEqual({ id: "id-1", role: "user", content: "hello" });
  });
});

describe("the first-message stash", () => {
  test("hands the message to the channel that was just created", () => {
    stashFirstMessage("channel_a", "hello");
    expect(takeFirstMessage("channel_a")).toEqual({
      text: "hello",
      agentId: null,
    });
  });

  test("gives it up only once", () => {
    // Take-once prevents remounts from resending the first message.
    stashFirstMessage("channel_b", "hello");
    takeFirstMessage("channel_b");
    expect(takeFirstMessage("channel_b")).toBeNull();
  });

  test("has nothing for a channel that was opened normally", () => {
    expect(takeFirstMessage("channel_never_stashed")).toBeNull();
  });

  test("keeps two channels' messages apart", () => {
    stashFirstMessage("channel_c", "for c");
    stashFirstMessage("channel_d", "for d");
    expect(takeFirstMessage("channel_d")).toEqual({
      text: "for d",
      agentId: null,
    });
    expect(takeFirstMessage("channel_c")).toEqual({
      text: "for c",
      agentId: null,
    });
  });

  test("remembers who the first message asked to answer", () => {
    stashFirstMessage("channel_e", "@Risk hello", "risk-analyst");
    expect(takeFirstMessage("channel_e")).toEqual({
      text: "@Risk hello",
      agentId: "risk-analyst",
    });
  });
});
