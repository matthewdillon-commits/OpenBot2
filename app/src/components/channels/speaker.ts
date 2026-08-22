/**
 * Who answers the next user turn in a channel.
 *
 * One speaker per message. A mention only counts when that coworker is already a member;
 * inviting a stranger is a later phase.
 */

export function resolveSpeaker(
  memberIds: readonly string[],
  mentionedId?: string | null,
  lastSpeakerId?: string | null,
): string | undefined {
  if (mentionedId && memberIds.includes(mentionedId)) {
    return mentionedId;
  }
  if (lastSpeakerId && memberIds.includes(lastSpeakerId)) {
    return lastSpeakerId;
  }
  return memberIds[0];
}
