/**
 * Security helpers shared by provider configuration and request adapters.
 * API keys must never be echoed in UI diagnostics or written with a weak
 * fallback encryption backend.
 */
export function canPersistProviderKeySafely(
  platform: string,
  encryptionAvailable: boolean,
  backend?: string,
): boolean {
  if (!encryptionAvailable) return false;
  if (platform === 'linux') {
    // Electron's basic_text backend reports encryption as available while
    // using a hard-coded password. Do not persist provider credentials there.
    return !!backend && backend !== 'basic_text' && backend !== 'unknown';
  }
  return platform === 'win32' || platform === 'darwin';
}

export function redactSecretValues(input: string, secrets: readonly string[] = []): string {
  let result = String(input ?? '');
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length > 0) result = result.split(secret).join('[REDACTED]');
  }
  result = result
    .replace(/\b(?:sk-or-v1-|sk-proj-|sk-|gsk_|AIza)[A-Za-z0-9_-]{12,}\b/gi, '[REDACTED]')
    .replace(/((?:api[ _-]?key|authorization|x-goog-api-key)\s*[:=]\s*["']?)[^"'\s,;}]+/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{12,}=*/gi, 'Bearer [REDACTED]');
  return result;
}

export function providerHttpErrorMessage(status: number, detail: string, apiKey = ''): string {
  if (status === 401) return 'HTTP 401: API key tidak valid, kedaluwarsa, atau tidak memiliki akses.';
  if (status === 403) return 'HTTP 403: akses provider ditolak. Periksa izin akun, kebijakan model, dan batas penggunaan.';
  if (status === 408 || status === 504) return 'HTTP ' + status + ': provider kehabisan waktu untuk memproses permintaan. Coba lagi.';
  if (status === 429) return 'HTTP 429: batas penggunaan atau kuota provider tercapai. Periksa limit akun lalu coba lagi nanti.';
  if (status >= 500) return 'HTTP ' + status + ': provider mengalami gangguan sementara. Coba lagi nanti.';
  const safeDetail = redactSecretValues(detail, [apiKey]).replace(/\s+/g, ' ').trim().slice(0, 220);
  return 'HTTP ' + status + (safeDetail ? ': ' + safeDetail : '');
}
