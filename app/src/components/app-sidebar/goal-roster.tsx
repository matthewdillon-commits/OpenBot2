import { IconSearch } from "@tabler/icons-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { Channel } from "@/components/app-sidebar/channel";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { loopStageLabel } from "@/lib/channels/loop";
import type { ChannelSummary } from "@/lib/channels/queries";
import {
  GOAL_LIST_STATUS_LABEL,
  GOAL_LIST_STATUSES,
  type GoalListStatus,
  goalEmptyCopy,
  goalEmptyKind,
} from "@/lib/channels/search";
import { EASE_OUT, ENTRANCE_SECONDS } from "@/lib/motion";

/**
 * Cap layout animation because `layout` measures every animated row on each reorder.
 */
const MAX_ANIMATED_ROWS = 60;

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

/** Locale-aware relative timestamp, e.g. "2 minutes ago". */
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

/**
 * How long a roster row takes to leave.
 *
 * Reduced motion skips the fade so the empty sentence is not held for an animation nobody asked
 * to see. The empty state still waits on `onExitComplete` when motion is on — otherwise exiting
 * rows and "no matches" share the screen.
 */
export function goalRowExitSeconds(reduceMotion: boolean | null): number {
  return reduceMotion ? 0 : ENTRANCE_SECONDS;
}

/**
 * A roster row that can animate.
 *
 * Two movements only: a channel that did not exist fades in, and a channel that was just spoken in
 * moves to the top. Nothing else animates, a roster that reacts to being read is a roster that
 * moves under the cursor.
 */
function ChannelRow({
  channel,
  animateOrder,
}: {
  channel: ChannelSummary;
  animateOrder: boolean;
}) {
  const shouldReduceMotion = useReducedMotion();
  const exitSeconds = goalRowExitSeconds(shouldReduceMotion);
  return (
    <motion.div
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      initial={{
        opacity: 0,
        transform: shouldReduceMotion ? "none" : "translateY(-8px)",
      }}
      exit={{ opacity: 0 }}
      layout={animateOrder && !shouldReduceMotion ? "position" : false}
      transition={{ duration: exitSeconds, ease: EASE_OUT }}
    >
      <Channel
        channelId={channel.id}
        participantIds={channel.agentIds}
        name={channel.name}
        lastMessage={channel.lastAction ?? channel.lastMessage ?? undefined}
        lastMessageAt={
          channel.lastActionAt
            ? relativeTime(channel.lastActionAt)
            : channel.lastMessageAt
              ? relativeTime(channel.lastMessageAt)
              : undefined
        }
        goalStatus={channel.goalStatus}
        loopStage={loopStageLabel(channel.loopStage)}
      />
    </motion.div>
  );
}

export function GoalRoster({
  search,
  onSearchChange,
  status,
  onStatusChange,
  query,
  channels,
  isPending,
  isPlaceholderData = false,
  isError = false,
  hasNextPage = false,
  isFetchingNextPage = false,
  onLoadMore,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  status: GoalListStatus;
  onStatusChange: (status: GoalListStatus) => void;
  /** The committed (debounced, trimmed) query the server was asked for. */
  query: string;
  channels: ChannelSummary[] | undefined;
  isPending: boolean;
  isPlaceholderData?: boolean;
  isError?: boolean;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
}) {
  const rows = channels ?? [];
  const [hadRows, setHadRows] = useState(false);
  const shouldReduceMotion = useReducedMotion();
  const searching = query.length > 0;

  if (rows.length > 0 && !hadRows) {
    setHadRows(true);
  }

  const exiting =
    !isPending &&
    !isPlaceholderData &&
    rows.length === 0 &&
    hadRows &&
    !shouldReduceMotion;

  const emptyKind = goalEmptyKind({
    pending: isPending,
    placeholder: isPlaceholderData,
    exiting,
    rowCount: rows.length,
    query,
    status,
  });
  const emptyCopy = goalEmptyCopy(emptyKind, search, status);

  /*
   * FILTERING DOES NOT ANIMATE. Rows exit and relayout on every keystroke otherwise, which is a
   * list thrashing under somebody who is still typing — and the moving target is the very thing
   * they are trying to read. Order animation is for a channel that was just spoken in, which is
   * occasional; this is not.
   */
  const animateOrder = !searching && rows.length <= MAX_ANIMATED_ROWS;

  return (
    <>
      <InputGroup className="bg-background text-sm rounded-lg h-9">
        <InputGroupInput
          aria-label="Search goals"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search..."
          value={search}
        />
        <InputGroupAddon>
          <IconSearch />
        </InputGroupAddon>
      </InputGroup>
      <div className="mt-1 flex flex-wrap gap-1 px-0.5">
        {GOAL_LIST_STATUSES.map((value) => (
          <button
            aria-label={`Show ${GOAL_LIST_STATUS_LABEL[value].toLowerCase()} goals`}
            aria-pressed={status === value}
            className={
              status === value
                ? "rounded-full border border-foreground bg-foreground px-2.5 py-0.5 text-xs text-background"
                : "rounded-full border border-border bg-background px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-foreground/5"
            }
            key={value}
            onClick={() => onStatusChange(value)}
            type="button"
          >
            {GOAL_LIST_STATUS_LABEL[value]}
          </button>
        ))}
      </div>
      <div className="w-full h-2" />
      {isError ? (
        <p className="px-2 py-3 text-sm text-destructive" role="alert">
          Could not load goals.
        </p>
      ) : null}
      {/*
       * TWO DIFFERENT NOTHINGS, AND SAYING THE WRONG ONE IS ALARMING. A roster nobody has
       * used yet needs telling how to start. A roster that simply does not match what is in
       * the box has to say so and quote it back — told "you don't have channels yet" while
       * holding a typo, a person reads their conversations as gone.
       *
       * The sentence waits until exiting rows have left. Showing it while those rows are
       * still fading is the same lie: the list is not empty yet.
       */}
      {emptyCopy ? (
        <p className="px-2 py-3 text-sm text-muted-foreground">{emptyCopy}</p>
      ) : null}
      <AnimatePresence
        initial={false}
        onExitComplete={() => {
          if (rows.length === 0) setHadRows(false);
        }}
      >
        {rows.map((channel) => (
          <ChannelRow
            key={channel.id}
            animateOrder={animateOrder}
            channel={channel}
          />
        ))}
      </AnimatePresence>
      {hasNextPage ? (
        <Button
          className="mt-1 w-full"
          disabled={isFetchingNextPage}
          onClick={() => onLoadMore?.()}
          size="sm"
          variant="ghost"
        >
          {isFetchingNextPage ? "Loading…" : "Show more"}
        </Button>
      ) : null}
    </>
  );
}
