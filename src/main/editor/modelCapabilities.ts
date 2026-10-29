import type {
  AgentCapabilityStatus,
  AgentModelCapabilityCheck,
  AgentModelCapabilityReport,
  AgentModelCatalogResult,
  AgentModelInfo,
  AgentProviderId,
  AgentRouterTestResult,
  RouterConfig,
} from '../../shared/agents';
import { buildGeminiRequestBody, normalizeGeminiResponse } from './agentProviders';

const MAX_MODELS_BODY = 1_000_000;
const MAX_CHAT_BODY = 1_000_000;
const REQUEST_TIMEOUT_MS = 18_000;
const USER_AGENT = 'RuangKerja-ModelDiagnostics/1.0';

function uniqueEndpoints(config: RouterConfig): string[] {
  const provider = config.provider ?? 'legacy';
  const endpoints = provider === 'legacy'
    ? [config.endpoint, config.fallbackEndpoint]
    : [config.endpoint];
  return [...new Set(endpoints
    .filter((value): value is string => !!value)
    .map(value => value.replace(/\/+$/, '')))];
}

export function normalizeModelId(value: string): string {
  const model = value.trim();
  if (!model || model.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:/@()+-]*$/.test(model)) {
    throw new Error('ID model tidak valid. Gunakan 1–200 karakter huruf/angka dan simbol . _ : / @ ( ) + - tanpa spasi.');
  }
  return model;
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('Respons model terlalu besar.');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('Respons model melewati batas ukuran.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))));
}

async function requestJson(url: string, apiKey: string, body?: unknown, provider: AgentProviderId = 'legacy'): Promise<{ response: Response; data: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(provider === 'gemini' ? { 'x-goog-api-key': apiKey } : { Authorization: 'Bearer ' + apiKey }),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await readBoundedText(response, body === undefined ? MAX_MODELS_BODY : MAX_CHAT_BODY);
  let data: Record<string, unknown> = {};
  if (text) {
    try { data = JSON.parse(text) as Record<string, unknown>; }
    catch { throw new Error('Endpoint mengembalikan JSON yang tidak valid.'); }
  }
  return { response, data };
}

export function parseModels(data: Record<string, unknown>, provider: AgentProviderId = 'legacy'): AgentModelInfo[] {
  const raw: unknown[] = provider === 'gemini'
    ? (Array.isArray(data.models) ? data.models : []).flatMap(item => {
        if (!item || typeof item !== 'object') return [];
        const record = item as Record<string, unknown>;
        const methods = Array.isArray(record.supportedGenerationMethods) ? record.supportedGenerationMethods : null;
        if (methods && !methods.some(method => method === 'generateContent' || method === 'streamGenerateContent')) return [];
        const rawName = typeof record.name === 'string' ? record.name : '';
        const id = rawName.replace(/^models\//, '');
        if (!id) return [];
        return [{
          id,
          name: typeof record.displayName === 'string' ? record.displayName : id,
          owned_by: 'Google',
        }];
      })
    : (Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : []);
  const seen = new Set<string>();
  const result: AgentModelInfo[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== 'string') continue;
    let id: string;
    try { id = normalizeModelId(record.id); } catch { continue; }
    if (seen.has(id)) continue;
    seen.add(id);
    result.push({
      id,
      ...(typeof record.name === 'string' ? { name: record.name.slice(0, 180) } : {}),
      ...(typeof record.owned_by === 'string' ? { ownedBy: record.owned_by.slice(0, 100) } : {}),
    });
    if (result.length >= 500) break;
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

export async function listAvailableModels(config: RouterConfig): Promise<AgentModelCatalogResult> {
  if (!config.apiKey) return { ok: false, message: 'API key belum diatur.', models: [] };
  const errors: string[] = [];
  for (const endpoint of uniqueEndpoints(config)) {
    try {
      const { response, data } = await requestJson(endpoint + '/models', config.apiKey, undefined, config.provider ?? 'legacy');
      if (!response.ok) {
        errors.push(endpoint + ': HTTP ' + response.status);
        continue;
      }
      if (data.error && typeof data.error === 'object') {
        const message = (data.error as Record<string, unknown>).message;
        errors.push(endpoint + ': ' + (typeof message === 'string' ? message.slice(0, 200) : 'provider error'));
        continue;
      }
      const models = parseModels(data, config.provider ?? 'legacy');
      if (!models.length) {
        errors.push(endpoint + ': endpoint tidak mengembalikan daftar model yang dapat dibaca.');
        continue;
      }
      return {
        ok: true,
        message: 'Daftar model berhasil diambil. Ketersediaan model dapat berubah sesuai izin akun dan provider.',
        endpoint,
        retrievedAt: new Date().toISOString(),
        models,
      };
    } catch (error) {
      errors.push(endpoint + ': ' + ((error as Error).message || 'permintaan gagal').slice(0, 180));
    }
  }
  return { ok: false, message: 'Gagal memuat katalog model. ' + errors.join(' · '), models: [] };
}

interface RequestOutcome {
  ok: boolean;
  message: string;
  data?: Record<string, unknown>;
  durationMs: number;
  httpStatus?: number;
}
async function testRequest(
  endpoint: string,
  config: RouterConfig,
  body: Record<string, unknown>,
): Promise<RequestOutcome> {
  const started = Date.now();
  const provider = config.provider ?? 'legacy';
  try {
    let requestUrl = endpoint + '/chat/completions';
    let requestBody: unknown = body;
    if (provider === 'gemini') {
      const model = normalizeModelId(String(body.model ?? config.models[0] ?? 'gemini-3.8-flash'));
      requestUrl = endpoint.replace(/\/+$/, '') + '/models/' + encodeURIComponent(model.replace(/^models\//, '')) + ':generateContent';
      const rawChoice = body.tool_choice;
      const toolChoice = rawChoice === 'required' || (rawChoice && typeof rawChoice === 'object')
        ? 'required'
        : 'auto';
      requestBody = buildGeminiRequestBody({
        model,
        messages: Array.isArray(body.messages) ? body.messages as Array<Record<string, unknown>> : [],
        tools: body.tools,
        toolChoice,
        temperature: typeof body.temperature === 'number' ? body.temperature : 0,
        maxOutputTokens: typeof body.max_tokens === 'number' ? body.max_tokens : 64,
      });
    }
    const { response, data } = await requestJson(requestUrl, config.apiKey, requestBody, provider);
    const durationMs = Date.now() - started;
    if (!response.ok) {
      const detail = data.error && typeof data.error === 'object'
        ? String((data.error as Record<string, unknown>).message ?? '').slice(0, 180)
        : '';
      return { ok: false, message: 'HTTP ' + response.status + (detail ? ': ' + detail : ''), data, durationMs, httpStatus: response.status };
    }
    if (data.error && typeof data.error === 'object') {
      return { ok: false, message: String((data.error as Record<string, unknown>).message ?? 'Provider error').slice(0, 180), data, durationMs, httpStatus: response.status };
    }
    const normalized = provider === 'gemini' ? normalizeGeminiResponse(data) : data;
    if (normalized.error && typeof normalized.error === 'object') {
      return { ok: false, message: String((normalized.error as Record<string, unknown>).message ?? 'Provider error').slice(0, 180), data: normalized, durationMs, httpStatus: response.status };
    }
    return { ok: true, message: 'Provider menerima permintaan.', data: normalized, durationMs, httpStatus: response.status };
  } catch (error) {
    return { ok: false, message: ((error as Error).message || 'Permintaan gagal').slice(0, 180), durationMs: Date.now() - started };
  }
}

function capabilityStatus(ok: boolean, message: string): AgentCapabilityStatus {
  if (ok) return 'supported';
  if (/\bHTTP (400|404|405|415|422)\b|not support|unsupported|does not support|unknown model|invalid model|no endpoints found/i.test(message)) return 'unsupported';
  return 'unknown';
}

function completionHasText(data: Record<string, unknown> | undefined): boolean {
  const choices = data?.choices;
  if (!Array.isArray(choices) || !choices.length || !choices[0] || typeof choices[0] !== 'object') return false;
  const message = (choices[0] as Record<string, unknown>).message;
  if (!message || typeof message !== 'object') return false;
  const content = (message as Record<string, unknown>).content;
  return (typeof content === 'string' && content.trim().length > 0) || (Array.isArray(content) && content.length > 0);
}

const PROBE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

export async function diagnoseModelCapabilities(config: RouterConfig, requestedModel: string): Promise<AgentModelCapabilityReport> {
  const model = normalizeModelId(requestedModel);
  const checkedAt = new Date().toISOString();
  if (!config.apiKey) {
    return { ok: false, model, checkedAt, checks: [], message: 'API key belum diatur.' };
  }

  let chosenEndpoint: string | undefined;
  let lastChatFailure: RequestOutcome | null = null;
  for (const endpoint of uniqueEndpoints(config)) {
    const outcome = await testRequest(endpoint, config, {
      model,
      messages: [{ role: 'user', content: 'Reply with exactly OK.' }],
      stream: false,
      max_tokens: 8,
      temperature: 0,
    });
    if (outcome.ok && completionHasText(outcome.data)) {
      chosenEndpoint = endpoint;
      lastChatFailure = null;
      break;
    }
    lastChatFailure = { ...outcome, ok: false, message: outcome.ok ? 'Endpoint menerima request tetapi format respons tidak dikenali.' : outcome.message };
  }

  if (!chosenEndpoint) {
    const message = lastChatFailure?.message ?? 'Tidak ada endpoint yang berhasil diuji.';
    const check: AgentModelCapabilityCheck = {
      id: 'chat', label: 'Chat completion', status: capabilityStatus(false, message),
      message, durationMs: lastChatFailure?.durationMs ?? 0,
    };
    return {
      ok: false, model, checkedAt, checks: [check],
      message: 'Model belum dapat digunakan untuk chat; tes tool-calling dan vision tidak dijalankan karena tes dasar gagal.',
    };
  }

  const checks: AgentModelCapabilityCheck[] = [{
    id: 'chat', label: 'Chat completion', status: 'supported',
    message: 'Endpoint menerima request dan mengembalikan format chat completion yang valid.',
    durationMs: 0,
  }];

  const tool = await testRequest(chosenEndpoint, config, {
    model,
    messages: [{ role: 'user', content: 'Call the capability_probe tool now with ready=true. Do not answer in text.' }],
    tools: [{
      type: 'function',
      function: {
        name: 'capability_probe',
        description: 'Diagnostic only: return ready=true to confirm function tool-calling support.',
        parameters: { type: 'object', properties: { ready: { type: 'boolean' } }, required: ['ready'], additionalProperties: false },
      },
    }],
    tool_choice: { type: 'function', function: { name: 'capability_probe' } },
    stream: false,
    max_tokens: 80,
    temperature: 0,
  });
  const toolChoices = tool.data?.choices;
  const toolMessage = Array.isArray(toolChoices) && toolChoices[0] && typeof toolChoices[0] === 'object'
    ? (toolChoices[0] as Record<string, unknown>).message as Record<string, unknown> | undefined
    : undefined;
  const toolCalls = toolMessage && Array.isArray(toolMessage.tool_calls) ? toolMessage.tool_calls : [];
  const toolSupported = tool.ok && toolCalls.some((item) =>
    !!item && typeof item === 'object' && ((item as Record<string, unknown>).function as Record<string, unknown> | undefined)?.name === 'capability_probe',
  );
  checks.push({
    id: 'tool-calling', label: 'Function tool-calling',
    status: toolSupported ? 'supported' : tool.ok ? 'unknown' : capabilityStatus(false, tool.message),
    message: toolSupported
      ? 'Model benar-benar mengembalikan panggilan function diagnostic.'
      : tool.ok
        ? 'Endpoint menjawab, tetapi tidak mengembalikan panggilan function yang diminta; dukungan tool-calling belum terkonfirmasi.'
        : tool.message,
    durationMs: tool.durationMs,
  });

  const vision = await testRequest(chosenEndpoint, config, {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this tiny diagnostic image in one short phrase.' },
        { type: 'image_url', image_url: { url: PROBE_PNG } },
      ],
    }],
    stream: false,
    max_tokens: 40,
    temperature: 0,
  });
  const visionSupported = vision.ok && completionHasText(vision.data);
  checks.push({
    id: 'vision', label: 'Image input',
    status: visionSupported ? 'supported' : capabilityStatus(false, vision.message),
    message: visionSupported
      ? 'Endpoint menerima pesan multimodal dan mengembalikan respons. Ini mengonfirmasi penerimaan format gambar, bukan akurasi interpretasi visual.'
      : vision.message,
    durationMs: vision.durationMs,
  });

  return {
    ok: true,
    model,
    endpoint: chosenEndpoint,
    checkedAt,
    checks,
    message: 'Tes selesai. Status menunjukkan perilaku endpoint saat diperiksa, bukan jaminan permanen untuk semua permintaan atau penyedia fallback.',
  };
}


export async function testProviderConnection(config: RouterConfig): Promise<AgentRouterTestResult> {
  if (!config.apiKey) return { ok: false, message: 'API key provider belum disetel.' };
  const model = config.models[0] || (config.provider === 'gemini' ? 'gemini-3.8-flash' : 'openai/gpt-4o-mini');
  const endpoint = uniqueEndpoints(config)[0];
  if (!endpoint) return { ok: false, message: 'Endpoint provider belum tersedia.' };
  const outcome = await testRequest(endpoint, { ...config, models: [model] }, {
    model,
    messages: [{ role: 'user', content: 'Reply with exactly OK.' }],
    stream: false,
    max_tokens: 8,
    temperature: 0,
  });
  if (!outcome.ok || !completionHasText(outcome.data)) {
    return { ok: false, model, endpoint, message: outcome.message || 'Provider tidak mengembalikan respons chat yang valid.' };
  }
  return {
    ok: true,
    model,
    endpoint,
    message: 'Koneksi berhasil. Provider menerima permintaan dan mengembalikan jawaban.',
  };
}
