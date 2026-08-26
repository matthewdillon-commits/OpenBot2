import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Composer, toAgentOptions } from "@/components/channels/composer";
import { agentListQueryOptions } from "@/lib/agents/queries";
import { channelListQueryOptions } from "@/lib/channels/queries";
import { useStartChannel } from "@/lib/channels/start";
import { appConfig } from "@/lib/generated/application-config";
import { coworkerDisplayName, pickOrchestrator } from "@/lib/orchestrator";
import { loopStageLabel } from "@/lib/channels/loop";

export const Route = createFileRoute("/_authed/_app/")({
  component: RouteComponent,
});

const RELATIVE_UNITS = [
  { limit: 60_000, divisor: 1_000, unit: "second" },
  { limit: 3_600_000, divisor: 60_000, unit: "minute" },
  { limit: 86_400_000, divisor: 3_600_000, unit: "hour" },
  { limit: 604_800_000, divisor: 86_400_000, unit: "day" },
  { limit: Number.POSITIVE_INFINITY, divisor: 604_800_000, unit: "week" },
] as const;

const relativeFormat = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

function relativeTime(iso: string) {
  const elapsed = Date.now() - new Date(iso).getTime();
  const scale =
    RELATIVE_UNITS.find(({ limit }) => Math.abs(elapsed) < limit) ??
    RELATIVE_UNITS[RELATIVE_UNITS.length - 1];
  return relativeFormat.format(
    -Math.round(elapsed / scale.divisor),
    scale.unit,
  );
}

function RouteComponent() {
  const { data: agents } = useQuery(agentListQueryOptions());
  const goals = useInfiniteQuery(channelListQueryOptions());
  const { start, pending } = useStartChannel();
  const [error, setError] = useState<string | null>(null);
  const productName = appConfig.brand.productName;
  const orchestrator = pickOrchestrator(agents);
  const mentionAgents = orchestrator
    ? toAgentOptions([
        {
          ...orchestrator,
          name: coworkerDisplayName(orchestrator, productName),
        },
      ])
    : [];

  return (
    <div className="flex w-full min-w-0 flex-1 flex-col items-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:mt-8">
      <div className="flex flex-col items-center">
        <h1 className="text-sm uppercase text-muted-foreground font-medium tracking-tight text-center">
          {productName}
        </h1>
      </div>
      <div className="mt-8 w-full flex flex-col items-center">
        <Composer
          agents={mentionAgents}
          className="w-full max-w-2xl"
          disabled={!orchestrator}
          placeholder="What should the business get done?"
          onSubmit={async (draft) => {
            const agentId = orchestrator?.id;
            if (!agentId) return;

            setError(null);
            try {
              await start([agentId], draft.text);
            } catch (caught) {
              setError(
                caught instanceof Error
                  ? caught.message
                  : "Could not start the conversation.",
              );
              throw caught;
            }
          }}
          pending={pending}
        />
        {orchestrator ? (
          <p className="mt-2 w-full max-w-2xl text-xs text-muted-foreground text-center">
            Goes to {productName}.
          </p>
        ) : null}
        {error ? (
          <p
            className="mt-2 w-full max-w-2xl text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>
      <div className="mt-10 w-full max-w-2xl">
        <h2 className="font-bold text-lg tracking-tight text-balance">Goals</h2>
        {goals.isPending ? null : goals.error ? (
          <p className="mt-3 text-destructive text-sm" role="alert">
            Could not load goals.
          </p>
        ) : goals.data?.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            What should the business get done?
          </p>
        ) : (
          <>
            <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
              {goals.data?.map((goal) => (
                <li key={goal.id}>
                  <Link
                    className="flex flex-col gap-0.5 px-3 py-2.5 outline-none hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50"
                    params={{ channelId: goal.id }}
                    to="/channel/$channelId"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm tracking-tight">
                        {goal.name}
                      </span>
                      <span className="shrink-0 text-[12px] text-muted-foreground/70 tabular-nums">
                        {goal.lastActionAt
                          ? relativeTime(goal.lastActionAt)
                          : goal.lastMessageAt
                            ? relativeTime(goal.lastMessageAt)
                            : relativeTime(goal.createdAt)}
                      </span>
                    </div>
                    <div className="flex h-4 items-center gap-1.5 text-[12px] leading-4 text-muted-foreground">
                      <span className="shrink-0">{goal.goalStatus}</span>
                      {loopStageLabel(goal.loopStage) ? (
                        <span className="shrink-0 text-muted-foreground/70">
                          {loopStageLabel(goal.loopStage)}
                        </span>
                      ) : null}
                      <span className="min-w-0 truncate">
                        {goal.lastAction ?? goal.lastMessage}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            {goals.hasNextPage ? (
              <button
                className="mt-2 w-full rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-foreground/5"
                disabled={goals.isFetchingNextPage}
                onClick={() => void goals.fetchNextPage()}
                type="button"
              >
                {goals.isFetchingNextPage ? "Loading…" : "Show more"}
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
