import { z } from "zod";
import type { AgentActor } from "../agents/profile-types";
import {
  type ActionActor,
  ActionRefusedError,
  type ComputerGateway,
  HumanHasControlError,
} from "../computer/gateway";
import { type GrantedTool, REFUSAL_MARKER } from "../plugins/tools";
import type { SubagentGateway } from "./gateway";

/**
 * The parent's computer, offered to a child run.
 *
 * Same names and arguments as the conversation surface, so the model already knows the order
 * (snapshot, then act). Same gateway too: resolve, decide, audit, then act. A child is not a
 * second computer — it is a second pair of hands on this Bot's one computer, and the gateway's
 * per-Bot lock is how they take turns.
 *
 * Help and a secret are not a ten-minute wait here. Nobody is sitting in this run. The call is
 * recorded, then the child reports `blocked` so the parent can take the wheel.
 */

const empty = z.object({});

const urlParameters = z.object({
  url: z.string().describe("Full web address to open, including https://"),
});

const refParameters = z.object({
  ref: z
    .string()
    .describe("Ref of the element, from your most recent snapshot"),
  snapshotId: z.number().describe("The snapshotId that ref came from"),
});

const typeParameters = refParameters.extend({
  text: z.string().describe("The text to enter"),
  submit: z
    .boolean()
    .optional()
    .describe("Press Enter after typing, to submit a single-field form"),
});

const keyParameters = z.object({
  key: z.string().describe("A key name, such as Enter or Tab"),
  ref: z
    .string()
    .optional()
    .describe("Optional ref to focus first, from your most recent snapshot"),
  snapshotId: z
    .number()
    .optional()
    .describe("The snapshotId that ref came from"),
});

const scrollParameters = z.object({
  deltaY: z
    .number()
    .optional()
    .describe("How far to scroll. Positive is down."),
});

const listParameters = z.object({
  path: z
    .string()
    .optional()
    .describe("Optional folder to list. Omit for the whole workspace."),
});

const pathParameters = z.object({
  path: z
    .string()
    .describe("Path relative to your workspace, such as notes.md"),
});

const writeParameters = z.object({
  path: z
    .string()
    .describe("Path relative to your workspace, such as reports/august.csv"),
  contents: z.string().describe("The text to save"),
  append: z
    .boolean()
    .optional()
    .describe("Add to the end of the file instead of replacing it"),
});

const commandParameters = z.object({
  command: z
    .string()
    .describe("The command to run, such as: sudo apt-get install -y jq"),
});

const helpParameters = z.object({
  reason: z
    .string()
    .describe(
      "What you need the person to do, in one sentence, e.g. 'This page is asking for a code sent to your phone.'",
    ),
});

const secretParameters = z.object({
  label: z
    .string()
    .describe(
      "What you need, in a few words, e.g. 'the code sent to your phone'",
    ),
  ref: z
    .string()
    .describe("Ref of the field it goes in, from your most recent snapshot"),
  snapshotId: z.number().describe("The snapshotId that ref came from"),
});

export function childComputerTools(options: {
  computer: ComputerGateway;
  subagents: SubagentGateway;
  botId: string;
  actor: AgentActor;
  subagentId: string;
}): GrantedTool[] {
  const { computer, subagents, botId, actor, subagentId } = options;
  const actionActor: ActionActor = { id: actor.id, userId: actor.id };

  const reportBlocked = async (detail: string): Promise<string> => {
    try {
      return await subagents.report({
        botId,
        actor,
        subagentId,
        status: "blocked",
        result: detail,
      });
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };

  const recover = async (error: unknown): Promise<string> => {
    if (error instanceof ActionRefusedError) {
      return `${REFUSAL_MARKER} ${error.message}`;
    }
    if (needsAPerson(error)) {
      const reason =
        error instanceof Error
          ? error.message
          : "A person has control of this coworker's computer.";
      await reportBlocked(
        `Child ${subagentId} cannot continue on this coworker's computer: ${reason}`,
      );
      return JSON.stringify({
        ok: false,
        humanHasControl: true,
        reported: "blocked",
        reason,
      });
    }
    const reason =
      error instanceof Error ? error.message : "That did not work.";
    return JSON.stringify({ ok: false, reason });
  };

  const tool = (
    name: string,
    description: string,
    parameters: z.ZodType,
    run: (args: Record<string, unknown>) => Promise<unknown>,
  ): GrantedTool => ({
    name,
    description,
    parameters,
    execute: async (args: unknown) => {
      const parsed = parameters.safeParse(args ?? {});
      if (!parsed.success) {
        return "Those arguments were not valid for this computer tool.";
      }
      try {
        const result = await run(parsed.data as Record<string, unknown>);
        return typeof result === "string" ? result : JSON.stringify(result);
      } catch (error) {
        return recover(error);
      }
    },
  });

  return [
    tool(
      "computer_navigate",
      "Open a web page on this coworker's computer. Returns the page title and its readable text.",
      urlParameters,
      async (args) => computer.navigate(botId, actionActor, String(args.url)),
    ),
    tool(
      "computer_read",
      "Read the page currently open on this coworker's computer, without opening anything.",
      empty,
      async () => computer.read(botId),
    ),
    tool(
      "computer_snapshot",
      "List the things on the current page you can act on, each with a ref. Call this BEFORE clicking or typing, and send back the snapshotId it gives you.",
      empty,
      async () => computer.snapshot(botId),
    ),
    tool(
      "computer_click",
      "Click something on the page. Give the ref from your most recent snapshot and the snapshotId it came from.",
      refParameters,
      async (args) =>
        computer.click(botId, actionActor, {
          ref: String(args.ref),
          snapshotId: Number(args.snapshotId),
        }),
    ),
    tool(
      "computer_type",
      "Enter text into a field on the page. Give the ref of the field from your most recent snapshot and the snapshotId it came from.",
      typeParameters,
      async (args) =>
        computer.type(botId, actionActor, {
          ref: String(args.ref),
          snapshotId: Number(args.snapshotId),
          text: String(args.text),
          ...(args.submit === true ? { submit: true } : {}),
        }),
    ),
    tool(
      "computer_key",
      "Press a key on the page, such as Enter or Tab. Optionally focus a ref first.",
      keyParameters,
      async (args) =>
        computer.key(botId, actionActor, {
          key: String(args.key),
          ...(typeof args.ref === "string" &&
          typeof args.snapshotId === "number"
            ? { ref: args.ref, snapshotId: args.snapshotId }
            : {}),
        }),
    ),
    tool(
      "computer_scroll",
      "Scroll the current page.",
      scrollParameters,
      async (args) =>
        computer.scroll(botId, actionActor, {
          ...(typeof args.deltaY === "number" ? { deltaY: args.deltaY } : {}),
        }),
    ),
    tool(
      "computer_list_files",
      "List what is in this coworker's workspace. Call this FIRST when you are unsure of a filename.",
      listParameters,
      async (args) =>
        computer.listFiles(botId, actionActor, {
          ...(typeof args.path === "string" && args.path.trim()
            ? { path: args.path.trim() }
            : {}),
        }),
    ),
    tool(
      "computer_read_file",
      "Read a file in this coworker's workspace. Paths are relative to the workspace.",
      pathParameters,
      async (args) =>
        computer.readFile(botId, actionActor, { path: String(args.path) }),
    ),
    tool(
      "computer_write_file",
      "Save a file in this coworker's workspace. Paths are relative to the workspace. Text only.",
      writeParameters,
      async (args) =>
        computer.writeFile(botId, actionActor, {
          path: String(args.path),
          contents: String(args.contents),
          append: args.append === true,
        }),
    ),
    tool(
      "computer_run_command",
      "Run a shell command on this coworker's computer. The working directory is the workspace.",
      commandParameters,
      async (args) =>
        computer.runCommand(botId, actionActor, {
          command: String(args.command),
        }),
    ),
    tool(
      "computer_request_help",
      "Ask a person to take the wheel — sign in, a password, a CAPTCHA. This reports blocked to the parent with what they must do. Do not wait.",
      helpParameters,
      async (args) => {
        const reason = String(args.reason).trim();
        await computer.requestHelp(
          botId,
          actionActor,
          reason || "The sub-agent needs a person to continue.",
        );
        const detail = `Child ${subagentId} needs a person on this coworker's computer: ${reason || "help at the current page."}`;
        const reported = await reportBlocked(detail);
        return {
          ok: true,
          reported: "blocked",
          message:
            "Reported blocked to the parent so they can take the wheel. Do not wait.",
          parent: reported,
        };
      },
    ),
    tool(
      "computer_request_secret",
      "Ask a person for ONE value you must not be told, into a field you have already focused. This reports blocked to the parent. Do not wait.",
      secretParameters,
      async (args) => {
        const label =
          String(args.label).trim() || "the value this page is asking for";
        await computer.requestSecret(botId, actionActor, {
          label,
          ref: String(args.ref),
          snapshotId: Number(args.snapshotId),
        });
        const detail = `Child ${subagentId} needs a person to enter ${label} on this coworker's computer (into ${String(args.ref)}).`;
        const reported = await reportBlocked(detail);
        return {
          ok: true,
          reported: "blocked",
          message:
            "Reported blocked to the parent so they can enter the value. Do not wait.",
          parent: reported,
        };
      },
    ),
  ];
}

function needsAPerson(error: unknown): boolean {
  if (error instanceof HumanHasControlError) return true;
  return error instanceof Error && /a person has control/i.test(error.message);
}
