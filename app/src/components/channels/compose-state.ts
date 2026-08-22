/**
 * The rules a compose screen follows before there is a channel to hold them.
 *
 * Pure helpers so recipient-cap and sendability behavior stay testable without rendering.
 */

export type Recipient = {
  id: string;
  name: string;
};

/**
 * How many coworkers one channel may hold.
 *
 * Matches the server cap in `parseChannelInput`. A ninth pick replaces the oldest.
 */
export const MAX_RECIPIENTS = 8;

/** Add a coworker, dropping the oldest once the channel recipient cap is reached. */
export function addRecipient(
  current: readonly Recipient[],
  next: Recipient,
): Recipient[] {
  if (current.some((recipient) => recipient.id === next.id)) {
    return [...current];
  }
  return [...current, next].slice(-MAX_RECIPIENTS);
}

export function removeRecipient(
  current: readonly Recipient[],
  id: string,
): Recipient[] {
  return current.filter((recipient) => recipient.id !== id);
}

/** Whether this draft can start a channel. */
export function canSend(
  recipients: readonly Recipient[],
  text: string,
): boolean {
  return (
    recipients.length >= 1 &&
    recipients.length <= MAX_RECIPIENTS &&
    text.trim().length > 0
  );
}
