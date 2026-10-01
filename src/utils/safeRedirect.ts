/**
 * Normalise a user-supplied redirect / returnTo URL down to a safe in-app path.
 *
 * Returns the path (pathname + search + hash) when the input is a plain
 * absolute path (`/foo/bar?x=1#y`). Returns `/` otherwise — for
 * protocol-relative URLs (`//evil.com`), absolute URLs (`https://…`), exotic
 * schemes (`javascript:`, `data:`), anything that smuggles a host through URL
 * encoding (`%2F%2Fevil.com`), and control characters or backslashes
 * (`/\t/evil.com`, `/\evil.com`).
 *
 * The last group matters because the browser's URL parser drops TAB/LF/CR and
 * treats `\` as `/`: `/\t/evil.com` turns into `//evil.com`, another origin.
 * react-router's push() then fails in history.pushState() with a
 * SecurityError and falls back to window.location.assign() — a full
 * navigation off-site. Centralising the check gives every returnTo entry the
 * same shape.
 */

// Used only for the same-origin check when there is no browser window (tests
// run in a plain node environment); any https origin gives the same verdict
// for a path.
const FALLBACK_ORIGIN = 'https://cabinet.invalid';

function baseOrigin(): string {
  const origin = typeof window !== 'undefined' ? window.location?.origin : undefined;
  return origin && /^https?:\/\//.test(origin) ? origin : FALLBACK_ORIGIN;
}

/** C0 controls (TAB, LF, CR among them), DEL and the backslash. */
function hasUnsafeChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

function isPlainPath(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//') && !hasUnsafeChars(value);
}

export function getSafeRedirectPath(url: string | null | undefined): string {
  if (!url || !isPlainPath(url)) return '/';
  try {
    // Catch the encoded forms (//evil.com → %2F%2Fevil.com, scheme://…, %09, %5C)
    const decoded = decodeURIComponent(url);
    if (!isPlainPath(decoded) || decoded.includes('://')) return '/';
    // Final word goes to the URL parser itself: the path must stay on our origin.
    const origin = baseOrigin();
    const parsed = new URL(url, origin);
    if (parsed.origin !== origin) return '/';
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return '/';
  }
}
