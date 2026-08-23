/**
 * The app's motion vocabulary, in one place.
 *
 * These values were written out by hand in `detail-panel.tsx` and again in `app-sidebar.tsx`, and
 * the transcript would have been a third copy. Motion that is meant to read as one hand cannot be
 * three sets of magic numbers that happen to agree today.
 */

/** Strong ease-out. The browser's built-in curve is too weak to read as deliberate. */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;

/**
 * How long something takes to arrive.
 *
 * Entrances are the one place a curve is watched closely, and anything past ~250ms starts reading
 * as the interface thinking rather than responding.
 */
export const ENTRANCE_SECONDS = 0.2;

/**
 * Height and shared-layout changes. Zero bounce so the thing arrives and stays;
 * 300ms so it is felt without becoming a wait.
 */
export const SPRING_NO_BOUNCE = {
  type: "spring",
  bounce: 0,
  duration: 0.3,
} as const;
