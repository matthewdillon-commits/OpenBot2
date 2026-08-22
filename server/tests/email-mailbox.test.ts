import { describe, expect, test } from "bun:test";
import {
  parseAddressList,
  parseEmailMailboxSettings,
} from "../src/email/mailbox";
import { describeTransportError, textFromRfc822 } from "../src/email/transport";

describe("email mailbox metadata", () => {
  test("rejects a mailbox that does not name a host or user", () => {
    expect(
      parseEmailMailboxSettings({ port: 587, user: "bot@example.com" }, "smtp"),
    ).toBeNull();
    expect(
      parseEmailMailboxSettings(
        { host: "smtp.example.com", port: 587, from: "bot@example.com" },
        "smtp",
      ),
    ).toBeNull();
  });

  test("SMTP needs a From address; IMAP does not", () => {
    expect(
      parseEmailMailboxSettings(
        { host: "smtp.example.com", port: 587, user: "bot@example.com" },
        "smtp",
      ),
    ).toBeNull();
    expect(
      parseEmailMailboxSettings(
        {
          host: "smtp.example.com",
          port: 587,
          user: "bot@example.com",
          from: "bot@example.com",
        },
        "smtp",
      ),
    ).toEqual({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      user: "bot@example.com",
      from: "bot@example.com",
    });
    expect(
      parseEmailMailboxSettings(
        { host: "imap.example.com", port: 993, user: "bot@example.com" },
        "imap",
      ),
    ).toEqual({
      host: "imap.example.com",
      port: 993,
      secure: true,
      user: "bot@example.com",
    });
  });

  test("never reads a password out of metadata", () => {
    const settings = parseEmailMailboxSettings(
      {
        host: "smtp.example.com",
        port: 587,
        user: "bot@example.com",
        from: "bot@example.com",
        password: "should-not-be-used",
        plaintext: "also-not-used",
      },
      "smtp",
    );
    expect(settings).not.toBeNull();
    expect(JSON.stringify(settings)).not.toContain("should-not-be-used");
    expect(JSON.stringify(settings)).not.toContain("also-not-used");
  });
});

describe("address lists", () => {
  test("keeps unique addresses and drops anything without an @", () => {
    expect(
      parseAddressList(
        "Alice <not-an-address>, bob@example.com, BOB@example.com",
      ),
    ).toEqual(["bob@example.com"]);
  });
});

describe("RFC 822 text", () => {
  test("reads a quoted-printable text/plain body", () => {
    const source = [
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Hello=20there=2E",
    ].join("\n");
    expect(textFromRfc822(source)).toEqual({
      body: "Hello there.",
      snippet: "Hello there.",
    });
  });

  test("prefers the text/plain part of multipart/alternative", () => {
    const source = [
      'Content-Type: multipart/alternative; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain",
      "",
      "Plain body",
      "--b1",
      "Content-Type: text/html",
      "",
      "<p>HTML body with a secret-looking password=hunter2</p>",
      "--b1--",
    ].join("\n");
    const extracted = textFromRfc822(source);
    expect(extracted.body).toBe("Plain body");
    expect(extracted.snippet).toBe("Plain body");
  });
});

describe("transport errors", () => {
  test("strip the password and AUTH lines", () => {
    expect(
      describeTransportError(
        new Error("AUTH LOGIN super-secret-password failed"),
        "super-secret-password",
      ),
    ).not.toContain("super-secret-password");
    expect(
      describeTransportError(new Error("password=hunter2 rejected"), "unused"),
    ).toContain("password=[redacted]");
  });
});
