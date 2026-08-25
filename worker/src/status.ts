/**
 * What this process is doing, for tests and the boot line.
 *
 * Idle was the honest answer when the worker only logged. Phase 1 claims jobs from Postgres,
 * so the process is polling even when the queue is empty.
 */
export function workerStatus() {
  return { status: "polling" } as const;
}
