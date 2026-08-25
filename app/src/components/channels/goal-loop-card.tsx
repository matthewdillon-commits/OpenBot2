import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { loopStageLabel } from "@/lib/channels/loop";
import {
  recordGoalDecisionMutationOptions,
  recordGoalOutcomeMutationOptions,
} from "@/lib/channels/mutations";
import type {
  AgentChannel,
  LoopDecision,
  LoopOutcome,
} from "@/lib/channels/queries";
import { queryClient } from "@/query-client";

const OUTCOMES: { value: LoopOutcome; label: string }[] = [
  { value: "worked", label: "Worked" },
  { value: "didn't", label: "Didn't" },
  { value: "unknown", label: "Unknown" },
];

const DECISIONS: { value: LoopDecision; label: string }[] = [
  { value: "keep", label: "Keep" },
  { value: "revise", label: "Revise" },
  { value: "revert", label: "Revert" },
];

/**
 * Approval card and outcome on this goal's thread. Not a nav item, not See the work.
 */
export function GoalLoopCard({ channel }: { channel: AgentChannel }) {
  const waiting = channel.approval?.status === "waiting";
  const hasLoop =
    waiting ||
    Boolean(channel.expectedImpact) ||
    Boolean(channel.outcome) ||
    Boolean(channel.lastDecision);
  if (!hasLoop) return null;

  return (
    <section
      aria-label="Goal loop"
      className="border-b border-border px-3 py-3"
    >
      {waiting && channel.approval ? (
        <ApprovalCard channelId={channel.id} card={channel.approval} />
      ) : (
        <MeasuredLoop channel={channel} />
      )}
    </section>
  );
}

function ApprovalCard({
  channelId,
  card,
}: {
  channelId: string;
  card: NonNullable<AgentChannel["approval"]>;
}) {
  const [note, setNote] = useState("");
  const decide = useMutation(recordGoalDecisionMutationOptions(queryClient));
  const error = decide.error instanceof Error ? decide.error.message : null;

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
        Needs you
      </p>
      <p className="mt-1 text-sm tracking-tight">{card.rationale}</p>
      <dl className="mt-2 grid gap-1.5 text-[12px] leading-4 text-muted-foreground">
        <div>
          <dt className="font-medium text-foreground">Expected impact</dt>
          <dd>{card.expectedImpact}</dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">Before</dt>
          <dd>{card.before}</dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">After</dt>
          <dd>{card.after}</dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">Rollback</dt>
          <dd>{card.rollback}</dd>
        </div>
      </dl>
      <Textarea
        className="mt-3 min-h-12 text-sm"
        disabled={decide.isPending}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Optional note for the next proposal"
        value={note}
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {DECISIONS.map((item) => (
          <Button
            disabled={decide.isPending}
            key={item.value}
            onClick={() =>
              decide.mutate({
                channelId,
                decision: item.value,
                ...(note.trim() ? { note: note.trim() } : {}),
              })
            }
            size="sm"
            variant={item.value === "keep" ? "default" : "outline"}
          >
            {item.label}
          </Button>
        ))}
      </div>
      {error ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function MeasuredLoop({ channel }: { channel: AgentChannel }) {
  const record = useMutation(recordGoalOutcomeMutationOptions(queryClient));
  const stage = loopStageLabel(channel.loopStage);
  const error = record.error instanceof Error ? record.error.message : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-4 text-muted-foreground">
        {stage ? <span>{stage}</span> : null}
        {channel.expectedImpact ? (
          <span className="min-w-0 truncate">
            Expected impact: {channel.expectedImpact}
          </span>
        ) : null}
        {channel.lastDecision ? (
          <span>
            Last decision: {channel.lastDecision.decision}
            {channel.lastDecision.note ? ` — ${channel.lastDecision.note}` : ""}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[12px] text-muted-foreground">Outcome</span>
        {OUTCOMES.map((item) => (
          <Button
            aria-pressed={channel.outcome === item.value}
            disabled={record.isPending}
            key={item.value}
            onClick={() =>
              record.mutate({ channelId: channel.id, outcome: item.value })
            }
            size="sm"
            variant={channel.outcome === item.value ? "default" : "outline"}
          >
            {item.label}
          </Button>
        ))}
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
