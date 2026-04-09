/** Default session type labels (aligned with backend `_PREF_DEFAULTS`). */
export const DEFAULT_SESSION_TYPE_OPTIONS: readonly string[] = [
  'Practice 1',
  'Practice 2',
  'Practice 3',
  'Qualifying',
  'Race 1',
  'Race 2',
];

/**
 * Options for `<select>`: configured list from preferences, or defaults.
 * Ensures `currentValue` appears even if not in the configured list.
 */
export function mergeSessionTypeOptions(
  configured: string[] | undefined,
  currentValue?: string,
): string[] {
  const base =
    configured && configured.length > 0
      ? configured
      : [...DEFAULT_SESSION_TYPE_OPTIONS];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of base) {
    const t = String(s).trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  const cur = (currentValue ?? '').trim();
  if (cur && !seen.has(cur)) out.push(cur);
  return out.length > 0 ? out : [...DEFAULT_SESSION_TYPE_OPTIONS];
}

export function parseSessionTypeOptionsText(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}
