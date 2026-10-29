/**
 * URL policy for the embedded project browser.
 * HTTP is allowed for local development servers and LAN previews; all other
 * schemes (including file:, data:, and javascript:) and embedded credentials
 * are rejected before navigation or opening an external browser.
 */
export function normalizeWebNavigationUrl(input: string): string | null {
  const value = input.trim();
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}
