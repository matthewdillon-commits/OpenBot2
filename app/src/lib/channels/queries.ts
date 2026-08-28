import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
} from "@tanstack/react-query";
import { client } from "@/lib/client";
import {
  type GoalListStatus,
  normalizeGoalQuery,
  parseGoalListStatus,
} from "./search";

export type LoopOutcome = "worked" | "didn't" | "unknown";
export type LoopDecision = "keep" | "revise" | "revert";
export type LoopStage =
  | "observe"
  | "understand"
  | "prioritize"
  | "act"
  | "measure"
  | "improve";

export type PublicApprovalCard = {
  rationale: string;
  expectedImpact: string;
  before: string;
  after: string;
  rollback: string;
  status: "waiting" | "decided";
  jobId: string | null;
};

export type PublicLoopDecision = {
  decision: LoopDecision;
  at: string;
  note: string | null;
};

/**
 * A channel as the browser sees it.
 *
 * `threadId` is what makes two channels with the same coworker independent conversations, and
 * `active` is false once a linked coworker has been deleted: the transcript stays readable, but
 * nothing more can be said in it.
 */
export type AgentChannel = {
  id: string;
  name: string;
  agentIds: string[];
  threadId: string;
  active: boolean;
  expectedImpact?: string | null;
  outcome?: LoopOutcome | null;
  loopStage?: LoopStage | null;
  approval?: PublicApprovalCard | null;
  lastDecision?: PublicLoopDecision | null;
};

/** A channel plus the last thing said in it, which is what the roster renders. */
export type ChannelSummary = AgentChannel & {
  lastMessage: string | null;
  /** ISO-8601, or null for a channel nobody has used yet. */
  lastMessageAt: string | null;
  lastMessageAgentId: string | null;
  /** ISO-8601. Ordering falls back to this, so a channel just created sorts to the top. */
  createdAt: string;
  /** Phase 1 skinny goal status. Not an approval card. */
  goalStatus: "Active" | "Needs you" | "Done";
  lastAction: string | null;
  lastActionAt: string | null;
};

export type ChannelListFilters = {
  search?: string;
  status?: GoalListStatus;
};

export function channelListFilters(filters: ChannelListFilters = {}): {
  search: string;
  status: GoalListStatus;
} {
  return {
    search: normalizeGoalQuery(filters.search ?? ""),
    status: parseGoalListStatus(filters.status),
  };
}

export const channelKeys = {
  all: ["channels"] as const,
  /** Prefix that matches every paged roster, whatever it is filtered by. */
  lists: () => ["channels", "list"] as const,
  list: (filters: ChannelListFilters = {}) =>
    ["channels", "list", channelListFilters(filters)] as const,
  detail: (channelId: string) => ["channels", "detail", channelId] as const,
};

/** One page of channels, and where the next one starts. */
export type ChannelPage = {
  channels: ChannelSummary[];
  nextCursor: string | null;
};

export function channelListPath(
  filters: ChannelListFilters = {},
  cursor = "",
): string {
  const { search, status } = channelListFilters(filters);
  const query = new URLSearchParams();
  if (search) query.set("search", search);
  if (status !== "all") query.set("status", status);
  if (cursor) query.set("cursor", cursor);
  const suffix = query.size > 0 ? `?${query}` : "";
  return `/api/channels${suffix}`;
}

/**
 * The sidebar's channels, a page at a time.
 *
 * It used to ask for every channel this person has, one row per channel-agent pair, on every render.
 * Nothing removes a channel, so somebody who talks to their Bot daily accumulates thousands and the
 * query grows monotonically for as long as they use the product.
 *
 * Search and status go to the server. Filtering the page that arrived would only search the first
 * fifty, which is how an existing goal used to vanish under a query.
 *
 * The pages are flattened for the caller, so the sidebar and the socket that patches it both see one
 * array in recency order and neither has to know this is paged.
 */
export function channelListQueryOptions(filters: ChannelListFilters = {}) {
  const normalised = channelListFilters(filters);
  return infiniteQueryOptions({
    queryKey: channelKeys.list(normalised),
    initialPageParam: "",
    placeholderData: keepPreviousData,
    queryFn: async ({ pageParam }): Promise<ChannelPage> => {
      const response = await client(
        channelListPath(normalised, pageParam as string),
        {
          fallback: "Could not load channels",
        },
      );
      return (await response.json()) as ChannelPage;
    },
    getNextPageParam: (page: ChannelPage) => page.nextCursor ?? undefined,
    select: (data): ChannelSummary[] =>
      data.pages.flatMap((page) => page.channels),
  });
}

export function channelQueryOptions(channelId: string) {
  return queryOptions({
    queryKey: channelKeys.detail(channelId),
    queryFn: async (): Promise<AgentChannel> => {
      return client(`/api/channels/${channelId}`, "channel", {
        fallback: "Could not load this channel",
      });
    },
  });
}
