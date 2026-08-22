/**
 * Whether a Bot's message is an empty acknowledgement rather than something to deliver.
 *
 * Two Bots that only say "got it" will bounce forever if each wake treats the ack as a reason to
 * speak. The product is async texting, not a handshake: a send that adds nothing is not a send.
 * The tool descriptions say this; this module is the half that does not depend on the model
 * cooperating.
 */

const ACK_PATTERN =
  /^(ok|okay|k|kk|yes|yep|yeah|sure|thanks|thank you|thx|ty|got it|gotcha|roger|copy|acknowledged|ack|noted|will do|sounds good|perfect|great|cool|👍|✅|👌)[.!\s]*$/i;

/** How far a Bot-only chain may run. The originating send is 1; the recipient's wake reply is 2. */
export const MAX_MESSAGE_HOP = 2;

export function isEmptyOrAck(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  return ACK_PATTERN.test(trimmed);
}
