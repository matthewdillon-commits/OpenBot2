import { UseAgentUpdate, useAgent } from "@copilotkit/react-core/v2";
import { useQuery } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import { toVisibleChatItems } from "@/components/channels/chat-messages";
import { ServerToolLine } from "@/components/channels/server-tool-line";
import { ActivityLog } from "@/components/computer/activity-log";
import { ComputerView } from "@/components/computer/computer-view";
import { Button } from "@/components/ui/button";
import {
  activityFor,
  hasBrowsed,
  subscribeToActivity,
} from "@/lib/computers/activity";
import { appConfig } from "@/lib/generated/application-config";
import { coworkerDisplayName } from "@/lib/orchestrator";
import { toolHintFromArgs } from "@/lib/plugins/tool-name";
import { roomQueryOptions } from "@/lib/rooms/queries";

/**
 * Operator door for one goal: members the orchestrator spawned, unattended
 * jobs, and the computer/traces. Typical owners never mount this.
 */
export function SeeTheWorkPanel({
  channelId,
  focusAgentId,
}: {
  channelId: string;
  focusAgentId?: string;
}) {
  const room = useQuery(roomQueryOptions(channelId));
  const productName = appConfig.brand.productName;
  const members = room.data?.members ?? [];
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const watchAgentId =
    selectedId && members.some((member) => member.id === selectedId)
      ? selectedId
      : focusAgentId && members.some((member) => member.id === focusAgentId)
        ? focusAgentId
        : members[0]?.id;
  const watchMember = members.find((member) => member.id === watchAgentId);
  const traceAgentId =
    members.find((member) => member.standingRole === "orchestrator")?.id ??
    members[0]?.id;

  if (room.isPending) return null;
  if (room.error || !room.data) {
    return (
      <p className="p-4 text-sm text-destructive" role="alert">
        Could not load this room.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h2 className="text-sm font-medium tracking-tight">Room</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Orchestrator and specialists on this goal. Same organization CRM.
        </p>
        <ul className="mt-2 flex flex-col gap-1">
          {members.map((member) => (
            <li key={member.id}>
              <button
                className={`w-full rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50 ${
                  member.id === watchAgentId ? "bg-foreground/5" : ""
                }`}
                onClick={() => setSelectedId(member.id)}
                type="button"
              >
                <span className="block truncate">
                  {coworkerDisplayName(member, productName)}
                </span>
                <span className="block text-[12px] text-muted-foreground">
                  {member.standingRole === "orchestrator"
                    ? "Orchestrator"
                    : "Specialist"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 className="text-sm font-medium tracking-tight">Jobs</h2>
        {room.data.jobs.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            No unattended jobs on this goal yet.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {room.data.jobs.map((job) => (
              <li
                className="rounded-md border border-border px-2 py-1.5 text-[12px] leading-4"
                key={job.id}
              >
                <div className="flex justify-between gap-2">
                  <span className="truncate font-medium">{job.coworkerId}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {job.outcome?.status ?? job.status}
                  </span>
                </div>
                <p className="mt-0.5 text-muted-foreground">
                  {job.outcome?.last_action ?? job.resultText ?? job.prompt}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
      {room.data.threadId && traceAgentId ? (
        <WorkTraces
          channelId={channelId}
          runtimeAgentId={traceAgentId}
          threadId={room.data.threadId}
        />
      ) : null}
      {watchAgentId ? (
        <WorkComputer
          agentId={watchAgentId}
          name={
            watchMember
              ? coworkerDisplayName(watchMember, productName)
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

function WorkTraces({
  channelId,
  runtimeAgentId,
  threadId,
}: {
  channelId: string;
  runtimeAgentId: string;
  threadId: string;
}) {
  const { agent } = useAgent({
    agentId: `channel:${channelId}`,
    runtimeAgentId,
    threadId,
    updates: [UseAgentUpdate.OnMessagesChanged],
  });
  const traces = toVisibleChatItems(agent.messages, {
    toolTraces: true,
  }).filter((item) => item.kind === "tool");

  return (
    <div>
      <h2 className="text-sm font-medium tracking-tight">Traces</h2>
      {traces.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          No tool traces on this goal yet.
        </p>
      ) : (
        <div className="mt-2">
          {traces.map((item) =>
            item.kind === "tool" ? (
              <ServerToolLine
                hint={toolHintFromArgs(item.toolCall.function.arguments)}
                key={item.id}
                name={item.toolCall.function.name}
                result={item.result}
              />
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

function WorkComputer({ agentId, name }: { agentId: string; name?: string }) {
  const activity = useSyncExternalStore(
    subscribeToActivity,
    () => activityFor(agentId),
    () => activityFor(agentId),
  );
  const browsed = useSyncExternalStore(
    subscribeToActivity,
    () => hasBrowsed(agentId),
    () => hasBrowsed(agentId),
  );
  const [chosen, setChosen] = useState<"screen" | "activity" | null>(null);
  const showing =
    chosen ?? (!browsed && activity.length > 0 ? "activity" : "screen");

  return (
    <div>
      <h2 className="text-sm font-medium tracking-tight">Computer</h2>
      <div className="mt-2 mb-3 flex gap-2">
        <Button
          onClick={() => setChosen("screen")}
          size="sm"
          variant={showing === "screen" ? "default" : "outline"}
        >
          Screen
        </Button>
        <Button
          onClick={() => setChosen("activity")}
          size="sm"
          variant={showing === "activity" ? "default" : "outline"}
        >
          Activity
          {activity.length > 0 ? (
            <span className="ml-1.5 tabular-nums opacity-70">
              {activity.length}
            </span>
          ) : null}
        </Button>
      </div>
      <div className={showing === "screen" ? undefined : "hidden"}>
        <ComputerView active computerId={agentId} />
        <span className="mt-4 flex w-full items-center justify-center text-balance px-4 text-center text-muted-foreground text-sm">
          {browsed
            ? `${name || "Agent"}'s screen`
            : `${name || "Agent"} has not opened a page in this conversation. This is whatever its computer had open last.`}
        </span>
      </div>
      <div className={showing === "activity" ? undefined : "hidden"}>
        <ActivityLog computerId={agentId} />
      </div>
    </div>
  );
}
