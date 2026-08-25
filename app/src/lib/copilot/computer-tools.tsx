import { useFrontendTool, useRenderTool } from "@copilotkit/react-core/v2";
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { z } from "zod";
import { ToolLine } from "@/components/channels/tool-line";
import { CommandOutput } from "@/components/computer/command-output";
import { ComputerView } from "@/components/computer/computer-view";
import { tryClient } from "@/lib/client";
import { noteBrowsed, recordActivity } from "@/lib/computers/activity";
import { computerCapabilityQueryOptions } from "@/lib/computers/queries";
import { useActiveBotHolder } from "./active-bot";
import { reportComputerActivity } from "./computer-activity";

/**
 * Render-only computer tools. Execute lives on the server; this file paints the
 * watch pane and Activity lines. A frontend handler on the same name would keep
 * the tab loop — that is a failed Phase 2.
 */

/** What every computer call returns to the model: either the result, or a reason it did not happen. */
export type ToolOutcome = Record<string, unknown> & { ok: boolean };

/** What a computer tool's render can read back out of its own result. */
type ComputerOutcome = {
  ok?: boolean;
  stopped?: boolean;
  humanHasControl?: boolean;
  entries?: unknown[];
  refused?: boolean;
  reason?: string;
  staleRefs?: boolean;
  elements?: unknown[];
  element?: { role?: string; name?: string };
  /** What a shell call reports back, so the line can show the output rather than only the command. */
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  /** The far side cut the output short, or stopped the command. */
  truncated?: boolean;
  timedOut?: boolean;
  /** A file write. The size, never what was written. */
  bytes?: number;
  /** A file read. Named `text` on the way back and `contents` on the way in. */
  text?: string;
};

/**
 * What a call printed, as text a person can read.
 *
 * One helper because the three surfaces this feeds all want the same thing and shape it differently:
 * a command has `stdout` and `stderr`, a file read has `contents`, a listing has `entries`. A refusal
 * carries only its reason, and that is the most useful thing on the line.
 *
 * Never guesses. Something with none of those fields gives an empty string, and the pane says the
 * call printed nothing rather than inventing a summary.
 */
export function outputOf(result: ToolOutcome): string {
  if (result.refused === true || result.ok === false) {
    return typeof result.reason === "string" ? result.reason : "";
  }

  // `text`, which is what the read route answers with. Not `contents`: that is the name on the way
  // in, and reading it back gave an empty pane for a file the Bot had just read out loud.
  if (typeof result.text === "string") return result.text;

  if (Array.isArray(result.entries)) {
    return result.entries
      .map((entry) => {
        if (!entry || typeof entry !== "object") return String(entry);
        const { path, kind, bytes } = entry as Record<string, unknown>;
        const label = String(path ?? "");
        // A trailing slash for a folder, the way a terminal marks one, so a listing of a workspace
        // full of folders does not read as a list of extensionless files.
        if (kind === "folder") return `${label}/`;
        return typeof bytes === "number" ? `${label}  ${bytes} bytes` : label;
      })
      .join("\n");
  }

  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  // Both, in the order a terminal shows them, and labelled only when there is something on stderr:
  // most commands write nothing there and a permanent empty heading is noise.
  return stderr ? `${stdout}${stdout ? "\n" : ""}${stderr}` : stdout;
}

/**
 * Parse the SDK-render result string so the transcript can distinguish success, refusal, and failure.
 */
function outcomeOf(result: string | undefined): ComputerOutcome {
  if (!result) return {};
  try {
    const parsed = JSON.parse(result) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as ComputerOutcome)
      : {};
  } catch {
    // Runtime stringifies thrown handlers as "Error: <message>". A refusal string from the
    // server starts with "Refused." and is not JSON.
    if (result.startsWith("Error:")) {
      return { ok: false, reason: result.slice("Error:".length).trim() };
    }
    if (result.startsWith("Refused.")) {
      return { ok: false, refused: true, reason: result };
    }
    return {};
  }
}

/**
 * The label of the element an action touched, as the gateway resolved it server-side.
 *
 * Not taken from the model's arguments: those carry only a ref. The server looked the element up in
 * the snapshot it took itself, which is the same value it wrote to the audit trail, so the transcript
 * and the audit row name the thing identically.
 */
function labelOf(result: string | undefined): string | undefined {
  const element = (outcomeOf(result) as { element?: { name?: unknown } })
    .element;
  const name = element?.name;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

/**
 * Watch-pane side effects that used to live in handlers.
 *
 * Render runs on every paint, so each tool-call id is recorded once: activity
 * (open the pane) as soon as the call appears, list/read/write/run and
 * noteBrowsed only when the result is in.
 */
export function rememberComputerToolRender(input: {
  name: string;
  botId: string;
  status?: string;
  result?: string;
  args?: Record<string, unknown>;
  toolCallId?: string;
  seen: Set<string>;
}): void {
  const id =
    input.toolCallId ??
    `${input.name}:${input.status ?? ""}:${input.result ?? "running"}`;
  if (!input.seen.has(`activity:${id}`)) {
    input.seen.add(`activity:${id}`);
    reportComputerActivity(input.botId);
  }
  if (input.status !== "complete") return;
  if (input.seen.has(`record:${id}`)) return;
  input.seen.add(`record:${id}`);

  const outcome = outcomeOf(input.result);
  if (input.name === "computer_navigate" && outcome.ok === true) {
    noteBrowsed(input.botId);
  }

  const args = input.args ?? {};
  if (input.name === "computer_list_files") {
    const path = typeof args.path === "string" ? args.path : undefined;
    recordActivity(input.botId, {
      kind: "list_files",
      subject: path ?? "the workspace",
      output: outputOf(outcome as ToolOutcome),
      ...(outcome.refused === true ? { refused: true } : {}),
    });
  }
  if (input.name === "computer_read_file") {
    recordActivity(input.botId, {
      kind: "read_file",
      subject: typeof args.path === "string" ? args.path : "",
      output: outputOf(outcome as ToolOutcome),
      ...(outcome.refused === true ? { refused: true } : {}),
    });
  }
  if (input.name === "computer_write_file") {
    recordActivity(input.botId, {
      kind: "write_file",
      subject: typeof args.path === "string" ? args.path : "",
      output:
        outcome.refused === true
          ? outputOf(outcome as ToolOutcome)
          : typeof outcome.bytes === "number"
            ? `${outcome.bytes} bytes${args.append === true ? ", appended" : ""}`
            : "",
      ...(outcome.refused === true ? { refused: true } : {}),
    });
  }
  if (input.name === "computer_run_command") {
    recordActivity(input.botId, {
      kind: "command",
      subject: typeof args.command === "string" ? args.command : "",
      output: outputOf(outcome as ToolOutcome),
      ...(typeof outcome.exitCode === "number"
        ? { exitCode: outcome.exitCode }
        : {}),
      ...(outcome.refused === true ? { refused: true } : {}),
      ...(outcome.truncated === true ? { truncated: true } : {}),
      ...(outcome.timedOut === true ? { timedOut: true } : {}),
    });
  }
}

function argsOf(props: {
  args?: unknown;
  parameters?: unknown;
}): Record<string, unknown> {
  const raw = props.args ?? props.parameters;
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function toolCallIdOf(props: {
  id?: unknown;
  toolCallId?: unknown;
}): string | undefined {
  if (typeof props.toolCallId === "string" && props.toolCallId) {
    return props.toolCallId;
  }
  if (typeof props.id === "string" && props.id) return props.id;
  return undefined;
}

/**
 * A compact transcript line that distinguishes policy refusals from ordinary failures.
 */
function ActionLine({
  label,
  detail,
  running,
  refused,
  failed,
}: {
  label: string;
  detail?: string;
  running?: boolean;
  /** A policy or a boundary said no. Final: nothing the Bot does differently will help. */
  refused?: boolean;
  /** It was permitted and did not work. A different request might. */
  failed?: boolean;
}) {
  return (
    <ToolLine
      detail={detail}
      failed={failed}
      label={label}
      refused={refused}
      running={running}
    />
  );
}

/** Whether a result is an ordinary failure rather than a refusal, so the two can render differently. */
function didNotWork(outcome: ComputerOutcome): boolean {
  return outcome.ok === false && outcome.refused !== true;
}

/**
 * Offered only while the administrator has left the browser on.
 *
 * The registrations are hooks, so they live in a child that is not mounted when the switch is off.
 * Asking the same hooks behind an `if` would break the rules of hooks the moment the flag flipped.
 * Pending is nothing: registering first and taking the tools away a moment later is a flicker of
 * hands a Bot should not have been told it had.
 */
export function ComputerTools() {
  const capability = useQuery(computerCapabilityQueryOptions());
  if (capability.isPending) return null;
  if (capability.error || capability.data?.browserEnabled !== true) return null;
  return <RegisteredComputerTools />;
}

type ToolRenderProps = {
  status?: string;
  result?: string;
  args?: unknown;
  parameters?: unknown;
  id?: unknown;
  toolCallId?: unknown;
};

function RegisteredComputerTools() {
  const bot = useActiveBotHolder();
  const seen = useRef(new Set<string>());

  function watch(name: string, props: ToolRenderProps) {
    rememberComputerToolRender({
      name,
      botId: bot.current,
      status: props.status,
      result: props.result,
      args: argsOf(props),
      toolCallId: toolCallIdOf(props),
      seen: seen.current,
    });
  }

  useRenderTool(
    {
      name: "computer_navigate",
      description:
        "Open a web page on your own computer so the person can watch. Use this when asked to look " +
        "at, visit, open or check a website. Returns the page title and its readable text, so answer " +
        "from what comes back rather than telling the person to go and look.",
      parameters: z.object({
        url: z.string().describe("Full web address to open, including https://"),
      }),
      render: (props: ToolRenderProps) => {
        watch("computer_navigate", props);
        return (
          <div className="my-2">
            <ComputerView
              computerId={bot.current}
              active={props.status !== "complete"}
            />
          </div>
        );
      },
    },
    [],
  );

  useRenderTool(
    {
      name: "computer_read",
      description:
        "Read the page currently open on your computer, without opening anything. Use this after you " +
        "click something that changes the page, such as submitting a form, to find out what it now says.",
      parameters: z.object({}),
      render: (props: ToolRenderProps) => {
        watch("computer_read", props);
        return <></>;
      },
    },
    [],
  );

  useRenderTool(
    {
      name: "computer_snapshot",
      description:
        "List the things on the current page you can act on: fields, buttons, links and checkboxes, " +
        "each with a ref, its label and its current value. Call this BEFORE clicking or typing, and " +
        "use the refs it returns. Always send back the snapshotId it gives you. If an action reports " +
        "that your refs are stale, the page changed: call this again and use the new refs.",
      parameters: z.object({}),
      render: (props: ToolRenderProps) => {
        watch("computer_snapshot", props);
        const outcome = outcomeOf(props.result);
        const elements = Array.isArray(outcome.elements) ? outcome.elements : [];
        return (
          <ActionLine
            running={props.status !== "complete"}
            label="Read the page"
            detail={
              elements.length
                ? `${elements.length} thing${elements.length === 1 ? "" : "s"} it can act on`
                : undefined
            }
          />
        );
      },
    },
    [],
  );

  useRenderTool(
    {
      name: "computer_type",
      description:
        "Enter text into a field on the page. Give the ref of the field from your most recent " +
        "snapshot and the snapshotId it came from. This replaces whatever the field already contains. " +
        "Set submit to true to press Enter afterwards.",
      parameters: z.object({
        ref: z
          .string()
          .describe("Ref of the field, from your most recent snapshot"),
        snapshotId: z.number().describe("The snapshotId that ref came from"),
        text: z.string().describe("The text to enter"),
        submit: z
          .boolean()
          .optional()
          .describe("Press Enter after typing, to submit a single-field form"),
      }),
      render: (props: ToolRenderProps) => {
        watch("computer_type", props);
        const args = argsOf(props);
        return (
          <ActionLine
            running={props.status !== "complete"}
            label="Filled in"
            detail={
              labelOf(props.result) ??
              (typeof args.ref === "string" ? args.ref : undefined)
            }
            refused={outcomeOf(props.result).refused === true}
            failed={didNotWork(outcomeOf(props.result))}
          />
        );
      },
    },
    [],
  );

  useRenderTool(
    {
      name: "computer_click",
      description:
        "Click something on the page: a button, a link, a checkbox or a radio option. Give the ref " +
        "from your most recent snapshot and the snapshotId it came from.",
      parameters: z.object({
        ref: z
          .string()
          .describe(
            "Ref of the element to click, from your most recent snapshot",
          ),
        snapshotId: z.number().describe("The snapshotId that ref came from"),
      }),
      render: (props: ToolRenderProps) => {
        watch("computer_click", props);
        const outcome = outcomeOf(props.result);
        const args = argsOf(props);
        return (
          <ActionLine
            running={props.status !== "complete"}
            label="Clicked"
            detail={
              outcome.refused === true
                ? String(outcome.reason ?? "")
                : (labelOf(props.result) ??
                  (typeof args.ref === "string" ? args.ref : undefined))
            }
            refused={outcome.refused === true}
            failed={didNotWork(outcome)}
          />
        );
      },
    },
    [],
  );

  useRenderTool(
    {
      name: "computer_key",
      description:
        "Press a key, such as Enter, Tab or Escape. Give a ref to press it while a particular field " +
        "is focused, or omit the ref to press it on the page.",
      parameters: z.object({
        key: z.string().describe("Key name, such as Enter, Tab or Escape"),
        ref: z.string().optional().describe("Optional ref to press the key on"),
        snapshotId: z
          .number()
          .optional()
          .describe("The snapshotId the ref came from, required if ref is given"),
      }),
      render: (props: ToolRenderProps) => {
        watch("computer_key", props);
        const args = argsOf(props);
        return (
          <ActionLine
            running={props.status !== "complete"}
            label="Pressed"
            detail={typeof args.key === "string" ? args.key : undefined}
            refused={outcomeOf(props.result).refused === true}
            failed={didNotWork(outcomeOf(props.result))}
          />
        );
      },
    },
    [],
  );

  useRenderTool(
    {
      name: "computer_request_secret",
      description:
        "Ask the person for ONE value you must not be told: a password, a one-time code, a card number. " +
        "Focus the field first with computer_click, then call this with the ref of that field and a " +
        "short label for what you need. They type it into a masked box that goes straight to the page. " +
        "You will never see the value, and you must not ask for it any other way. Prefer this over a " +
        "full takeover when you only need one field filled in. The value is only TYPED into the field: " +
        "if the form needs submitting, do that yourself afterwards with computer_click.",
      parameters: z.object({
        label: z
          .string()
          .describe(
            "What you need, in a few words, e.g. 'the code sent to your phone'",
          ),
        ref: z
          .string()
          .describe(
            "Ref of the field it goes in, from your most recent snapshot",
          ),
        snapshotId: z.number().describe("The snapshotId that ref came from"),
      }),
      render: (props: ToolRenderProps) => {
        watch("computer_request_secret", props);
        return <></>;
      },
    },
    [],
  );

  /** Self-reported model declines: audit evidence, not an enforcement control. */
  useFrontendTool({
    name: "report_refusal",
    description:
      "Record that you DECLINED something you were asked to do, because it looked unsafe, was outside " +
      "what you are for, or you judged you should not. Call this whenever you say no to a request, in " +
      "addition to telling the person. It changes nothing about your answer; it exists so an " +
      "administrator can see what this Bot is being asked to do. Do not call it when you simply could " +
      "not do something, only when you chose not to.",
    parameters: z.object({
      reason: z
        .string()
        .describe("Why you declined, in one sentence and in your own words"),
      request: z
        .string()
        .optional()
        .describe("What you were asked to do, in a few words"),
    }),
    handler: async (
      input: { reason: string; request?: string },
      { signal }: { signal?: AbortSignal } = {},
    ) => {
      try {
        const response = await tryClient(
          `/api/agents/${encodeURIComponent(bot.current)}/declined`,
          { method: "POST", body: input, signal },
        );
        return response.ok
          ? "Recorded. Now tell the person what you decided and why."
          : "That could not be recorded. Tell the person what you decided anyway.";
      } catch {
        // Audit bookkeeping must not prevent the Bot from answering.
        return "That could not be recorded. Tell the person what you decided anyway.";
      }
    },
    render: () => null,
  });

  useRenderTool(
    {
      name: "computer_request_help",
      description:
        "Ask the person to take control of your computer and do something you cannot: sign in, enter a " +
        "password or a one-time code, or clear a CAPTCHA. Say specifically what you need done. They " +
        "will drive the browser themselves and hand it back, and you carry on in the same session. " +
        "Use this INSTEAD of giving up, and instead of ever asking them to type a password to you. " +
        "This call is the only thing that reaches them: until you make it they are not looking at the " +
        "page and have no way to help, so saying you need them to sign in, or asking whether they would " +
        "like to proceed, hands over nothing and leaves the page where it is.",
      parameters: z.object({
        reason: z
          .string()
          .describe(
            "What you need the person to do, in one sentence, e.g. 'This page is asking for a code sent to your phone.'",
          ),
      }),
      render: (props: ToolRenderProps) => {
        watch("computer_request_help", props);
        return <></>;
      },
    },
    [],
  );

  useRenderTool(
    {
      name: "computer_list_files",
      description:
        "List what is in your workspace: every file and folder you have saved, with sizes. Call this " +
        "FIRST when you are asked what files you have, or before reading a file whose exact name you " +
        "are not sure of. Never guess a filename.",
      parameters: z.object({
        path: z
          .string()
          .optional()
          .describe("Optional folder to list. Omit for the whole workspace."),
      }),
      render: (props: ToolRenderProps) => {
        watch("computer_list_files", props);
        const outcome = outcomeOf(props.result);
        const entries = Array.isArray(outcome.entries) ? outcome.entries : [];
        return (
          <ActionLine
            running={props.status !== "complete"}
            label="Listed files"
            detail={
              outcome.refused === true || didNotWork(outcome)
                ? String(outcome.reason ?? "")
                : entries.length
                  ? `${entries.length} item${entries.length === 1 ? "" : "s"} in the workspace`
                  : "nothing saved yet"
            }
            refused={outcome.refused === true}
            failed={didNotWork(outcome)}
          />
        );
      },
    },
    [],
  );

  useRenderTool(
    {
      name: "computer_read_file",
      description:
        "Read a file you saved earlier in your own workspace. Paths are relative to your workspace, " +
        "such as notes.md or reports/august.csv. Your workspace survives between conversations, so use " +
        "this to pick up notes you made before.",
      parameters: z.object({
        path: z
          .string()
          .describe("Path relative to your workspace, such as notes.md"),
      }),
      render: (props: ToolRenderProps) => {
        watch("computer_read_file", props);
        const outcome = outcomeOf(props.result);
        const args = argsOf(props);
        return (
          <ActionLine
            running={props.status !== "complete"}
            label="Read file"
            detail={
              outcome.refused === true
                ? String(outcome.reason ?? "")
                : typeof args.path === "string"
                  ? args.path
                  : undefined
            }
            refused={outcome.refused === true}
            failed={didNotWork(outcome)}
          />
        );
      },
    },
    [],
  );

  useRenderTool(
    {
      name: "computer_run_command",
      description:
        "Run a shell command on your own computer. Use this for anything the browser cannot do: " +
        "installing a tool you need, processing a file you saved, running a script. The working " +
        "directory is your workspace, so paths are relative to it and files you write here are the " +
        "same ones the file tools see. Commands run in bash, so pipes and && work. Long output is " +
        "truncated from the start, and a command that runs too long is stopped. " +
        "You are not the root user, so anything that writes outside your workspace needs sudo, " +
        "which asks for no password: installing a package is " +
        "`sudo apt-get update && sudo apt-get install -y <package>`. If sudo is refused, this " +
        "computer does not grant it, so say so rather than retrying.",
      parameters: z.object({
        command: z
          .string()
          .describe("The command to run, such as: sudo apt-get install -y jq"),
      }),
      render: (props: ToolRenderProps) => {
        watch("computer_run_command", props);
        const outcome = outcomeOf(props.result);
        const args = argsOf(props);
        const printed = outputOf(outcome as ToolOutcome);
        const exit = typeof outcome.exitCode === "number" ? outcome.exitCode : 0;
        return (
          <ToolLine
            running={props.status !== "complete"}
            label="Ran a command"
            detail={
              outcome.refused === true
                ? String(outcome.reason ?? "")
                : typeof args.command === "string"
                  ? args.command
                  : undefined
            }
            refused={outcome.refused === true}
            failed={didNotWork(outcome) || exit !== 0}
          >
            {props.status === "complete" ? (
              <CommandOutput
                output={printed}
                exitCode={exit}
                truncated={outcome.truncated === true}
                timedOut={outcome.timedOut === true}
              />
            ) : null}
          </ToolLine>
        );
      },
    },
    [],
  );

  useRenderTool(
    {
      name: "computer_write_file",
      description:
        "Save a file in your own workspace so you still have it later. Paths are relative to your " +
        "workspace and folders are created as needed. Set append to true to add to the end of an " +
        "existing file rather than replacing it. Text only.",
      parameters: z.object({
        path: z
          .string()
          .describe(
            "Path relative to your workspace, such as reports/august.csv",
          ),
        contents: z.string().describe("The text to save"),
        append: z
          .boolean()
          .optional()
          .describe("Add to the end of the file instead of replacing it"),
      }),
      render: (props: ToolRenderProps) => {
        watch("computer_write_file", props);
        const outcome = outcomeOf(props.result);
        const args = argsOf(props);
        return (
          <ActionLine
            running={props.status !== "complete"}
            label={args.append === true ? "Added to file" : "Saved file"}
            detail={
              outcome.refused === true
                ? String(outcome.reason ?? "")
                : typeof args.path === "string"
                  ? args.path
                  : undefined
            }
            refused={outcome.refused === true}
            failed={didNotWork(outcome)}
          />
        );
      },
    },
    [],
  );

  useRenderTool(
    {
      name: "computer_scroll",
      description:
        "Scroll the page down, or up with a negative amount, to bring more of a long page into view.",
      parameters: z.object({
        deltaY: z
          .number()
          .optional()
          .describe("Pixels to scroll; positive is down. Defaults to 600."),
      }),
      render: (props: ToolRenderProps) => {
        watch("computer_scroll", props);
        return (
          <ActionLine
            running={props.status !== "complete"}
            label="Scrolled"
            refused={outcomeOf(props.result).refused === true}
            failed={didNotWork(outcomeOf(props.result))}
          />
        );
      },
    },
    [],
  );

  return null;
}
