import { createHash, randomBytes } from 'node:crypto';
import type { OpenRouterAccountStatus, OpenRouterAuthMethod, OpenRouterCreditsStatus, UsdIdrRateStatus } from '../../shared/agents';
import { redactSecretValues } from './providerSecurity';

export interface OpenRouterPkcePair {
  verifier: string;
  challenge: string;
}

/** PKCE verifier/challenge for a public desktop client. No client secret is shipped. */
export function createOpenRouterPkcePair(): OpenRouterPkcePair {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
  return { verifier, challenge };
}

export function buildOpenRouterAuthorizationUrl(
  callbackUrl: string,
  challenge: string,
  state: string,
  keyLabel = 'Ruang Kerja Desktop',
): string {
  const callback = new URL(callbackUrl);
  if (callback.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(callback.hostname)) {
    throw new Error('Callback OpenRouter harus menggunakan alamat loopback lokal.');
  }
  const url = new URL('https://openrouter.ai/auth');
  url.searchParams.set('callback_url', callback.toString());
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('key_label', keyLabel.slice(0, 100));
  return url.toString();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nullableNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 180) : null;
}

export function normalizeOpenRouterKeyStatus(
  payload: unknown,
  options: {
    userId?: string | null;
    authMethod?: OpenRouterAuthMethod | null;
    keyHash?: string | null;
    fetchedAt?: string;
  } = {},
): OpenRouterAccountStatus {
  const root = record(payload);
  const data = record(root.data);
  const userId = nullableString(options.userId) ?? nullableString(data.creator_user_id);
  const hash = nullableString(options.keyHash);
  const effectiveBudget = record(data.effective_budget);
  const hasEffectiveBudget = Object.keys(effectiveBudget).length > 0;

  return {
    connected: true,
    authMethod: options.authMethod ?? null,
    userId,
    keyName: nullableString(data.name),
    keyLabel: nullableString(data.label),
    isFreeTier: typeof data.is_free_tier === 'boolean' ? data.is_free_tier : null,
    isManagementKey: typeof data.is_management_key === 'boolean' ? data.is_management_key : null,
    limit: nullableNumber(data.limit),
    limitRemaining: nullableNumber(data.limit_remaining),
    usage: nullableNumber(data.usage),
    usageDaily: nullableNumber(data.usage_daily),
    usageWeekly: nullableNumber(data.usage_weekly),
    usageMonthly: nullableNumber(data.usage_monthly),
    limitReset: nullableString(data.limit_reset),
    effectiveBudget: hasEffectiveBudget ? {
      scope: nullableString(effectiveBudget.scope),
      limitUsd: nullableNumber(effectiveBudget.limit_usd),
      spendUsd: nullableNumber(effectiveBudget.spend_usd),
      remainingUsd: nullableNumber(effectiveBudget.remaining_usd),
      resetInterval: nullableString(effectiveBudget.reset_interval),
      resetsAt: nullableString(effectiveBudget.resets_at),
    } : null,
    keySettingsUrl: hash ? 'https://openrouter.ai/keys/' + hash : null,
    activityUrl: hash ? 'https://openrouter.ai/logs?api_key_hash=' + hash : null,
    fetchedAt: options.fetchedAt ?? new Date().toISOString(),
  };
}

/** Normalize account-wide credits. Source amounts stay in USD. */
export function normalizeOpenRouterCredits(payload: unknown, fetchedAt = new Date().toISOString()): OpenRouterCreditsStatus {
  const root = record(payload);
  const data = record(root.data);
  const totalCreditsUsd = nullableNumber(data.total_credits);
  const totalUsageUsd = nullableNumber(data.total_usage);
  return {
    configured: true,
    totalCreditsUsd,
    totalUsageUsd,
    balanceUsd: totalCreditsUsd !== null && totalUsageUsd !== null
      ? Math.max(0, totalCreditsUsd - totalUsageUsd)
      : null,
    fetchedAt,
  };
}

/** Parse Frankfurter's daily USD/IDR reference rate without inventing a fallback. */
export function normalizeUsdIdrRate(payload: unknown, fetchedAt = new Date().toISOString()): UsdIdrRateStatus {
  const data = record(payload);
  const rate = nullableNumber(data.rate);
  const base = nullableString(data.base);
  const quote = nullableString(data.quote);
  const date = nullableString(data.date);
  if (base !== 'USD' || quote !== 'IDR' || rate === null || rate <= 0 || !date) {
    return { base: 'USD', quote: 'IDR', rate: null, date: null, fetchedAt: null, source: 'Frankfurter',
      error: 'Respons kurs USD/IDR tidak valid. Tidak ada konversi yang dibuat.' };
  }
  return { base: 'USD', quote: 'IDR', rate, date, fetchedAt, source: 'Frankfurter' };
}

/** Explain OpenRouter credit/budget/rate-limit failures without guessing their cause. */
export function openRouterHttpErrorMessage(
  status: number,
  bodyText: string,
  headers?: { get(name: string): string | null },
  apiKey = '',
): string {
  let payload: Record<string, unknown> = {};
  try { payload = record(bodyText ? JSON.parse(bodyText) : {}); } catch { /* keep bounded plain-text detail */ }
  const error = record(payload.error);
  const metadata = record(error.metadata);
  const limitSource = nullableString(metadata.limit_source);
  const detail = redactSecretValues(nullableString(error.message) ?? bodyText, [apiKey]).replace(/\s+/g, ' ').trim().slice(0, 160);

  if (status === 402) {
    if (limitSource === 'openrouter_key_limit') {
      return 'OpenRouter HTTP 402: batas kredit untuk API key ini sudah habis. Periksa limit dan sisa kredit pada panel akun/key.';
    }
    if (limitSource === 'openrouter_credits') {
      return 'OpenRouter HTTP 402: saldo akun tidak cukup atau permintaan terlalu besar untuk anggaran yang tersedia. Periksa saldo dan kurangi ukuran prompt/max_tokens.';
    }
    if (limitSource === 'openrouter_in_flight_budget') {
      const retryAfter = headers?.get('retry-after');
      return 'OpenRouter HTTP 402: anggaran untuk request yang sedang berjalan penuh. Tunggu' +
        (retryAfter ? ' Retry-After ' + retryAfter + ' detik' : ' hingga request sebelumnya selesai') +
        ', lalu coba lagi dengan prompt atau max_tokens lebih kecil.';
    }
    return 'OpenRouter HTTP 402: permintaan ditolak oleh batas kredit atau budget akun/key.' + (detail ? ' Detail: ' + detail : '');
  }

  if (status === 429) {
    const retryAfter = headers?.get('retry-after');
    const remaining = headers?.get('x-ratelimit-remaining');
    const limit = headers?.get('x-ratelimit-limit');
    const reset = headers?.get('x-ratelimit-reset');
    const hints = [
      retryAfter ? 'Retry-After: ' + retryAfter : '',
      remaining ? 'sisa rate-limit header: ' + remaining : '',
      limit ? 'limit header: ' + limit : '',
      reset ? 'reset header: ' + reset : '',
    ].filter(Boolean);
    return 'OpenRouter HTTP 429: rate limit model, kuota free-tier, atau kapasitas provider tercapai. Ini tidak otomatis berarti akun atau API key salah; periksa status akun dan header limit. Membuat akun atau API key tambahan tidak menaikkan kapasitas global untuk kapasitas provider yang sama. Coba model lain atau tunggu' +
      (retryAfter ? ' ' + retryAfter + ' detik sesuai Retry-After' : ' beberapa saat') +
      (hints.length ? '. ' + hints.join(' · ') : '') + '.';
  }

  if (status === 401) return 'OpenRouter HTTP 401: API key tidak valid, kedaluwarsa, atau sudah dicabut. Login ulang atau hubungkan API key lain.';
  if (status === 403) return 'OpenRouter HTTP 403: akun, workspace, key, atau kebijakan model menolak permintaan.' + (detail ? ' Detail: ' + detail : '');
  if (status >= 500) return 'OpenRouter HTTP ' + status + ': layanan mengalami gangguan sementara. Coba lagi nanti.';
  return 'OpenRouter HTTP ' + status + (detail ? ': ' + detail : '');
}
