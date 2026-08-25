import { beforeEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  activityFor,
  clearActivity,
  hasBrowsed,
  recordActivity,
} from "../src/lib/computers/activity";
import { onComputerActivity } from "../src/lib/copilot/computer-activity";
import {
  outputOf,
  rememberComputerToolRender,
} from "../src/lib/copilot/computer-tools";

/**
 * What a Bot did on its computer, other than browse.
 *
 * The screen said what it was looking at and nothing said what it was doing: a shell command was one
 * grey line with the output nowhere, so a person watching a Bot work on a machine holding their
 * logins had to take the model's word for what it printed.
 *
 * `outputOf` is the part that reads a result, and it is the part that gets it wrong: it looked for
 * `contents` on a file read, which is the name on the way in rather than the way back, and the pane
 * said "It printed nothing" about a file the Bot had just read out loud. These pin the field names.
 */

describe("reading what a call printed", () => {
  test("a command is its stdout", () => {
    expect(outputOf({ ok: true, stdout: "ripgrep 14.1.0\n", stderr: "" })).toBe(
      "ripgrep 14.1.0\n",
    );
  });

  test("a failing command keeps its stderr, which is the whole message", () => {
    expect(
      outputOf({
        ok: true,
        stdout: "",
        stderr: "ls: cannot access '/nope'",
        exitCode: 2,
      }),
    ).toBe("ls: cannot access '/nope'");
  });

  test("both streams, in the order a terminal shows them", () => {
    expect(outputOf({ ok: true, stdout: "one", stderr: "and a warning" })).toBe(
      "one\nand a warning",
    );
  });

  test("a file read is its text", () => {
    // `text`, not `contents`. `contents` is the field on the way in, and reading it back gave an
    // empty pane for a file that had just been read.
    expect(outputOf({ ok: true, path: "notes.md", text: "hello" })).toBe(
      "hello",
    );
  });

  test("a listing marks folders the way a terminal does", () => {
    expect(
      outputOf({
        ok: true,
        entries: [
          { path: "notes", kind: "folder" },
          { path: "notes.md", kind: "file", bytes: 5 },
        ],
      }),
    ).toBe("notes/\nnotes.md  5 bytes");
  });

  test("a refusal is its reason, which is the useful part", () => {
    expect(
      outputOf({ ok: false, refused: true, reason: "A boundary said no." }),
    ).toBe("A boundary said no.");
  });

  test("something with none of those fields gives nothing rather than a guess", () => {
    // The pane then says the call printed nothing, which is honest. Inventing a summary from an
    // unrecognised shape is how a view starts lying about what happened.
    expect(outputOf({ ok: true })).toBe("");
  });
});

describe("the activity a pane shows", () => {
  beforeEach(() => {
    clearActivity("bot-1");
    clearActivity("bot-2");
  });

  test("keeps what a Bot ran, in the order it ran it", () => {
    recordActivity("bot-1", { kind: "command", subject: "ls", output: "a\nb" });
    recordActivity("bot-1", {
      kind: "command",
      subject: "pwd",
      output: "/workspace",
    });

    expect(activityFor("bot-1").map((entry) => entry.subject)).toEqual([
      "ls",
      "pwd",
    ]);
  });

  test("keeps one Bot's work out of another's", () => {
    recordActivity("bot-1", { kind: "command", subject: "ls", output: "" });

    expect(activityFor("bot-2")).toEqual([]);
  });

  test("a computer nothing has happened on is empty rather than undefined", () => {
    expect(activityFor("never-used")).toEqual([]);
  });

  test("wiping a computer forgets what ran on it", () => {
    // Reset deletes the machine those commands ran on, so leaving them on screen would describe
    // something that no longer exists.
    recordActivity("bot-1", { kind: "command", subject: "ls", output: "" });
    clearActivity("bot-1");

    expect(activityFor("bot-1")).toEqual([]);
  });

  test("stops growing, because this is a pane and not an archive", () => {
    for (let index = 0; index < 250; index += 1) {
      recordActivity("bot-1", {
        kind: "command",
        subject: `command-${index}`,
        output: "",
      });
    }

    const kept = activityFor("bot-1");
    expect(kept).toHaveLength(200);
    // The oldest go first: what somebody watching wants is what just happened.
    expect(kept[0]?.subject).toBe("command-50");
    expect(kept.at(-1)?.subject).toBe("command-249");
  });

  test("every entry is distinguishable, so two identical commands both show", () => {
    recordActivity("bot-1", { kind: "command", subject: "ls", output: "" });
    recordActivity("bot-1", { kind: "command", subject: "ls", output: "" });

    const [first, second] = activityFor("bot-1");
    expect(first?.id).not.toBe(second?.id);
  });
});

describe("rememberComputerToolRender", () => {
  beforeEach(() => {
    clearActivity("bot-1");
  });

  test("reports activity once per tool-call id and records file and shell lines on complete", () => {
    const seen = new Set<string>();
    const epochs: number[] = [];
    const stop = onComputerActivity((activity) => {
      if (activity.botId === "bot-1") epochs.push(activity.epoch);
    });

    rememberComputerToolRender({
      name: "computer_list_files",
      botId: "bot-1",
      status: "inProgress",
      args: { path: "notes" },
      toolCallId: "call-list",
      seen,
    });
    rememberComputerToolRender({
      name: "computer_list_files",
      botId: "bot-1",
      status: "inProgress",
      args: { path: "notes" },
      toolCallId: "call-list",
      seen,
    });
    expect(epochs).toHaveLength(1);

    rememberComputerToolRender({
      name: "computer_list_files",
      botId: "bot-1",
      status: "complete",
      result: JSON.stringify({
        ok: true,
        entries: [{ path: "notes.md", kind: "file", bytes: 5 }],
      }),
      args: { path: "notes" },
      toolCallId: "call-list",
      seen,
    });
    rememberComputerToolRender({
      name: "computer_list_files",
      botId: "bot-1",
      status: "complete",
      result: JSON.stringify({
        ok: true,
        entries: [{ path: "notes.md", kind: "file", bytes: 5 }],
      }),
      args: { path: "notes" },
      toolCallId: "call-list",
      seen,
    });
    expect(activityFor("bot-1")).toHaveLength(1);
    expect(activityFor("bot-1")[0]?.kind).toBe("list_files");
    stop();
  });

  test("records read, write, and run_command the way the handlers used to", () => {
    const seen = new Set<string>();
    rememberComputerToolRender({
      name: "computer_read_file",
      botId: "bot-1",
      status: "complete",
      result: JSON.stringify({ ok: true, text: "hello", path: "notes.md" }),
      args: { path: "notes.md" },
      toolCallId: "call-read",
      seen,
    });
    rememberComputerToolRender({
      name: "computer_write_file",
      botId: "bot-1",
      status: "complete",
      result: JSON.stringify({ ok: true, bytes: 12 }),
      args: { path: "notes.md", append: true },
      toolCallId: "call-write",
      seen,
    });
    rememberComputerToolRender({
      name: "computer_run_command",
      botId: "bot-1",
      status: "complete",
      result: JSON.stringify({
        ok: true,
        exitCode: 0,
        stdout: "ok",
        stderr: "",
      }),
      args: { command: "ls" },
      toolCallId: "call-run",
      seen,
    });

    const kinds = activityFor("bot-1").map((entry) => entry.kind);
    expect(kinds).toEqual(["read_file", "write_file", "command"]);
    expect(activityFor("bot-1")[1]?.output).toBe("12 bytes, appended");
    expect(activityFor("bot-1")[2]?.subject).toBe("ls");
  });

  test("marks browsed on a successful navigate and not on a refusal", () => {
    const seen = new Set<string>();
    rememberComputerToolRender({
      name: "computer_navigate",
      botId: "bot-1",
      status: "complete",
      result: "Refused. Browser use is switched off.",
      args: { url: "https://example.com/" },
      toolCallId: "call-nav-refused",
      seen,
    });
    expect(hasBrowsed("bot-1")).toBe(false);

    rememberComputerToolRender({
      name: "computer_navigate",
      botId: "bot-1",
      status: "complete",
      result: JSON.stringify({
        ok: true,
        title: "Example",
        url: "https://example.com/",
      }),
      args: { url: "https://example.com/" },
      toolCallId: "call-nav",
      seen,
    });
    expect(hasBrowsed("bot-1")).toBe(true);
  });
});

describe("computer-tools.tsx is render-only", () => {
  test("does not execute computer_* or wait for a person in the tab", async () => {
    const source = await readFile(
      new URL("../src/lib/copilot/computer-tools.tsx", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain("waitForPerson");
    expect(source).not.toContain("callComputer");
    expect(source).not.toContain("/api/computers/");
    expect(source).not.toContain("readControl");
    expect(source).toContain("useRenderTool");
    expect(source).not.toMatch(
      /useFrontendTool\(\s*\{[\s\S]*?name:\s*"computer_/,
    );
  });
});
