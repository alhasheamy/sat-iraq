// اختبار تكاملي دون إنترنت: يشغّل خط الأنابيب كاملًا على خوادم وهمية ويفحص النتائج.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, BATCH_DELAY_MS: '0', RETRY_BASE_MS: '1', PROBE_DELAY_MS: '0', SITE_URL: '' };
const run = (script, extra = {}, imports = true) =>
  spawnSync('node', [...(imports ? ['--import', './tests/mocks.mjs'] : []), script], { cwd: ROOT, env: { ...env, ...extra }, encoding: 'utf8' });
const gen = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, '.generated/data', f), 'utf8'));

test('خط الأنابيب الكامل', () => {
  fs.rmSync(path.join(ROOT, '.generated'), { recursive: true, force: true });

  let r = run('scripts/verify-layers.mjs');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const resolved = gen('layers.resolved.json');
  const by = Object.fromEntries(resolved.layers.map((l) => [l.id, l]));
  const ago = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  // طبقة بيانات (غبار مُرصَد) تُحَلّ بالمعرّف الدقيق ويُعثر على أحدث بلاطة لها
  assert.equal(by['aerosol-aod'].status, 'ok');
  assert.equal(by['aerosol-aod'].matrixSet, 'GoogleMapsCompatible_Level6');
  assert.equal(by['aerosol-aod'].maxZoom, 6);
  assert.match(by['aerosol-aod'].tileTemplate, /\{time\}\/GoogleMapsCompatible_Level6\/\{z\}\/\{y\}\/\{x\}\.png$/);
  assert.equal(by['aerosol-aod'].latestDate, ago(1));
  // طبقة غابت عن Capabilities تُعلَّم غير متاحة ولا يفشل النشر
  assert.equal(by['lst-day'].status, 'unavailable');
  // الإيجاد بالبادئة عندما يختلف المعرّف الدقيق
  assert.equal(by['fires-noaa20'].status, 'ok');
  assert.equal(by['fires-noaa20'].gibsIdResolved, 'VIIRS_NOAA20_Thermal_Anomalies_375m_Day');
  assert.match(by['fires-noaa20'].resolvedVia, /^prefix:/);
  // لا صور أساسية غير Esri في الناتج: لا خلفية EOX ولا Sentinel ولا صور VIIRS/MODIS الحقيقية
  assert.equal(resolved.base, undefined);
  assert.equal(resolved.sentinel2, undefined);
  assert.ok(resolved.layers.length > 0 && resolved.layers.every((l) => l.kind === 'overlay'));

  r = run('scripts/fetch-weather.mjs');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const meta = gen('meta.json');
  assert.deepEqual(meta.errors, []);
  assert.equal(meta.result.grid, 'fetched');
  assert.ok(meta.apiWeightThisRun < 2500, `الوزن ${meta.apiWeightThisRun}`);
  const wind = gen('grid/wind.json');
  assert.equal(wind.grid.nx * wind.grid.ny, 336);
  assert.equal(wind.u.length, 24);
  assert.equal(wind.u[0].length, 336);
  assert.ok(gen('summary.json').cities.baghdad.text.includes('بغداد'));

  r = run('scripts/prepare-wrangler.mjs', { CF_PROJECT_NAME: 'demo-proj', KV_ID: 'a'.repeat(32) }, false);
  assert.equal(r.status, 0, r.stderr);
  let toml = fs.readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
  assert.match(toml, /name = "demo-proj"/);
  assert.match(toml, /LIMITS_KV/);
  r = run('scripts/prepare-wrangler.mjs', { CF_PROJECT_NAME: 'demo-proj', KV_ID: '' }, false);
  toml = fs.readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
  assert.ok(!toml.includes('LIMITS_KV') && !toml.includes('__KV'));
  assert.notEqual(run('scripts/prepare-wrangler.mjs', { CF_PROJECT_NAME: 'Bad_Name' }, false).status, 0);
  assert.notEqual(run('scripts/prepare-wrangler.mjs', { CF_PROJECT_NAME: 'ok', KV_ID: 'xyz' }, false).status, 0);
  fs.rmSync(path.join(ROOT, 'wrangler.toml'));

  r = run('scripts/assemble.mjs', {}, false);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  for (const f of ['index.html', '_headers', '_routes.json', 'data/meta.json', 'data/status.json', 'data/layers.resolved.json', 'data/grid/dust.json', 'data/config/cities.json', 'data/build.json']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'dist', f)), `مفقود: ${f}`);
  }
});

test('الدالة الذكية تعمل ضمن حزمة esbuild كما ستعمل في Cloudflare', async () => {
  const r = spawnSync('npx', ['--yes', 'esbuild', 'functions/api/assistant.js', '--bundle', '--format=esm', '--outfile=.generated/fn.mjs', '--log-level=error'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const fn = await import(path.join(ROOT, '.generated/fn.mjs'));
  const store = new Map();
  const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => void store.set(k, v) };
  const AI = { run: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: '```json\n{"reply":"تم <b>عرض</b>","actions":[{"type":"fly_to","place":"البصرة","zoom":8},{"type":"open_url","url":"http://x"}]}\n```' }] }] }) };
  const mk = (text, ip = '1.1.1.1') => new Request('https://x/api/assistant', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ text }) });
  let res = await fn.onRequestPost({ request: mk('أرني البصرة'), env: { AI, LIMITS_KV: kv } });
  let j = await res.json();
  assert.equal(res.status, 200);
  assert.equal(j.actions.length, 1);
  assert.ok(!j.reply.includes('<'));
  for (let i = 0; i < 16; i++) res = await fn.onRequestPost({ request: mk('x', '2.2.2.2'), env: { AI, LIMITS_KV: kv } });
  assert.equal(res.status, 429); // الطلب 16 يتجاوز سقف المستخدم (15)
  const failing = { run: async () => { throw new Error('down'); } };
  res = await fn.onRequestPost({ request: mk('x', '3.3.3.3'), env: { AI: failing, LIMITS_KV: kv } });
  assert.equal(res.status, 503);
  res = await fn.onRequestPost({ request: mk('x'.repeat(300), '4.4.4.4'), env: { AI, LIMITS_KV: kv } });
  assert.equal(res.status, 400);
});
