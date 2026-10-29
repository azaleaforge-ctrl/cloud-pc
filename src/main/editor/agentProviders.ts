import type { RouterConfig } from '../../shared/agents';
import { providerHttpErrorMessage, redactSecretValues } from './providerSecurity';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseFunctionArguments(value: unknown): unknown {
  if (typeof value !== 'string') return isRecord(value) ? value : {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) || Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

interface GeminiMediaBudget { bytes: number; }
const GEMINI_INLINE_MEDIA_MAX = 14 * 1024 * 1024;

function geminiInlineData(url: string, mediaBudget: GeminiMediaBudget, expectedType: 'image' | 'media'): JsonRecord {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(url);
  if (!match) {
    throw new Error('Media untuk Gemini harus berupa data URL base64 lokal; URL media eksternal tidak diteruskan otomatis.');
  }
  const mimeType = match[1].toLowerCase();
  const isImage = mimeType.startsWith('image/');
  const allowed = isImage || mimeType.startsWith('audio/') || mimeType.startsWith('video/') || mimeType === 'application/pdf';
  if ((expectedType === 'image' && !isImage) || (expectedType === 'media' && !allowed)) {
    throw new Error('Jenis media tidak didukung pada jalur Gemini: ' + mimeType);
  }
  const data = match[2].replace(/\s+/g, '');
  const decodedBytes = Buffer.from(data, 'base64').byteLength;
  mediaBudget.bytes += decodedBytes;
  if (mediaBudget.bytes > GEMINI_INLINE_MEDIA_MAX) {
    throw new Error('Total gambar/audio/video/PDF yang dikirim langsung ke Gemini maksimal 14 MiB per permintaan. Kurangi jumlah atau ukuran media.');
  }
  return { inlineData: { mimeType, data } };
}

function toGeminiParts(content: unknown, mediaBudget: GeminiMediaBudget): JsonRecord[] {
  if (typeof content === 'string') return content ? [{ text: content }] : [];
  if (!Array.isArray(content)) return [];

  const parts: JsonRecord[] = [];
  for (const item of content) {
    if (!isRecord(item)) continue;
    if (item.type === 'text' && typeof item.text === 'string') {
      parts.push({ text: item.text });
      continue;
    }
    if (item.type === 'image_url') {
      const descriptor = isRecord(item.image_url) ? item.image_url : null;
      const url = typeof item.image_url === 'string' ? item.image_url : asText(descriptor?.url);
      parts.push(geminiInlineData(url, mediaBudget, 'image'));
      continue;
    }
    if (item.type === 'media_url') {
      const descriptor = isRecord(item.media_url) ? item.media_url : null;
      const url = typeof item.media_url === 'string' ? item.media_url : asText(descriptor?.url);
      const declaredMime = asText(descriptor?.mimeType).toLowerCase();
      const dataUrlMime = /^data:([^;,]+);base64,/.exec(url)?.[1]?.toLowerCase() ?? '';
      if (declaredMime && dataUrlMime && declaredMime !== dataUrlMime) {
        throw new Error('MIME media tidak cocok dengan data URL. Lampiran ditolak.');
      }
      parts.push(geminiInlineData(url, mediaBudget, 'media'));
    }
  }
  return parts;
}

const GEMINI_SCHEMA_KEYS = new Set([
  'type',
  'format',
  'description',
  'nullable',
  'enum',
  'items',
  'properties',
  'required',
]);

/**
 * Gemini's legacy generateContent function calling accepts only a subset of
 * OpenAPI/JSON Schema. Strip unsupported JSON Schema keywords (notably
 * additionalProperties and min/max constraints) before forwarding tool
 * declarations, while preserving the structural schema used by the model.
 */
export function normalizeGeminiFunctionSchema(value: unknown): JsonRecord {
  if (!isRecord(value)) return { type: 'object', properties: {} };
  const normalized: JsonRecord = {};
  for (const [key, item] of Object.entries(value)) {
    if (!GEMINI_SCHEMA_KEYS.has(key)) continue;
    if (key === 'properties' && isRecord(item)) {
      const properties: JsonRecord = {};
      for (const [name, property] of Object.entries(item)) {
        properties[name] = normalizeGeminiFunctionSchema(property);
      }
      normalized.properties = properties;
    } else if (key === 'items') {
      normalized.items = normalizeGeminiFunctionSchema(item);
    } else if (key === 'required' && Array.isArray(item)) {
      normalized.required = item.filter((entry): entry is string => typeof entry === 'string');
    } else if (key === 'enum' && Array.isArray(item)) {
      normalized.enum = item.filter(entry => ['string', 'number', 'boolean'].includes(typeof entry));
    } else if (['type', 'format', 'description'].includes(key) && typeof item === 'string') {
      normalized[key] = item;
    } else if (key === 'nullable' && typeof item === 'boolean') {
      normalized.nullable = item;
    }
  }
  return normalized;
}

function safeFunctionName(value: unknown): string {
  const name = asText(value);
  if (!/^[A-Za-z0-9_]{1,64}$/.test(name)) {
    throw new Error('Nama function untuk Gemini tidak valid.');
  }
  return name;
}

export interface GeminiRequestOptions {
  model: string;
  messages: Array<Record<string, unknown>>;
  tools?: unknown;
  toolChoice?: 'auto' | 'required';
  temperature?: number;
  maxOutputTokens?: number;
}

export function buildGeminiRequestBody(options: GeminiRequestOptions): JsonRecord {
  const systemParts: JsonRecord[] = [];
  const contents: JsonRecord[] = [];
  const mediaBudget: GeminiMediaBudget = { bytes: 0 };
  for (const message of options.messages) {
    const role = asText(message.role);
    const parts = toGeminiParts(message.content, mediaBudget);
    if (role === 'system' || role === 'developer') {
      systemParts.push(...parts);
      continue;
    }

    if (role === 'tool') {
      const name = safeFunctionName(message.name);
      const functionResponse = {
        functionResponse: {
          name,
          response: { result: asText(message.content) },
          ...(typeof message.geminiFunctionCallId === 'string' && message.geminiFunctionCallId
            ? { id: message.geminiFunctionCallId }
            : {}),
        },
      };
      const previous = contents[contents.length - 1];
      const previousParts = isRecord(previous) && Array.isArray(previous.parts) ? previous.parts : [];
      const previousIsToolResponse = previous?.role === 'user'
        && previousParts.some(part => isRecord(part) && isRecord(part.functionResponse));
      if (previousIsToolResponse) {
        previousParts.push(functionResponse);
      } else {
        contents.push({ role: 'user', parts: [functionResponse] });
      }
      continue;
    }

    if (role === 'assistant') {
      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      for (const rawCall of toolCalls) {
        if (!isRecord(rawCall)) continue;
        const fn = isRecord(rawCall.function) ? rawCall.function : {};
        const functionCall: JsonRecord = {
          name: safeFunctionName(fn.name),
          args: parseFunctionArguments(fn.arguments),
        };
        if (typeof rawCall.geminiFunctionCallId === 'string' && rawCall.geminiFunctionCallId) {
          functionCall.id = rawCall.geminiFunctionCallId;
        }
        parts.push({
          functionCall,
          ...(typeof rawCall.geminiThoughtSignature === 'string' && rawCall.geminiThoughtSignature
            ? { thoughtSignature: rawCall.geminiThoughtSignature }
            : {}),
        });
      }
      if (parts.length) contents.push({ role: 'model', parts });
      continue;
    }

    if (role === 'user' && parts.length) contents.push({ role: 'user', parts });
  }

  const body: JsonRecord = {
    contents,
    generationConfig: {
      // Google recommends the default temperature of 1.0 for Gemini 3/4 reasoning models.
      temperature: /^gemini-[34](?:[.-]|$)/.test(options.model.replace(/^models\//, ''))
        ? 1.0
        : typeof options.temperature === 'number' ? options.temperature : 0.2,
      maxOutputTokens: typeof options.maxOutputTokens === 'number' ? options.maxOutputTokens : 6144,
    },
  };
  if (systemParts.length) body.systemInstruction = { parts: systemParts };

  const rawTools = Array.isArray(options.tools) ? options.tools : [];
  const declarations: JsonRecord[] = [];
  for (const rawTool of rawTools) {
    if (!isRecord(rawTool) || rawTool.type !== 'function' || !isRecord(rawTool.function)) continue;
    const fn = rawTool.function;
    const declaration: JsonRecord = {
      name: safeFunctionName(fn.name),
      parameters: normalizeGeminiFunctionSchema(fn.parameters),
    };
    if (typeof fn.description === 'string') declaration.description = fn.description.slice(0, 1000);
    declarations.push(declaration);
  }
  if (declarations.length) {
    body.tools = [{ functionDeclarations: declarations }];
    body.toolConfig = {
      functionCallingConfig: {
        mode: options.toolChoice === 'required' ? 'ANY' : 'AUTO',
      },
    };
  }
  return body;
}

export function normalizeGeminiResponse(payload: unknown): JsonRecord {
  if (!isRecord(payload)) return { error: { message: 'Respons Gemini tidak berbentuk objek JSON.' } };
  if (isRecord(payload.error)) return { error: payload.error };
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const candidate = isRecord(candidates[0]) ? candidates[0] : {};
  const responseContent = isRecord(candidate.content) ? candidate.content : {};
  const parts = Array.isArray(responseContent.parts) ? responseContent.parts : [];
  const texts: string[] = [];
  const toolCalls: JsonRecord[] = [];
  let callIndex = 0;
  for (const rawPart of parts) {
    if (!isRecord(rawPart)) continue;
    if (typeof rawPart.text === 'string') texts.push(rawPart.text);
    if (isRecord(rawPart.functionCall)) {
      const call = rawPart.functionCall;
      const name = safeFunctionName(call.name);
      toolCalls.push({
        id: asText(call.id) || 'gemini_call_' + callIndex++,
        type: 'function',
        function: { name, arguments: JSON.stringify(parseFunctionArguments(call.args)) },
        ...(asText(rawPart.thoughtSignature) ? { thought_signature: asText(rawPart.thoughtSignature) } : {}),
        ...(asText(call.id) ? { gemini_function_call_id: asText(call.id) } : {}),
      });
    }
  }
  return {
    id: asText(payload.responseId) || 'gemini-response',
    modelVersion: asText(payload.modelVersion),
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: texts.join(''),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: toolCalls.length ? 'tool_calls' : 'stop',
    }],
  };
}

function candidateToSse(candidate: unknown, toolCounter: { value: number }): string[] {
  if (!isRecord(candidate)) return [];
  const content = isRecord(candidate.content) ? candidate.content : {};
  const parts = Array.isArray(content.parts) ? content.parts : [];
  const output: string[] = [];
  const functionCalls: Array<{ call: JsonRecord; thoughtSignature?: string }> = [];
  for (const part of parts) {
    if (!isRecord(part)) continue;
    if (typeof part.text === 'string' && part.text) {
      output.push('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: part.text }, finish_reason: null }] }) + '\n\n');
    }
    if (isRecord(part.functionCall)) {
      functionCalls.push({
        call: part.functionCall,
        ...(asText(part.thoughtSignature) ? { thoughtSignature: asText(part.thoughtSignature) } : {}),
      });
    }
  }
  // Wait for the completed candidate before emitting structured function arguments.
  // Keep each part's thought signature on that exact call; Gemini 3 requires it on replay.
  if (functionCalls.length && typeof candidate.finishReason === 'string') {
    const toolCalls = functionCalls.map(({ call, thoughtSignature }) => {
      const index = toolCounter.value++;
      return {
        index,
        id: asText(call.id) || 'gemini_call_' + (index + 1),
        type: 'function',
        function: {
          name: safeFunctionName(call.name),
          arguments: JSON.stringify(parseFunctionArguments(call.args)),
        },
        ...(thoughtSignature ? { thought_signature: thoughtSignature } : {}),
        ...(asText(call.id) ? { gemini_function_call_id: asText(call.id) } : {}),
      };
    });
    output.push('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: null }] }) + '\n\n');
  }
  if (typeof candidate.finishReason === 'string') {
    output.push('data: ' + JSON.stringify({
      choices: [{ index: 0, delta: {}, finish_reason: functionCalls.length ? 'tool_calls' : 'stop' }],
    }) + '\n\n');
  }
  return output;
}

export async function openGeminiCompletionStream(
  config: RouterConfig,
  messages: Array<Record<string, unknown>>,
  tools: unknown,
  toolChoice: 'auto' | 'required',
  signal: AbortSignal,
): Promise<Response> {
  const model = config.models[0] || 'gemini-3.8-flash';
  const endpoint = (config.endpoint || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  const url = endpoint + '/models/' + encodeURIComponent(model.replace(/^models\//, '')) + ':streamGenerateContent?alt=sse';
  const requestBody = buildGeminiRequestBody({
    model,
    messages,
    tools,
    toolChoice,
    temperature: 0.2,
    maxOutputTokens: 6144,
  });
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.apiKey,
        Accept: 'text/event-stream',
        'User-Agent': 'RuangKerja-Agent/1.0',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
    });
  } catch (error) {
    throw new Error('Koneksi ke Gemini API gagal: ' + redactSecretValues((error as Error).message || 'kesalahan jaringan', [config.apiKey]));
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 500);
    throw new Error(providerHttpErrorMessage(response.status, detail, config.apiKey));
  }
  if (!response.body) throw new Error('Gemini API tidak mengembalikan stream body.');

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const source = response.body.getReader();
  const transformed = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = '';
      const toolCounter = { value: 0 };
      let doneSent = false;
      const emit = (value: string) => controller.enqueue(encoder.encode(value));
      const processEvent = (event: string) => {
        for (const line of event.split(/\r?\n/)) {
          const match = /^data:\s*(.+)$/.exec(line);
          if (!match || match[1] === '[DONE]') continue;
          let parsed: unknown;
          try { parsed = JSON.parse(match[1]); } catch { continue; }
          if (isRecord(parsed) && isRecord(parsed.error)) {
            const message = asText(parsed.error.message) || 'Gemini API mengembalikan error.';
            throw new Error(redactSecretValues(message, [config.apiKey]).slice(0, 400));
          }
          const candidates = isRecord(parsed) && Array.isArray(parsed.candidates) ? parsed.candidates : [];
          for (const candidate of candidates) for (const line of candidateToSse(candidate, toolCounter)) emit(line);
        }
      };
      try {
        for (;;) {
          const { done, value } = await source.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.search(/\r?\n\r?\n/);
          while (boundary >= 0) {
            const event = buffer.slice(0, boundary);
            const separator = /^\r?\n\r?\n/.exec(buffer.slice(boundary))?.[0] ?? '\n\n';
            buffer = buffer.slice(boundary + separator.length);
            processEvent(event);
            boundary = buffer.search(/\r?\n\r?\n/);
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) processEvent(buffer);
        emit('data: [DONE]\n\n');
        doneSent = true;
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        if (!doneSent) await source.cancel().catch(() => undefined);
        source.releaseLock();
      }
    },
    cancel(reason) {
      return source.cancel(reason);
    },
  });
  return new Response(transformed, { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
}
