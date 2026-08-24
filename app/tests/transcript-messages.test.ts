import { describe, expect, test } from "bun:test";
import {
  seedMessage,
  stashFirstMessage,
  takeFirstMessage,
  transcriptMessages,
  withOutgoingEcho,
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
});

describe("withOutgoingEcho", () => {
  test("appends the echo when the agent does not have it yet", () => {
    const echo = seedMessage("hello", "echo-1");
    expect(withOutgoingEcho([], echo)).toEqual([echo]);
  });

  test("does not duplicate once the agent has the same id", () => {
    const echo = seedMessage("hello", "echo-1");
    expect(withOutgoingEcho([echo], echo)).toEqual([echo]);
  });

  test("does not duplicate the seed that already shows the same words", () => {
    const seed = seedMessage("hello", "seed-1");
    const echo = seedMessage("hello", "echo-1");
    expect(withOutgoingEcho([seed], echo)).toEqual([seed]);
  });

  test("leaves the list alone when there is nothing outgoing", () => {
    expect(withOutgoingEcho([STORED], null)).toEqual([STORED]);
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
