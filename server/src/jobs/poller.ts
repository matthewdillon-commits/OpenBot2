/**
 * Cheap in-process poller for due scheduled jobs.
 *
 * The product is one replica (see docs/deployment.md). This lives on the API
 * server rather than a new always-on worker container. Durable state is in
 * Postgres: a restart still sees jobs whose `next_run_at` is in the past, and
 * re-enqueues queued/running runs that were in flight when the process died.
 *
 * The same cross-replica limit as message wakes: a second server will not run
 * a dispatch this one accepted. `FOR UPDATE SKIP LOCKED` means two replicas
 * will not claim the same occurrence, but the wake itself stays in-process.
 */
import type { ScheduleGateway } from "./gateway";

export type SchedulePoller = { stop: () => void };

export function startSchedulePoller(
  gateway: ScheduleGateway,
  options: { intervalMs?: number; firstRunMs?: number } = {},
): SchedulePoller {
  const intervalMs = options.intervalMs ?? 15_000;
  const firstRunMs = options.firstRunMs ?? 3_000;
  const timers: ReturnType<typeof setInterval>[] = [];

  const tick = () => {
    void gateway
      .dispatchDue()
      .then((count) => {
        if (count === 0) return;
        console.info(
          JSON.stringify({
            type: "schedule-polled",
            claimed: count,
          }),
        );
      })
      .catch((error) => {
        console.error(
          JSON.stringify({
            type: "schedule-poll-failed",
            note: "Due jobs were left in Postgres and will be claimed on the next tick.",
            error: String(error),
          }),
        );
      });
  };

  const recover = () => {
    void gateway
      .recoverUnfinished()
      .then((count) => {
        if (count === 0) return;
        console.info(
          JSON.stringify({
            type: "schedule-recovered",
            runs: count,
            note: "Queued or running jobs from before this process started were re-enqueued.",
          }),
        );
      })
      .catch((error) => {
        console.error(
          JSON.stringify({
            type: "schedule-recover-failed",
            note: "Unfinished runs are still in Postgres; the next boot will try again.",
            error: String(error),
          }),
        );
      });
  };

  const first = setTimeout(() => {
    recover();
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
