/**
 * What the goal shows while a send-and-go job is in flight, and after it ends.
 *
 * Queued / running is the away sentence. Failed / cancelled must replace it
 * with the job error — a stuck “continue after you leave” with no reply is
 * how a THREAD_LOCK_FAILED 409 looked on the live goal.
 */

export type AwayJobNotice = {
  text: string;
  tone: "status" | "alert";
};

export type AwayJobSnapshot = {
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  error?: string | null;
};

export const AWAY_IN_FLIGHT = "This coworker will continue after you leave.";
export const AWAY_FAILED = "The coworker could not finish after you left.";

export function noticeForAwayJob(job: AwayJobSnapshot): AwayJobNotice | null {
  if (job.status === "queued" || job.status === "running") {
    return { text: AWAY_IN_FLIGHT, tone: "status" };
  }
  if (job.status === "failed" || job.status === "cancelled") {
    const error = job.error?.trim();
    return { text: error || AWAY_FAILED, tone: "alert" };
  }
  return null;
}
