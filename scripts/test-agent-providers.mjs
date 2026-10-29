import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'rk-agent-providers-'));
const require = createRequire(import.meta.url);
const originalFetch = globalThis.fetch;
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('PASS ' + name);
  } catch (error) {
    failed++;
    console.error('FAIL ' + name + ': ' + (error instanceof Error ? error.message : String(error)));
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

try {
  const providerBundle = join(dir, 'agentProviders.cjs');
  const capabilitiesBundle = join(dir, 'modelCapabilities.cjs');
  await Promise.all([
    build({
      entryPoints: [join(root, 'src/main/editor/agentProviders.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: providerBundle,
      logLevel: 'silent',
    }),
    build({
      entryPoints: [join(root, 'src/main/editor/modelCapabilities.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: capabilitiesBundle,
      logLevel: 'silent',
    }),
  ]);
  const providers = require(providerBundle);
  const capabilities = require(capabilitiesBundle);

  await test('builds Gemini system instruction, messages, function declarations and required tool choice', () => {
    const body = providers.buildGeminiRequestBody({
      model: 'gemini-3.8-flash',
      messages: [
        { role: 'system', content: 'You are a coding assistant.' },
        { role: 'user', content: 'Read README.md.' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'call-1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"README.md"}' },
          }],
        },
        { role: 'tool', tool_call_id: 'call-1', name: 'read_file', content: 'file contents' },
        { role: 'tool', tool_call_id: 'call-2', name: 'list_files', content: '["README.md"]' },
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a workspace file',
          parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        },
      }],
      toolChoice: 'required',
      temperature: 0.15,
      maxOutputTokens: 2048,
    });
    assert.deepEqual(body.systemInstruction.parts, [{ text: 'You are a coding assistant.' }]);
    assert.deepEqual(body.contents.map(item => item.role), ['user', 'model', 'user']);
    assert.deepEqual(body.contents[1].parts[0].functionCall, { name: 'read_file', args: { path: 'README.md' } });
    assert.equal(body.contents[2].parts.length, 2, 'parallel tool responses should share one user content');
    assert.deepEqual(body.contents[2].parts.map(part => part.functionResponse.name), ['read_file', 'list_files']);
    assert.equal(body.tools[0].functionDeclarations[0].name, 'read_file');
    assert.equal(body.toolConfig.functionCallingConfig.mode, 'ANY');
    assert.equal(body.generationConfig.maxOutputTokens, 2048);
  });

  await test('converts embedded image data URLs to Gemini inlineData without fetching remote URLs', () => {
    const body = providers.buildGeminiRequestBody({
      model: 'gemini-3.8-flash',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
        ],
      }],
    });
    assert.deepEqual(body.contents[0].parts[1].inlineData, { mimeType: 'image/png', data: 'aGVsbG8=' });
    assert.throws(() => providers.buildGeminiRequestBody({
      model: 'gemini-3.8-flash',
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/image.png' } }] }],
    }), /URL gambar eksternal/);
  });

  await test('normalizes Gemini text and function calls into the agent OpenAI-shaped response contract', () => {
    const normalized = providers.normalizeGeminiResponse({
      responseId: 'resp-1',
      candidates: [{
        content: {
          role: 'model',
          parts: [
            { text: 'I will read that file.' },
            { functionCall: { name: 'read_file', args: { path: 'README.md' } } },
          ],
        },
        finishReason: 'STOP',
      }],
    });
    const message = normalized.choices[0].message;
    assert.equal(message.content, 'I will read that file.');
    assert.equal(message.tool_calls[0].function.name, 'read_file');
    assert.deepEqual(JSON.parse(message.tool_calls[0].function.arguments), { path: 'README.md' });
  });

  await test('streams Gemini responses as OpenAI-shaped SSE and keeps the key out of the URL', async () => {
    let observedUrl = '';
    let observedHeaders;
    let observedBody;
    globalThis.fetch = async (input, init) => {
      observedUrl = String(input);
      observedHeaders = new Headers(init.headers);
      observedBody = JSON.parse(init.body);
      const first = { candidates: [{ content: { role: 'model', parts: [{ text: 'Hello from Gemini.' }] } }] };
      const second = { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'read_file', args: { path: 'README.md' } } }] }, finishReason: 'STOP' }] };
      return new Response('data: ' + JSON.stringify(first) + '\n\n' + 'data: ' + JSON.stringify(second) + '\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };
    const response = await providers.openGeminiCompletionStream({
      provider: 'gemini',
      apiKey: 'sensitive-test-key',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta',
      models: ['gemini-3.8-flash'],
    }, [{ role: 'user', content: 'Say hello, then call read_file.' }], [{
      type: 'function',
      function: { name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
    }], 'auto', new AbortController().signal);
    const stream = await response.text();
    assert.equal(response.status, 200);
    assert.match(observedUrl, /models\/gemini-3\.8-flash:streamGenerateContent\?alt=sse$/);
    assert.equal(observedHeaders.get('x-goog-api-key'), 'sensitive-test-key');
    assert.equal(observedUrl.includes('sensitive-test-key'), false);
    assert.ok(observedBody.contents.length);
    const payloads = stream.split(/\r?\n\r?\n/)
      .map(event => event.split(/\r?\n/).find(line => line.startsWith('data: '))?.slice(6))
      .filter(value => !!value && value !== '[DONE]')
      .map(value => JSON.parse(value));
    assert.ok(payloads.some(payload => payload.choices?.[0]?.delta?.content?.includes('Hello from Gemini.')));
    const toolPayload = payloads.find(payload => payload.choices?.[0]?.delta?.tool_calls?.length);
    assert.ok(toolPayload);
    assert.equal(toolPayload.choices[0].delta.tool_calls[0].function.name, 'read_file');
    assert.deepEqual(JSON.parse(toolPayload.choices[0].delta.tool_calls[0].function.arguments), { path: 'README.md' });
    assert.match(stream, /data: \[DONE\]/);
  });

  await test('lists only Gemini content-generation models and strips the models/ prefix', async () => {
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), 'https://generativelanguage.googleapis.com/v1beta/models');
      assert.equal(new Headers(init.headers).get('x-goog-api-key'), 'gemini-test-key');
      return json({ models: [
        { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', supportedGenerationMethods: ['generateContent', 'streamGenerateContent'] },
        { name: 'models/gemini-embedding-2', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
      ] });
    };
    const result = await capabilities.listAvailableModels({
      provider: 'gemini',
      apiKey: 'gemini-test-key',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta',
      models: ['gemini-3.8-flash'],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.models.map(model => model.id), ['gemini-3.8-flash']);
    assert.equal(result.models[0].name, 'Gemini 3.8 Flash');
  });

  await test('tests Gemini connection via generateContent and the x-goog-api-key header', async () => {
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
      assert.equal(new Headers(init.headers).get('x-goog-api-key'), 'gemini-test-key');
      const body = JSON.parse(init.body);
      assert.equal(body.contents[0].parts[0].text, 'Reply with exactly OK.');
      return json({ candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] });
    };
    const result = await capabilities.testProviderConnection({
      provider: 'gemini',
      apiKey: 'gemini-test-key',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta',
      models: ['gemini-3.8-flash'],
    });
    assert.equal(result.ok, true);
    assert.equal(result.model, 'gemini-3.8-flash');
  });

  await test('runs chat, function-calling and image-input diagnostics through the Gemini adapter', async () => {
    const requestBodies = [];
    globalThis.fetch = async (input, init) => {
      const body = JSON.parse(init.body);
      requestBodies.push({ url: String(input), body });
      const hasTool = Array.isArray(body.tools) && body.tools.some(tool => tool.functionDeclarations?.length);
      const hasImage = body.contents?.some(content => content.parts?.some(part => part.inlineData));
      if (hasTool) {
        return json({ candidates: [{ content: { parts: [{ functionCall: { name: 'capability_probe', args: { ready: true } } }] }, finishReason: 'STOP' }] });
      }
      return json({ candidates: [{ content: { parts: [{ text: hasImage ? 'A tiny image.' : 'OK' }] }, finishReason: 'STOP' }] });
    };
    const report = await capabilities.diagnoseModelCapabilities({
      provider: 'gemini',
      apiKey: 'gemini-test-key',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta',
      models: ['gemini-3.8-flash'],
    }, 'gemini-3.8-flash');
    assert.equal(report.ok, true);
    assert.deepEqual(report.checks.map(check => check.status), ['supported', 'supported', 'supported']);
    assert.equal(requestBodies.length, 3);
    assert.ok(requestBodies.every(item => item.url.endsWith(':generateContent')));
    assert.ok(requestBodies.some(item => item.body.contents?.some(content => content.parts?.some(part => part.inlineData))));
  });
} finally {
  globalThis.fetch = originalFetch;
  await rm(dir, { recursive: true, force: true });
}
console.log('Agent provider tests: ' + passed + ' passed, ' + failed + ' failed.');
if (failed > 0) process.exitCode = 1;
