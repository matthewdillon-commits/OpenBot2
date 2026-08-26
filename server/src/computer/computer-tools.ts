/**
 * Computer tools executed on the server, through the gateway.
 *
 * Same names, descriptions, and parameters the conversation surface used to
 * register as frontend tools. Built-in agents run them in the API tool loop;
 * remote AG-UI agents call the same names back through `/api/agent-tools/call`.
 * Help and a secret ask, persist `needs_you`, notify, and return immediately.
 */
import { z } from "zod";
import type { AgentActor } from "../agents/profile-types";
import { orgIdOf } from "../orgs/constants";
import { SpendCapError } from "../orgs/spend";
import { REFUSAL_MARKER } from "../plugins/refusal";
import type { GrantedTool } from "../plugins/tools";
import {
  type ActionActor,
  ActionRefusedError,
  ActionWaitingError,
  type ComputerGateway,
  ComputerUnavailableError,
  ElementNotFoundError,
  NavigationRefusedError,
  SharedComputerIsolationError,
  StaleSnapshotError,
  WorkspaceRefusedError,
  WorkspaceRequestError,
} from "./gateway";

const empty = z.object({});

const urlParameters = z.object({
  url: z.string().describe("Full web address to open, including https://"),
});

const refParameters = z.object({
  ref: z
    .string()
    .describe("Ref of the element to click, from your most recent snapshot"),
  snapshotId: z.number().describe("The snapshotId that ref came from"),
});

const typeParameters = z.object({
  ref: z.string().describe("Ref of the field, from your most recent snapshot"),
  snapshotId: z.number().describe("The snapshotId that ref came from"),
  text: z.string().describe("The text to enter"),
  submit: z
    .boolean()
    .optional()
    .describe("Press Enter after typing, to submit a single-field form"),
});

const keyParameters = z.object({
  key: z.string().describe("Key name, such as Enter, Tab or Escape"),
  ref: z.string().optional().describe("Optional ref to press the key on"),
  snapshotId: z
    .number()
    .optional()
    .describe("The snapshotId the ref came from, required if ref is given"),
});

const scrollParameters = z.object({
  deltaY: z
    .number()
    .optional()
    .describe("Pixels to scroll; positive is down. Defaults to 600."),
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

const DEV_ACTOR_ID = "dev-local-user";

export type NeedsYouKind = "help" | "secret" | "unavailable";

export type ComputerNeedsYouEvent = {
  kind: NeedsYouKind;
  reason?: string;
  label?: string;
};

/**
 * Owner-facing copy when the computer process is down or would not authenticate.
 * Never names an environment variable.
 */
export const COMPUTER_UNAVAILABLE_OWNER =
  "The computer is not available. Ask your operator to get it running.";

export const COMPUTER_UNAVAILABLE_LAST_ACTION =
  "Needs you: the computer is not available.";

export type ComputerToolsOptions = {
  computer: ComputerGateway;
  botId: string;
  actor: AgentActor;
  /**
   * Persist a needs_you pause and notify. Must not wait for the person.
   * Failure here must not hide the ask that already reached the computer.
   */
  onNeedsYou?: (event: ComputerNeedsYouEvent) => Promise<void>;
};

function actionActorFrom(actor: AgentActor): ActionActor {
  return {
    id: actor.id,
    orgId: orgIdOf(actor),
    ...(actor.id === DEV_ACTOR_ID ? {} : { userId: actor.id }),
  };
}

function withoutEnvNames(reason: string): string {
  if (
    /COMPUTER_TOKEN|AGENT_COMPUTER_URL|COMPUTER_SUPERVISOR_URL|SUPERVISOR_TOKEN|E2B_API_KEY|E2B_TEMPLATE/i.test(
      reason,
    )
  ) {
    return COMPUTER_UNAVAILABLE_OWNER;
  }
  return reason;
}

function isComputerDown(error: unknown): boolean {
  if (!(error instanceof ComputerUnavailableError)) return false;
  if (/control/i.test(error.message)) return false;
  return true;
}

function recover(error: unknown): string {
  if (error instanceof ActionWaitingError) {
    return error.message;
  }
  if (error instanceof ActionRefusedError) {
    return `${REFUSAL_MARKER} ${error.message}`;
  }
  if (
    error instanceof NavigationRefusedError ||
    error instanceof WorkspaceRefusedError
  ) {
    return `${REFUSAL_MARKER} ${error.message}`;
  }
  if (error instanceof SharedComputerIsolationError) {
    return JSON.stringify({ ok: false, reason: error.message });
  }
  if (error instanceof SpendCapError) {
    return `${REFUSAL_MARKER} ${error.message}`;
  }
  if (
    error instanceof StaleSnapshotError ||
    error instanceof ElementNotFoundError
  ) {
    return JSON.stringify({
      ok: false,
      reason: error instanceof Error ? error.message : "Those refs are stale.",
      staleRefs: true,
    });
  }
  if (error instanceof WorkspaceRequestError) {
    return JSON.stringify({
      ok: false,
      reason: error.message,
    });
  }
  if (
    error instanceof ComputerUnavailableError &&
    /control/i.test(error.message)
  ) {
    return JSON.stringify({
      ok: false,
      reason: error.message,
      humanHasControl: true,
    });
  }
  if (isComputerDown(error)) {
    return JSON.stringify({
      ok: false,
      needs_you: true,
      reason: COMPUTER_UNAVAILABLE_OWNER,
    });
  }
  const reason = withoutEnvNames(
    error instanceof Error ? error.message : "That did not work.",
  );
  return JSON.stringify({ ok: false, reason });
}

function asJson(result: unknown): string {
  return typeof result === "string" ? result : JSON.stringify(result);
}

export function computerTools(options: ComputerToolsOptions): GrantedTool[] {
  const { computer, botId, actor } = options;
  const actionActor = actionActorFrom(actor);

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
        return asJson(await run(parsed.data as Record<string, unknown>));
      } catch (error) {
        if (isComputerDown(error)) {
          try {
            await options.onNeedsYou?.({
              kind: "unavailable",
              reason: COMPUTER_UNAVAILABLE_OWNER,
            });
          } catch {
            // The owner copy still has to reach the model even if the job row failed.
          }
        }
        return recover(error);
      }
    },
  });

  return [
    tool(
      "computer_navigate",
      "Open a web page on your own computer so the person can watch. Use this when asked to look " +
        "at, visit, open or check a website. Returns the page title and its readable text, so answer " +
        "from what comes back rather than telling the person to go and look.",
      urlParameters,
      async (args) => {
        const result = await computer.navigate(
          botId,
          actionActor,
          String(args.url),
        );
        return {
          ok: true,
          title: result.title,
          url: result.url,
          text: result.text,
          truncated: result.truncated,
        };
      },
    ),
    tool(
      "computer_read",
      "Read the page currently open on your computer, without opening anything. Use this after you " +
        "click something that changes the page, such as submitting a form, to find out what it now says.",
      empty,
      async () => computer.read(botId, actionActor.orgId),
    ),
    tool(
      "computer_snapshot",
      "List the things on the current page you can act on: fields, buttons, links and checkboxes, " +
        "each with a ref, its label and its current value. Call this BEFORE clicking or typing, and " +
        "use the refs it returns. Always send back the snapshotId it gives you. If an action reports " +
        "that your refs are stale, the page changed: call this again and use the new refs.",
      empty,
      async () => computer.snapshot(botId, actionActor.orgId),
    ),
    tool(
      "computer_type",
      "Enter text into a field on the page. Give the ref of the field from your most recent " +
        "snapshot and the snapshotId it came from. This replaces whatever the field already contains. " +
        "Set submit to true to press Enter afterwards.",
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
      "computer_click",
      "Click something on the page: a button, a link, a checkbox or a radio option. Give the ref " +
        "from your most recent snapshot and the snapshotId it came from.",
      refParameters,
      async (args) =>
        computer.click(botId, actionActor, {
          ref: String(args.ref),
          snapshotId: Number(args.snapshotId),
        }),
    ),
    tool(
      "computer_key",
      "Press a key, such as Enter, Tab or Escape. Give a ref to press it while a particular field " +
        "is focused, or omit the ref to press it on the page.",
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
      "Scroll the page down, or up with a negative amount, to bring more of a long page into view.",
      scrollParameters,
      async (args) =>
        computer.scroll(botId, actionActor, {
          ...(typeof args.deltaY === "number" ? { deltaY: args.deltaY } : {}),
        }),
    ),
    tool(
      "computer_list_files",
      "List what is in your workspace: every file and folder you have saved, with sizes. Call this " +
        "FIRST when you are asked what files you have, or before reading a file whose exact name you " +
        "are not sure of. Never guess a filename.",
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
      "Read a file you saved earlier in your own workspace. Paths are relative to your workspace, " +
        "such as notes.md or reports/august.csv. Your workspace survives between conversations, so use " +
        "this to pick up notes you made before.",
      pathParameters,
      async (args) =>
        computer.readFile(botId, actionActor, { path: String(args.path) }),
    ),
    tool(
      "computer_write_file",
      "Save a file in your own workspace so you still have it later. Paths are relative to your " +
        "workspace and folders are created as needed. Set append to true to add to the end of an " +
        "existing file rather than replacing it. Text only.",
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
      "Run a shell command on your own computer. Use this for anything the browser cannot do: " +
        "installing a tool you need, processing a file you saved, running a script. The working " +
        "directory is your workspace, so paths are relative to it and files you write here are the " +
        "same ones the file tools see. Commands run in bash, so pipes and && work. Long output is " +
        "truncated from the start, and a command that runs too long is stopped. " +
        "You are not the root user, so anything that writes outside your workspace needs sudo, " +
        "which asks for no password: installing a package is " +
        "`sudo apt-get update && sudo apt-get install -y <package>`. If sudo is refused, this " +
        "computer does not grant it, so say so rather than retrying.",
      commandParameters,
      async (args) =>
        computer.runCommand(botId, actionActor, {
          command: String(args.command),
        }),
    ),
    tool(
      "computer_request_help",
      "Ask the person to take control of your computer and do something you cannot: sign in, enter a " +
        "password or a one-time code, or clear a CAPTCHA. Say specifically what you need done. They " +
        "will drive the browser themselves and hand it back, and you carry on in the same session. " +
        "Use this INSTEAD of giving up, and instead of ever asking them to type a password to you. " +
        "This call is the only thing that reaches them: until you make it they are not looking at the " +
        "page and have no way to help, so saying you need them to sign in, or asking whether they would " +
        "like to proceed, hands over nothing and leaves the page where it is.",
      helpParameters,
      async (args) => {
        const reason =
          String(args.reason).trim() ||
          "The assistant needs a person to continue.";
        await computer.requestHelp(botId, actionActor, reason);
        try {
          await options.onNeedsYou?.({ kind: "help", reason });
        } catch {
          // The ask is already on the computer. Losing the job row or notify must not hide it.
        }
        return { ok: true, needs_you: true, kind: "help", reason };
      },
    ),
    tool(
      "computer_request_secret",
      "Ask the person for ONE value you must not be told: a password, a one-time code, a card number. " +
        "Focus the field first with computer_click, then call this with the ref of that field and a " +
        "short label for what you need. They type it into a masked box that goes straight to the page. " +
        "You will never see the value, and you must not ask for it any other way. Prefer this over a " +
        "full takeover when you only need one field filled in. The value is only TYPED into the field: " +
        "if the form needs submitting, do that yourself afterwards with computer_click.",
      secretParameters,
      async (args) => {
        const label =
          String(args.label).trim() || "the value this page is asking for";
        await computer.requestSecret(botId, actionActor, {
          label,
          ref: String(args.ref),
          snapshotId: Number(args.snapshotId),
        });
        try {
          await options.onNeedsYou?.({ kind: "secret", label });
        } catch {
          // The ask is already on the computer. Losing the job row or notify must not hide it.
        }
        return { ok: true, needs_you: true, kind: "secret", label };
      },
    ),
  ];
}

export function lastActionForNeedsYou(event: ComputerNeedsYouEvent): string {
  if (event.kind === "unavailable") {
    return COMPUTER_UNAVAILABLE_LAST_ACTION;
  }
  if (event.kind === "secret") {
    return `Needs you: enter ${event.label ?? "a secret"}.`;
  }
  return `Needs you: ${event.reason ?? "a person must continue."}`;
}
