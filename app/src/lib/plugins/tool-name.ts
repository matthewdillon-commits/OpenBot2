/**
 * A tool call, named the way the person watching would name it.
 *
 * The model is offered `mcp__notes__search_notes`, because a tool name has to be unique across every
 * server a Bot holds and has to survive two vendors both calling something `search`. None of that is
 * the reader's problem, and putting it on screen tells them how the thing is built rather than what
 * their Bot just did.
 *
 * Built-in names that humanise poorly (`crm_create` → "Crm create") get a phrase. Remaining
 * snake_case (`search_web`) is still split and sentence-cased. camelCase gallery names are left
 * alone — those were chosen for the screen already.
 */
export type ToolName = {
  /** What was done, for the line itself. */
  label: string;
  /** Which server it was done against, muted beside the label. Absent for anything not MCP. */
  detail?: string;
};

const ACTION_LABELS: Record<string, string> = {
  crm_search: "Search CRM",
  crm_get: "Read CRM",
  crm_create: "Add to CRM",
  crm_update: "Update CRM",
  crm_send: "Send from CRM",
};

export function readToolName(name: string): ToolName {
  const mapped = ACTION_LABELS[name];
  if (mapped) return { label: mapped };

  const parts = name.split("__");
  if (parts.length < 3 || parts[0] !== "mcp") {
    return { label: name.includes("_") ? humanise(name) : name };
  }

  const [, server, ...rest] = parts;
  const tool = rest.join("__");
  const label = humanise(tool);

  /*
   * The server is dropped when the action already says it. Vendors name a tool after the thing it
   * searches, so `mcp__notes__search_notes` would otherwise read "Search notes notes", which looks
   * like a bug rather than a label.
   */
  const named = label.toLowerCase().includes((server ?? "").toLowerCase());
  return named ? { label } : { label, detail: server };
}

/**
 * `search_notes` as "Search notes".
 *
 * Vendors write tool names in snake_case, camelCase or a mixture, and the only thing they agree on
 * is that the first word is a verb. Splitting on both and sentence-casing the result gets a phrase
 * that reads as an action without anybody maintaining a table of names.
 */
function humanise(tool: string): string {
  const words = tool
    .replace(/[_-]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  if (words.length === 0) return tool;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A short hint from the call itself, when the arguments carry one.
 *
 * Search uses `query`; CRM create uses `name`. Shown beside the action so "Search web" or
 * "Add to CRM" is not an empty claim. Other argument shapes are ignored rather than dumped; a
 * JSON blob next to the line is the identifier problem again.
 */
export function toolHintFrom(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["query", "name", "subject", "to_address"] as const) {
    const field = record[key];
    if (typeof field === "string" && field.trim()) return field.trim();
  }
  return undefined;
}

export function toolHintFromArgs(args: string): string | undefined {
  try {
    return toolHintFrom(JSON.parse(args) as unknown);
  } catch {
    return undefined;
  }
}
