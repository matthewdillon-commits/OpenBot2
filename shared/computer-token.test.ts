import { describe, expect, test } from "bun:test";
import { sameImageComputerToken } from "./computer-token";

const PLACEHOLDER_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

describe("sameImageComputerToken", () => {
  test("is a stable hex digest for a given vault key", () => {
    expect(sameImageComputerToken(PLACEHOLDER_KEY)).toBe(
      "07cf340318c3d7078db4f1c9547b9e5a7c075ab2b3791db195ba8dadcbfd2093",
    );
  });

  test("differs across keys so two deployments do not share a computer secret", () => {
    expect(sameImageComputerToken(PLACEHOLDER_KEY)).not.toBe(
      sameImageComputerToken("BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="),
    );
  });
});
