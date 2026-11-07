import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const dir=await mkdtemp(join(tmpdir(),'rk-openrouter-auth-'));
const require=createRequire(import.meta.url);
try {
  const bundle=join(dir,'openRouterAccount.cjs');
  await build({
    entryPoints:[join(root,'src/main/editor/openRouterAccount.ts')],
    bundle:true,platform:'node',format:'cjs',outfile:bundle,logLevel:'silent',
  });
  const api=require(bundle);

  const pkce=api.createOpenRouterPkcePair();
  assert.match(pkce.verifier,/^[A-Za-z0-9_-]{43}$/);
  assert.match(pkce.challenge,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(pkce.challenge,createHash('sha256').update(pkce.verifier,'ascii').digest('base64url'));

  const authUrl=new URL(api.buildOpenRouterAuthorizationUrl(
    'http://127.0.0.1:45678/callback',
    pkce.challenge,
    'state-token',
    'Ruang Kerja Desktop',
  ));
  assert.equal(authUrl.origin,'https://openrouter.ai');
  assert.equal(authUrl.pathname,'/auth');
  assert.equal(authUrl.searchParams.get('callback_url'),'http://127.0.0.1:45678/callback');
  assert.equal(authUrl.searchParams.get('code_challenge'),pkce.challenge);
  assert.equal(authUrl.searchParams.get('code_challenge_method'),'S256');
  assert.equal(authUrl.searchParams.get('state'),'state-token');
  assert.equal(authUrl.searchParams.get('key_label'),'Ruang Kerja Desktop');
  assert.throws(()=>api.buildOpenRouterAuthorizationUrl('https://attacker.example/callback',pkce.challenge,'state'));

  const status=api.normalizeOpenRouterKeyStatus({data:{
    creator_user_id:'user_openrouter_123',
    name:'Ruang Kerja Desktop',
    label:'sk-or-v1-abcd...wxyz',
    is_free_tier:true,
    is_management_key:false,
    limit:10,
    limit_remaining:7.25,
    usage:2.75,
    usage_daily:1.25,
    usage_weekly:2.0,
    usage_monthly:2.75,
    limit_reset:'monthly',
    effective_budget:{
      scope:'key_limit',
      limit_usd:10,
      spend_usd:2.75,
      remaining_usd:7.25,
      reset_interval:'monthly',
      resets_at:'2026-12-01T00:00:00Z',
    },
  }},{userId:'user_oauth_123',authMethod:'oauth',keyHash:'a'.repeat(64)});
  assert.equal(status.connected,true);
  assert.equal(status.authMethod,'oauth');
  assert.equal(status.userId,'user_oauth_123','OAuth identity should take precedence over the key metadata fallback');
  assert.equal(status.keyName,'Ruang Kerja Desktop');
  assert.equal(status.isFreeTier,true);
  assert.equal(status.limitRemaining,7.25);
  assert.equal(status.usageDaily,1.25);
  assert.equal(status.effectiveBudget.remainingUsd,7.25);
  assert.equal(status.keySettingsUrl,'https://openrouter.ai/keys/'+('a'.repeat(64)));
  assert.equal(status.activityUrl,'https://openrouter.ai/logs?api_key_hash='+('a'.repeat(64)));

  const credits=api.normalizeOpenRouterCredits({data:{total_credits:5,total_usage:1.275}},'2026-11-07T00:00:00.000Z');
  assert.equal(credits.configured,true);
  assert.equal(credits.totalCreditsUsd,5);
  assert.equal(credits.totalUsageUsd,1.275);
  assert.equal(credits.balanceUsd,3.725);
  assert.equal(credits.fetchedAt,'2026-11-07T00:00:00.000Z');
  const incompleteCredits=api.normalizeOpenRouterCredits({data:{total_credits:5}});
  assert.equal(incompleteCredits.balanceUsd,null,'balance must not be guessed if usage is absent');

  const fx=api.normalizeUsdIdrRate({base:'USD',quote:'IDR',rate:15875.25,date:'2026-11-06'},'2026-11-07T00:00:00.000Z');
  assert.equal(fx.rate,15875.25);
  assert.equal(fx.date,'2026-11-06');
  assert.equal(fx.source,'Frankfurter');
  const invalidFx=api.normalizeUsdIdrRate({base:'USD',quote:'EUR',rate:0.92,date:'2026-11-06'});
  assert.equal(invalidFx.rate,null,'do not accept a different FX pair');

  const keyLimit=api.openRouterHttpErrorMessage(402,JSON.stringify({
    error:{message:'key budget spent',metadata:{limit_source:'openrouter_key_limit'}},
  }));
  assert.match(keyLimit,/batas kredit untuk API key ini sudah habis/);

  const accountCredits=api.openRouterHttpErrorMessage(402,JSON.stringify({
    error:{metadata:{limit_source:'openrouter_credits'}},
  }));
  assert.match(accountCredits,/saldo akun tidak cukup/);

  const inFlight=api.openRouterHttpErrorMessage(402,JSON.stringify({
    error:{metadata:{limit_source:'openrouter_in_flight_budget'}},
  }),{get:(name)=>name==='retry-after'?'12':null});
  assert.match(inFlight,/anggaran untuk request yang sedang berjalan penuh/);
  assert.match(inFlight,/12 detik/);

  const rateLimit=api.openRouterHttpErrorMessage(429,'{}',{
    get:(name)=>({
      'retry-after':'30',
      'x-ratelimit-limit':'20',
      'x-ratelimit-remaining':'0',
      'x-ratelimit-reset':'60',
    }[name] ?? null),
  });
  assert.match(rateLimit,/HTTP 429/);
  assert.match(rateLimit,/tidak menaikkan kapasitas global/);
  assert.match(rateLimit,/Retry-After: 30/);
  assert.match(rateLimit,/sisa rate-limit header: 0/);

  console.log('OpenRouter OAuth/account tests: all assertions passed.');
} finally {
  await rm(dir,{recursive:true,force:true});
}
