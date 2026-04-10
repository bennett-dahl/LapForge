/**
 * Toggle a segment index in an exclusion list.
 * Returns a new sorted array with the segment added or removed.
 */
export function toggleExcludedLap(
  current: readonly number[],
  segmentIndex: number,
): number[] {
  const s = new Set(current);
  if (s.has(segmentIndex)) s.delete(segmentIndex);
  else s.add(segmentIndex);
  return [...s].sort((a, b) => a - b);
}
