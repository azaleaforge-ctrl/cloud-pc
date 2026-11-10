import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'rk-agent-reasoning-'));
const require = createRequire(import.meta.url);
try {
  const bundlePath = join(temp, 'agentReasoning.cjs');
  await build({
    entryPoints: [join(ROOT, 'src', 'main', 'editor', 'agentReasoning.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    logLevel: 'silent',
  });
  const { toProviderReasoningEffort, buildReasoningRequestParameters, getReasoningParameter } = require(bundlePath);

  assert.equal(toProviderReasoningEffort('low'), 'low');
  assert.equal(toProviderReasoningEffort('medium'), 'medium');
  assert.equal(toProviderReasoningEffort('high'), 'high');
  assert.equal(toProviderReasoningEffort('maximal'), 'xhigh');
  console.log('PASS effort levels map to provider values with maximal mapped to xhigh');

  assert.deepEqual(buildReasoningRequestParameters('high', 'reasoning'), { reasoning: { effort: 'high' } });
  assert.deepEqual(buildReasoningRequestParameters('maximal', 'reasoning_effort'), { reasoning_effort: 'xhigh' });
  assert.deepEqual(buildReasoningRequestParameters(undefined, 'reasoning'), {});
  assert.deepEqual(buildReasoningRequestParameters('high', undefined), {});
  console.log('PASS only supported reasoning request parameters are emitted');

  assert.equal(getReasoningParameter(['tools', 'reasoning']), 'reasoning');
  assert.equal(getReasoningParameter(['tools', 'reasoning_effort']), 'reasoning_effort');
  assert.equal(getReasoningParameter(['tools']), null);
  console.log('PASS unsupported models stay on default reasoning behavior');
} finally {
  await rm(temp, { recursive: true, force: true });
}
