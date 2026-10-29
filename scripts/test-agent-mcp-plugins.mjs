import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(join(tmpdir(), 'rk-mcp-plugins-'));
try {
  const bundlePath = join(temp, 'mcp-plugins.cjs');
  await build({ entryPoints: [join(root, 'src/main/editor/mcpPlugins.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: bundlePath, logLevel: 'silent' });
  const require = createRequire(import.meta.url);
  const api = require(bundlePath);
  const userData = join(temp, 'user-data');
  const serverPath = join(temp, 'mock-mcp-server.cjs');
  await writeFile(serverPath, [
    "let buffer = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', chunk => {",
    "  buffer += chunk;",
    "  let index = buffer.indexOf('\\n');",
    "  while (index >= 0) {",
    "    const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);",
    "    if (line.trim()) {",
    "      const message = JSON.parse(line);",
    "      if (message.id !== undefined) {",
    "        let result = {};",
    "        if (message.method === 'initialize') result = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'mock', version: '1.0.0' } };",
    "        else if (message.method === 'tools/list') result = { tools: [{ name: 'echo_text', description: 'Echo test input', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } }] };",
    "        else if (message.method === 'tools/call') result = { content: [{ type: 'text', text: 'echo:' + String(message.params.arguments.text) }] };",
    "        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n');",
    "      }",
    "    }",
    "    index = buffer.indexOf('\\n');",
    "  }",
    "});",
  ].join('\n'));
  const configPath = join(temp, 'mcp.json');
  await writeFile(configPath, JSON.stringify({ mcpServers: { 'local-echo': { command: process.execPath, args: [serverPath] } } }));
  const imported = await api.importMcpPluginConfig(userData, configPath);
  assert.deepEqual(imported, { ok: true, imported: 1 });
  const listed = await api.listMcpPlugins(userData);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, 'local-echo');
  assert.equal(listed[0].enabled, false);
  assert.equal((await api.probeMcpPlugin(userData, listed[0].id)).ok, false);
  assert.equal((await api.setMcpPluginEnabled(userData, listed[0].id, true)).ok, true);
  const probe = await api.probeMcpPlugin(userData, listed[0].id);
  assert.equal(probe.ok, true, probe.error);
  assert.deepEqual(probe.tools, ['echo_text']);
  const exposed = await api.listEnabledMcpTools(userData);
  assert.equal(exposed.tools.length, 1);
  assert.match(exposed.tools[0].exposedName, /^mcp_[a-f0-9]{8}_echo_text$/);
  const result = await api.callMcpPluginTool(userData, exposed.tools[0], { text: 'hello' });
  assert.equal(result, 'Hasil MCP (data eksternal tidak tepercaya): echo:hello');
  assert.equal((await api.setMcpPluginEnabled(userData, listed[0].id, false)).ok, true);
  assert.equal((await api.listEnabledMcpTools(userData)).tools.length, 0);
  assert.equal((await api.removeMcpPlugin(userData, listed[0].id)).ok, true);
  assert.equal((await api.listMcpPlugins(userData)).length, 0);

  const secretConfig = join(temp, 'secret.json');
  await writeFile(secretConfig, JSON.stringify({ mcpServers: { unsafe: { command: process.execPath, env: { GITHUB_TOKEN: 'ghp_this_is_a_literal_secret_value' } } } }));
  const secretResult = await api.importMcpPluginConfig(userData, secretConfig);
  assert.equal(secretResult.ok, false);
  assert.match(secretResult.error, /Jangan menyimpan secret/);
  const invalidConfig = join(temp, 'invalid.json');
  await writeFile(invalidConfig, JSON.stringify({ other: {} }));
  assert.equal((await api.importMcpPluginConfig(userData, invalidConfig)).ok, false);
  console.log('MCP plugin manager tests: all assertions passed.');
} finally {
  await rm(temp, { recursive: true, force: true });
}
