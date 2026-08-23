/**
 * Segments for the People index views control.
 *
 * Counts come from the server, not the loaded page. Counting the page made the
 * menu disagree with the list once a workspace outgrew one page.
 */

export const ALL_SEGMENT = "all";

export type IndexSegment = {
  key: string;
  label: string;
  count: number;
};

export type StageCounts = Record<string, number>;

/**
 * "All People" first, then one segment per stage in pipeline order. A stage
 * the catalog no longer defines still gets a row while contacts sit in it.
 */
export function indexSegments(
  stages: Array<{ key: string; label: string; position?: number | null }>,
  stageCounts: StageCounts,
  totalAllStages: number,
  allLabel = "All People",
  activeKey?: string,
): IndexSegment[] {
  const ordered = [...stages].sort(
    (left, right) => (left.position ?? 0) - (right.position ?? 0),
  );
  const known = new Set(ordered.map((stage) => stage.key));

  const segments: IndexSegment[] = [
    { key: ALL_SEGMENT, label: allLabel, count: totalAllStages },
  ];

  for (const stage of ordered) {
    segments.push({
      key: stage.key,
      label: stage.label || stage.key,
      count: stageCounts[stage.key] || 0,
    });
  }

  for (const [key, count] of Object.entries(stageCounts)) {
    if (known.has(key) || !count) continue;
    segments.push({ key, label: key.replace(/_/g, " "), count });
  }

  if (
    activeKey &&
    activeKey !== ALL_SEGMENT &&
    !segments.some((segment) => segment.key === activeKey)
  ) {
    segments.push({
      key: activeKey,
      label: activeKey.replace(/_/g, " "),
      count: stageCounts[activeKey] || 0,
    });
  }

  return segments;
}

export function activeSegmentLabel(
  segments: IndexSegment[],
  stageFilter: string,
  allLabel = "All People",
): string {
  return segments.find((segment) => segment.key === stageFilter)?.label || allLabel;
}

export function activeSegmentCount(
  segments: IndexSegment[],
  stageFilter: string,
): number {
  return segments.find((segment) => segment.key === stageFilter)?.count ?? 0;
}
