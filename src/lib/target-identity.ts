/**
 * Preferred target identity for compare/baseline (Phase 5b).
 *
 * Priority:
 * 1. `target_identifier` when set (normalized for matching)
 * 2. Else analyzed hostname from environment (trim + lowercase in match key)
 * 3. Else no stable key — callers fall back to same-artifact baseline where appropriate
 */

export interface PreferredTargetParams {
  target_identifier: string | null;
  /** Analyzed hostname (or null); `preferredTargetMatchKey` lowercases for matching */
  environment_hostname: string | null;
}

/** Normalize for equality: trim + lowercase. */
export function normalizeTargetIdentifier(
  raw: string | null | undefined
): string | null {
  const t = raw?.trim();
  if (!t) return null;
  return t.toLowerCase();
}

/**
 * Stable key for "same target" comparisons. Uses `id:` / `host:` prefixes so a
 * target id never collides with a hostname string.
 */
export function preferredTargetMatchKey(params: PreferredTargetParams): string | null {
  const tid = normalizeTargetIdentifier(params.target_identifier);
  if (tid !== null) return `id:${tid}`;
  const host = params.environment_hostname?.trim();
  if (host) return `host:${host.toLowerCase()}`;
  return null;
}

/** Operator-visible label: explicit id when present, else hostname. */
export function preferredTargetDisplayLabel(params: PreferredTargetParams): string | null {
  const raw = params.target_identifier?.trim();
  if (raw) return raw;
  return params.environment_hostname;
}

/**
 * Whether two runs should show a "different targets" warning on compare.
 * Unknown vs unknown → no warning; known vs unknown or known vs different → warn.
 */
export function compareTargetsMismatch(
  a: PreferredTargetParams,
  b: PreferredTargetParams
): boolean {
  const ka = preferredTargetMatchKey(a);
  const kb = preferredTargetMatchKey(b);
  if (ka === null && kb === null) return false;
  if (ka === null || kb === null) return true;
  return ka !== kb;
}
