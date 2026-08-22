/**
 * Cheap in-process IMAP poller for inbound email triggers.
 *
 * Durable state is the inbox cursor in Postgres, not this timer. A restart
 * still sees the last UID and does not re-fire old mail. Firing goes through
 * the schedule gateway (`trusted: true`); this is not a second job system.
 *
 * One replica is the supported shape, same as cron. Two copies would both
 * list; the cursor write is last-wins, so a message can fire twice under
 * that unsupported shape. Documented in docs/deployment.md.
 */
import { pollInboundEmail, type InboundEmailPoller } from "./inbound";

export type InboxPoller = { stop: () => void };

export function startInboxPoller(
  options: InboundEmailPoller,
  timing: { intervalMs?: number; firstRunMs?: number } = {},
): InboxPoller {
  const intervalMs = timing.intervalMs ?? 30_000;
  const firstRunMs = timing.firstRunMs ?? 5_000;
  const timers: ReturnType<typeof setInterval>[] = [];

  const tick = () => {
    void pollInboundEmail(options)
      .then((result) => {
        if (result.fired === 0 && !result.seeded) return;
        console.info(
          JSON.stringify({
            type: "email-inbound-polled",
            fired: result.fired,
            examined: result.examined,
            seeded: result.seeded,
          }),
        );
      })
      .catch((error) => {
        console.error(
          JSON.stringify({
            type: "email-inbound-poll-failed",
            note: "The inbox cursor was left as it was; the next tick will try again.",
            error: String(error),
          }),
        );
      });
  };

  const first = setTimeout(() => {
    tick();
    const repeating = setInterval(tick, intervalMs);
    repeating.unref?.();
    timers.push(repeating);
  }, firstRunMs);
  first.unref?.();

  return {
    stop: () => {
      clearTimeout(first);
      for (const timer of timers) clearInterval(timer);
    },
  };
}
