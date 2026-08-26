import { describe, expect, test } from "bun:test";
import { readableLoopText } from "@/lib/channels/loop";

describe("readableLoopText", () => {
  test("leaves a plain sentence alone", () => {
    expect(
      readableLoopText("Current records are unchanged until this is kept."),
    ).toBe("Current records are unchanged until this is kept.");
  });

  test("flattens a JSON dump into field labels", () => {
    expect(readableLoopText('{"kind":"person","name":"Casey"}')).toBe(
      "kind: person · name: Casey",
    );
  });
});
