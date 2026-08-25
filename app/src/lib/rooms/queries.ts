import { queryOptions } from "@tanstack/react-query";
import { client } from "@/lib/client";
import type { UnattendedJobRecord } from "@/lib/jobs/queries";

export type RoomMember = {
  id: string;
  name: string;
  standingRole: "orchestrator" | null;
};

export type GoalRoom = {
  id: string;
  name: string;
  goalId: string;
  threadId: string;
  agentIds: string[];
  members: RoomMember[];
  jobs: UnattendedJobRecord[];
};

export type RoomSummary = {
  id: string;
  name: string;
  goalId: string;
  threadId: string;
  agentIds: string[];
  goalStatus: "Active" | "Needs you" | "Done";
  lastAction: string | null;
  lastActionAt: string | null;
};

export const roomKeys = {
  all: ["rooms"] as const,
  list: () => ["rooms", "list"] as const,
  detail: (channelId: string) => ["rooms", "detail", channelId] as const,
};

export function roomListQueryOptions() {
  return queryOptions({
    queryKey: roomKeys.list(),
    queryFn: (): Promise<RoomSummary[]> =>
      client("/api/rooms", "rooms", {
        fallback: "Could not load rooms",
      }),
  });
}

export function roomQueryOptions(channelId: string) {
  return queryOptions({
    queryKey: roomKeys.detail(channelId),
    queryFn: (): Promise<GoalRoom> =>
      client(`/api/rooms/${channelId}`, "room", {
        fallback: "Could not load this room",
      }),
  });
}
