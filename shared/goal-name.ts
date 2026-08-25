/**
 * A goal’s owner-facing name: one plain-language sentence from what they asked.
 *
 * Not a coworker name. Opening a goal talks to LimitlessAI; the row is the work, not the roster.
 */
export function goalNameFromPrompt(text: string, max = 120): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return "New goal";
  const match = trimmed.match(/^.*?[.!?](?:\s|$)/);
  const sentence = (match?.[0] ?? trimmed).trim();
  const codePoints = Array.from(sentence);
  if (codePoints.length <= max) return sentence;
  return `${codePoints.slice(0, Math.max(1, max - 1)).join("")}…`;
}
