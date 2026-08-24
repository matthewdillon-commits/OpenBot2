/**
 * The Bot has the turn and has not written an answer yet.
 *
 * THE GAP THIS FILLS IS THE WORST ONE IN THE CONVERSATION. Between pressing send and the first
 * token of a reply there was `aria-busy` and a Stop button, and nothing else a person could see.
 * A tool call is not a reply: the line that used to hide as soon as one appeared left a search or a
 * CRM write looking like a hang. This stays up for the whole wait, in the transcript under the
 * last message and next to Stop in the composer, so "it heard you" does not depend on noticing a
 * shimmer on a muted function name.
 *
 * The three dots carry the motion. The words stay solid: the same shimmer a running tool uses
 * paints the glyphs transparent, and "Working" that you cannot read is the original problem again.
 */
export function Working({
  name,
  compact = false,
}: {
  name?: string;
  /** Composer chrome: same words, smaller, so it fits beside Stop. */
  compact?: boolean;
}) {
  const Tag = compact ? "span" : "p";
  return (
    <Tag
      className={`flex shrink-0 items-center gap-2 text-muted-foreground ${
        compact ? "text-xs" : "text-sm"
      }`}
      data-testid={compact ? "composer-working" : "transcript-working"}
      // `status` rather than `alert`: this is progress, not something that interrupts.
      role="status"
    >
      <WorkingDots />
      {name ? `${name} is working` : "Working"}
    </Tag>
  );
}

function WorkingDots() {
  return (
    <span aria-hidden className="working-dots">
      <span />
      <span />
      <span />
    </span>
  );
}
