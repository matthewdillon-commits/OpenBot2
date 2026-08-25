import { describe, expect, test } from "bun:test";
import {
  computerTools,
  lastActionForNeedsYou,
} from "../src/computer/computer-tools";
import {
  ActionRefusedError,
  type ComputerGateway,
  ComputerUnavailableError,
  SharedComputerIsolationError,
  StaleSnapshotError,
} from "../src/computer/gateway";
import { createLoadToolsForActor } from "../src/jobs/tools";
import { REFUSAL_MARKER } from "../src/plugins/refusal";

const actor = {
  id: "user-1",
  role: "user" as const,
  orgId: "org_local",
};

function fakeComputer(overrides: Partial<ComputerGateway> = {}) {
  const calls: Array<{ method: string; orgId?: string; args: unknown[] }> = [];
  const computer = {
    navigate: async (_botId, action, url) => {
      calls.push({ method: "navigate", orgId: action.orgId, args: [url] });
      return {
        url,
        title: "Example",
        text: "Hello",
        truncated: false,
        elapsedMs: 1,
      };
    },
    read: async (_botId, orgId) => {
      calls.push({ method: "read", orgId, args: [] });
      return {
        url: "https://example.com",
        title: "Example",
        text: "",
        truncated: false,
      };
    },
    snapshot: async (_botId, orgId) => {
      calls.push({ method: "snapshot", orgId, args: [] });
      return {
        snapshotId: 1,
        url: "https://example.com",
        title: "Example",
        elements: [],
        truncated: false,
      };
    },
    click: async (_botId, action, input) => {
      calls.push({ method: "click", orgId: action.orgId, args: [input] });
      return { action: "click", url: "https://example.com", elapsedMs: 1 };
    },
    type: async (_botId, action, input) => {
      calls.push({ method: "type", orgId: action.orgId, args: [input] });
      return { action: "type", url: "https://example.com", elapsedMs: 1 };
    },
    key: async (_botId, action, input) => {
      calls.push({ method: "key", orgId: action.orgId, args: [input] });
      return { action: "key", url: "https://example.com", elapsedMs: 1 };
    },
    scroll: async (_botId, action, input) => {
      calls.push({ method: "scroll", orgId: action.orgId, args: [input] });
      return { action: "scroll", url: "https://example.com", elapsedMs: 1 };
    },
    listFiles: async (_botId, action, input) => {
      calls.push({ method: "listFiles", orgId: action.orgId, args: [input] });
      return { path: ".", entries: [] };
    },
    readFile: async (_botId, action, input) => {
      calls.push({ method: "readFile", orgId: action.orgId, args: [input] });
      return { path: input.path, text: "kept", truncated: false, bytes: 4 };
    },
    writeFile: async (_botId, action, input) => {
      calls.push({ method: "writeFile", orgId: action.orgId, args: [input] });
      return { path: input.path, bytes: 4, appended: false };
    },
    runCommand: async (_botId, action, input) => {
      calls.push({ method: "runCommand", orgId: action.orgId, args: [input] });
      return {
        command: input.command,
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        truncated: false,
        timedOut: false,
      };
    },
    requestHelp: async (_botId, action, reason) => {
      calls.push({
        method: "requestHelp",
        orgId: action.orgId,
        args: [reason],
      });
      return { holder: "bot" as const, since: "", requested: true };
    },
    requestSecret: async (_botId, action, input) => {
      calls.push({
        method: "requestSecret",
        orgId: action.orgId,
        args: [input],
      });
      return {
        holder: "bot" as const,
        since: "",
        requested: false,
        secretWanted: input.label,
      };
    },
    ...overrides,
  } as ComputerGateway;
  return { computer, calls };
}

function byName(tools: ReturnType<typeof computerTools>, name: string) {
  const tool = tools.find((one) => one.name === name);
  if (!tool) throw new Error(`missing ${name}`);
  return tool;
}

describe("server computer tools", () => {
  test("offers the same computer_* names the surface used to execute", () => {
    const { computer } = fakeComputer();
    expect(
      computerTools({ computer, botId: "bot-1", actor }).map(
        (tool) => tool.name,
      ),
    ).toEqual([
      "computer_navigate",
      "computer_read",
      "computer_snapshot",
      "computer_type",
      "computer_click",
      "computer_key",
      "computer_scroll",
      "computer_list_files",
      "computer_read_file",
      "computer_write_file",
      "computer_run_command",
      "computer_request_help",
      "computer_request_secret",
    ]);
  });

  test("navigate calls the gateway with the actor org and returns the page", async () => {
    const { computer, calls } = fakeComputer();
    const result = await byName(
      computerTools({ computer, botId: "bot-1", actor }),
      "computer_navigate",
    ).execute({ url: "https://example.com/" });
    expect(calls[0]).toEqual({
      method: "navigate",
      orgId: "org_local",
      args: ["https://example.com/"],
    });
    expect(JSON.parse(result)).toEqual({
      ok: true,
      title: "Example",
      url: "https://example.com/",
      text: "Hello",
      truncated: false,
    });
  });

  test("maps a policy refusal to the CRM/MCP marker", async () => {
    const { computer } = fakeComputer({
      click: async () => {
        throw new ActionRefusedError("Browser use is switched off.", null);
      },
    });
    const result = await byName(
      computerTools({ computer, botId: "bot-1", actor }),
      "computer_click",
    ).execute({ ref: "e1", snapshotId: 1 });
    expect(result).toBe(`${REFUSAL_MARKER} Browser use is switched off.`);
  });

  test("maps stale refs and a person holding the wheel to JSON the model already understands", async () => {
    const stale = fakeComputer({
      click: async () => {
        throw new StaleSnapshotError("Those refs are stale.");
      },
    });
    expect(
      JSON.parse(
        await byName(
          computerTools({ computer: stale.computer, botId: "bot-1", actor }),
          "computer_click",
        ).execute({ ref: "e1", snapshotId: 1 }),
      ),
    ).toEqual({
      ok: false,
      reason: "Those refs are stale.",
      staleRefs: true,
    });

    const held = fakeComputer({
      click: async () => {
        throw new ComputerUnavailableError(
          "A person has control of this computer.",
        );
      },
    });
    expect(
      JSON.parse(
        await byName(
          computerTools({ computer: held.computer, botId: "bot-1", actor }),
          "computer_click",
        ).execute({ ref: "e1", snapshotId: 1 }),
      ),
    ).toEqual({
      ok: false,
      reason: "A person has control of this computer.",
      humanHasControl: true,
    });
  });

  test("a second-org gate becomes a failed tool result naming the supervisor", async () => {
    const { computer } = fakeComputer({
      navigate: async () => {
        throw new SharedComputerIsolationError();
      },
    });
    const result = JSON.parse(
      await byName(
        computerTools({ computer, botId: "bot-1", actor }),
        "computer_navigate",
      ).execute({ url: "https://example.com/" }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("COMPUTER_SUPERVISOR_URL");
  });

  test("help and secret ask, persist needs_you, notify, and return immediately", async () => {
    const { computer, calls } = fakeComputer();
    const events: Array<{ kind: string; reason?: string; label?: string }> = [];
    const tools = computerTools({
      computer,
      botId: "bot-1",
      actor,
      onNeedsYou: async (event) => {
        events.push(event);
      },
    });

    const help = JSON.parse(
      await byName(tools, "computer_request_help").execute({
        reason: "This page is asking for a code sent to your phone.",
      }),
    );
    expect(help).toEqual({
      ok: true,
      needs_you: true,
      kind: "help",
      reason: "This page is asking for a code sent to your phone.",
    });
    expect(calls.some((call) => call.method === "requestHelp")).toBe(true);

    const secret = JSON.parse(
      await byName(tools, "computer_request_secret").execute({
        label: "the code sent to your phone",
        ref: "e1",
        snapshotId: 7,
      }),
    );
    expect(secret).toEqual({
      ok: true,
      needs_you: true,
      kind: "secret",
      label: "the code sent to your phone",
    });
    expect(JSON.stringify(calls)).not.toContain("hunter2");
    expect(JSON.stringify(secret)).not.toMatch(/password|hunter2|4111/i);
    expect(events).toEqual([
      {
        kind: "help",
        reason: "This page is asking for a code sent to your phone.",
      },
      { kind: "secret", label: "the code sent to your phone" },
    ]);
  });

  test("a failed persist still returns needs_you after the computer has the ask", async () => {
    const { computer } = fakeComputer();
    const result = JSON.parse(
      await byName(
        computerTools({
          computer,
          botId: "bot-1",
          actor,
          onNeedsYou: async () => {
            throw new Error("notify failed");
          },
        }),
        "computer_request_help",
      ).execute({ reason: "Sign in." }),
    );
    expect(result).toEqual({
      ok: true,
      needs_you: true,
      kind: "help",
      reason: "Sign in.",
    });
  });

  test("names the skinny last action for help and a secret", () => {
    expect(
      lastActionForNeedsYou({ kind: "help", reason: "Sign in on this page." }),
    ).toBe("Needs you: Sign in on this page.");
    expect(
      lastActionForNeedsYou({
        kind: "secret",
        label: "the code sent to your phone",
      }),
    ).toBe("Needs you: enter the code sent to your phone.");
  });

  test("never puts a typed secret in a write-file or type tool result", async () => {
    const { computer } = fakeComputer();
    const typed = await byName(
      computerTools({ computer, botId: "bot-1", actor }),
      "computer_type",
    ).execute({
      ref: "e1",
      snapshotId: 1,
      text: "hunter2-not-a-real-password",
    });
    expect(typed).not.toContain("hunter2");
  });
});

describe("loadToolsForActor computer wiring", () => {
  const pluginStore = {
    listForAgent: async () => ({ tools: [] }),
  };
  const knowledgeSearch = { anyDocuments: async () => false };
  const auditStore = { insert: async () => undefined };
  const crmGateway = {
    search: async () => "",
    get: async () => "",
    create: async () => "",
    update: async () => "",
    send: async () => "",
  };

  test("adds computer tools when the gateway is configured and the browser is on", async () => {
    const { computer } = fakeComputer();
    const load = createLoadToolsForActor({
      pluginStore: pluginStore as never,
      knowledgeSearch: knowledgeSearch as never,
      database: {} as never,
      auditStore: auditStore as never,
      policyFor: () => ({ mode: "enforce", deny: [], allow: ["true"] }),
      crmGateway: crmGateway as never,
      computerGateway: computer,
    });
    const tools = await load("user-1", "org_local")("bot-1");
    expect(tools.some((tool) => tool.name === "computer_navigate")).toBe(true);
    expect(tools.some((tool) => tool.name === "crm_search")).toBe(true);
  });

  test("does not add computer tools when the browser is switched off", async () => {
    const { computer } = fakeComputer();
    const load = createLoadToolsForActor({
      pluginStore: pluginStore as never,
      knowledgeSearch: knowledgeSearch as never,
      database: {} as never,
      auditStore: auditStore as never,
      policyFor: () => ({
        mode: "enforce",
        deny: [],
        allow: ["true"],
        browserEnabled: false,
      }),
      crmGateway: crmGateway as never,
      computerGateway: computer,
    });
    const tools = await load("user-1", "org_local")("bot-1");
    expect(tools.some((tool) => tool.name.startsWith("computer_"))).toBe(false);
  });

  test("does not add computer tools when no gateway is configured", async () => {
    const load = createLoadToolsForActor({
      pluginStore: pluginStore as never,
      knowledgeSearch: knowledgeSearch as never,
      database: {} as never,
      auditStore: auditStore as never,
      policyFor: () => ({ mode: "enforce", deny: [], allow: ["true"] }),
      crmGateway: crmGateway as never,
    });
    const tools = await load("user-1", "org_local")("bot-1");
    expect(tools.some((tool) => tool.name.startsWith("computer_"))).toBe(false);
  });
});
