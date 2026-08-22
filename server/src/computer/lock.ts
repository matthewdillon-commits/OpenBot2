/**
 * One computer per Bot, one pair of hands at a time.
 *
 * Isolation in this repo is per Bot (or shared), not per run. A parent conversation and a child
 * sub-agent of the same coworker therefore share a mouse, a page, and a workspace. Letting them
 * click at once is how one run types into a field the other just focused.
 *
 * This lock is in-process, the same caveat the wake queue already has: a second replica does not
 * share it. On one server it is enough for the parent HTTP routes and a child tool call to take
 * turns.
 */
const tails = new Map<string, Promise<void>>();

export async function withComputerLock<T>(
  botId: string,
  work: () => Promise<T>,
): Promise<T> {
  let release!: () => void;
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = tails.get(botId) ?? Promise.resolve();
  // A failed job must not poison the next one on this Bot.
  const next = previous.catch(() => undefined).then(() => done);
  tails.set(botId, next);
  try {
    await previous.catch(() => undefined);
    return await work();
  } finally {
    release();
    if (tails.get(botId) === next) tails.delete(botId);
  }
}
