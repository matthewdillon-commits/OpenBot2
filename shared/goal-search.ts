/**
 * Goal roster search and status filters.
 *
 * The same normalised query has to mean the same thing in the sidebar, the
 * command palette, and `GET /api/channels`. Filtering a loaded page in the
 * browser is not enough: the server pages the roster, so a match that is not
 * on page one would otherwise look like it does not exist.
 */

export const GOAL_LIST_STATUSES = ["all", "active", "completed"] as const;
export type GoalListStatus = (typeof GOAL_LIST_STATUSES)[number];

export const GOAL_LIST_STATUS_LABEL: Record<GoalListStatus, string> = {
  all: "All",
  active: "Active",
  completed: "Completed",
};

/** Trim surrounding whitespace. Case is folded by the matcher / `ILIKE`, not here. */
export function normalizeGoalQuery(value: string): string {
  return value.trim();
}

export function parseGoalListStatus(
  value: string | null | undefined,
): GoalListStatus {
  if (value === "active" || value === "completed") return value;
  return "all";
}

/**
 * Fields a roster row actually shows. Searching anything else returns a hit
 * the person cannot account for.
 */
export function goalSearchHaystack(goal: {
  name?: string | null;
  lastMessage?: string | null;
  lastAction?: string | null;
}): string {
  return [goal.name, goal.lastMessage, goal.lastAction]
    .filter(
      (field): field is string => typeof field === "string" && field.length > 0,
    )
    .join("\n")
    .toLowerCase();
}

export function goalMatchesQuery(
  goal: {
    name?: string | null;
    lastMessage?: string | null;
    lastAction?: string | null;
  },
  query: string,
): boolean {
  const needle = normalizeGoalQuery(query).toLowerCase();
  if (!needle) return true;
  return goalSearchHaystack(goal).includes(needle);
}

/**
 * Active is unfinished work (Active and Needs you). Completed is Done.
 * A Needs-you goal must not vanish from Active — that is another false empty.
 */
export function goalMatchesStatus(
  goalStatus: "Active" | "Needs you" | "Done" | null | undefined,
  status: GoalListStatus,
): boolean {
  if (status === "all") return true;
  if (status === "completed") return goalStatus === "Done";
  return goalStatus !== "Done";
}

export type GoalEmptyKind =
  | "none"
  | "hold"
  | "no-goals"
  | "no-matches"
  | "no-filter-matches";

/**
 * Which empty sentence, if any, the roster may show.
 *
 * `hold` covers first load, a filter/search that has not arrived, and exit
 * animations that are still on screen — showing "no matches" in any of those
 * is the false-empty the audit caught.
 */
export function goalEmptyKind(input: {
  pending: boolean;
  placeholder: boolean;
  exiting: boolean;
  rowCount: number;
  query: string;
  status: GoalListStatus;
}): GoalEmptyKind {
  if (input.pending || input.placeholder || input.exiting) return "hold";
  if (input.rowCount > 0) return "none";
  if (normalizeGoalQuery(input.query)) return "no-matches";
  if (input.status !== "all") return "no-filter-matches";
  return "no-goals";
}

export function goalEmptyCopy(
  kind: GoalEmptyKind,
  query: string,
  status: GoalListStatus = "all",
): string | null {
  switch (kind) {
    case "no-goals":
      return "You don't have goals yet. Ask LimitlessAI what the business should get done.";
    case "no-matches":
      return `No goals match your search. Nothing here is named “${normalizeGoalQuery(query)}”, and nobody has said it recently either.`;
    case "no-filter-matches":
      return status === "completed"
        ? "No completed goals."
        : "No active goals.";
    default:
      return null;
  }
}
