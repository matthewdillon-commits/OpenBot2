import type { ComposerDraft } from "./draft";

/**
 * What happens to a message typed while the Bot already has the turn.
 *
 * The composer used to refuse it. Enter did nothing, the words stayed in the box, and a person
 * watching their coworker head off in the wrong direction had two options: stop the turn and start
 * again, losing whatever it had already done, or wait for it to finish being wrong. Neither is the
 * thing they wanted, which was to say "no, the other one" while it was working and have that land.
 *
 * So a message typed mid-turn is parked rather than dropped, and everything parked for the SAME
 * speaker runs as ONE follow-up turn when the current one settles. One turn and not one per
 * message, because three quick corrections are usually one correction typed in three breaths:
 * replaying them separately makes the Bot answer the first, act on it, and only then read the
 * sentence saying not to.
 *
 * Two parked drafts that name different speakers stay two turns. Joining them would send one
 * message to nobody in particular, and a room has one speaker per user message.
 *
 * Settling is not the same as succeeding. The drain is keyed on the turn ENDING and never asks how
 * it ended, which is what makes Stop a way of steering rather than a way of giving up: park a
 * correction, press Stop, and the correction is what runs next. Nothing here special-cases the stop
 * button, and that is the point — a path with its own branch is a path that can be forgotten.
 *
 * THE QUEUE IS MEMORY IN ONE MOUNT AND NOTHING HERE PRETENDS OTHERWISE. The turn is driven from the
 * browser, so the browser is the only place that knows one is in flight, and this state lives and
 * dies with the component holding it. A reload loses the intent to run these words later, and so
 * does walking to another channel: the channel view is keyed on the channel, so switching unmounts
 * the conversation and takes anything parked in it with it, after the person has watched their
 * words land on screen. Neither is worth a persistence layer for words that only mean anything
 * inside a turn that is already over by the time you come back, but both are worth saying out loud.
 * The words are the person's own and sit on screen for as long as they wait, so nothing is being
 * kept from anybody; but a queue is not an outbox and must not be read as one. It is drawn only
 * while a turn is in flight, so a reload finds no queue and shows none, which is better than a list
 * of messages quietly promising to run and never running.
 */

/** One message waiting for the Bot to finish, in the words the person typed. */
export type QueuedMessage = {
  /**
   * Minted by the caller, because taking one back needs a handle that survives the list changing
   * around it and the text will not do: two identical corrections are two entries.
   */
  id: string;
  text: string;
  /**
   * The `/` chips that were in it, so a skill invoked mid-turn still applies when the message
   * eventually runs rather than being silently dropped on the way through the queue.
   */
  commandIds: string[];
  /**
   * Who this parked draft is for. `null` means "whoever is already speaking".
   *
   * Held on the entry so two corrections that name different coworkers are not joined into one
   * turn addressed to nobody.
   */
  agentId: string | null;
};

export type QueueAction =
  /**
   * Somebody pressed send.
   *
   * `busy` is supplied rather than worked out here. The composer is the only thing holding both
   * halves of that answer — the parent's `pending` and its own send that has not resolved — and a
   * second opinion computed somewhere else would disagree with it exactly during the moment between
   * a send starting and the agent reporting itself as running, which is precisely when somebody
   * typing fast needs the answer to be right.
   */
  | { type: "submit"; id: string; draft: ComposerDraft; busy: boolean }
  /** The turn is over, however it ended: finished, failed, or stopped. */
  | { type: "settle" }
  /** Second thoughts, before it has run. */
  | { type: "remove"; id: string };

export type QueueTransition = {
  /** The queue afterwards. The same array when nothing moved, so a render can be skipped. */
  queue: readonly QueuedMessage[];
  /** A turn to start now, or null when there is nothing to run. */
  run: ComposerDraft | null;
};

/**
 * The whole rule, as one pure function, so the interesting cases can be checked without a browser
 * and a live model between the test and the behaviour.
 */
export function reduceQueue(
  queue: readonly QueuedMessage[],
  action: QueueAction,
): QueueTransition {
  switch (action.type) {
    case "submit": {
      /*
       * An idle send is not a queue of one. There is nothing to wait behind, so it goes straight
       * out exactly as it did before any of this existed.
       *
       * WITH SOMETHING ALREADY WAITING IT TAKES THE SAME-SPEAKER PREFIX WITH IT rather than going
       * first. The two disagreeing is not supposed to be reachable — the drain empties the queue on
       * the same edge that frees the composer — but "not supposed to be reachable" is an argument
       * about two components' timing, and this file is meant to hold the rule on its own. Jumping
       * the line would run a correction after the sentence correcting it, which is the exact
       * reordering the whole queue exists to prevent, so the safe reading of an impossible state is
       * the one that keeps what the person typed in the order they typed it.
       *
       * Drafts that name a different speaker stay queued. The drain fires again when the turn it
       * just started ends.
       */
      if (!action.busy) {
        if (queue.length === 0) {
          return { queue, run: action.draft };
        }
        return flushSameSpeaker([
          ...queue,
          queuedFrom(action.id, action.draft),
        ]);
      }
      return {
        queue: [...queue, queuedFrom(action.id, action.draft)],
        run: null,
      };
    }

    case "settle": {
      if (queue.length === 0) {
        return { queue, run: null };
      }
      return flushSameSpeaker(queue);
    }

    case "remove": {
      const kept = queue.filter((message) => message.id !== action.id);
      return {
        queue: kept.length === queue.length ? queue : kept,
        run: null,
      };
    }
  }
}

function queuedFrom(id: string, draft: ComposerDraft): QueuedMessage {
  return {
    id,
    text: draft.text,
    commandIds: [...draft.commandIds],
    agentId: draft.agentId,
  };
}

/**
 * The leading run of parked drafts that agree on a speaker, as one turn, and whatever follows.
 */
function flushSameSpeaker(queue: readonly QueuedMessage[]): QueueTransition {
  const speakerId = queue[0]?.agentId;
  let end = 1;
  while (end < queue.length && queue[end]?.agentId === speakerId) {
    end += 1;
  }
  return {
    queue: queue.slice(end),
    run: joinQueued(queue.slice(0, end)),
  };
}

/**
 * Everything waiting for one speaker, as the one turn it is about to become.
 *
 * Newlines rather than spaces. What the person typed were separate messages, and running them
 * together into a paragraph invents a sentence nobody wrote; keeping the line breaks keeps them as
 * lines of a single instruction, which is how a burst of corrections reads out loud anyway.
 *
 * Never empty. The composer refuses an empty draft before it reaches the queue, so a drained turn
 * always has something in it to send.
 */
function joinQueued(queue: readonly QueuedMessage[]): ComposerDraft {
  return {
    text: queue.map((message) => message.text).join("\n"),
    agentId: queue[0]?.agentId ?? null,
    // The same skill queued twice is still one instruction. Sending it twice would put the same
    // paragraph in front of the Bot two times and say nothing new by doing it.
    commandIds: [...new Set(queue.flatMap((message) => message.commandIds))],
    isEmpty: false,
  };
}
