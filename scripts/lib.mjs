// أدوات مشتركة للسكربتات (Node 22).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const GEN = path.join(ROOT, '.generated', 'data');
export const UA = 'sat-iraq-bot/1.0 (non-commercial free public service)';

export const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
export const writeGen = (name, obj, pretty = false) => {
  fs.mkdirSync(path.dirname(path.join(GEN, name)), { recursive: true });
  fs.writeFileSync(path.join(GEN, name), JSON.stringify(obj, null, pretty ? 1 : 0));
};
export const readGen = (name) => {
  const p = path.join(GEN, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
};
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch مع مهلة وإعادة محاولة (429 و5xx) وتراجع أُسّي. */
export async function fetchRetry(url, { tries = 4, timeoutMs = 30000, headers = {}, asJson = false, asBuffer = false } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeoutMs);
      const res = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': UA, ...headers } });
      clearTimeout(t);
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get('retry-after'));
        throw Object.assign(new Error(`HTTP ${res.status}`), { retryAfter: Number.isFinite(ra) ? ra * 1000 : 0 });
      }
      if (!res.ok) return { ok: false, status: res.status };
      if (asJson) return { ok: true, status: res.status, data: await res.json() };
      if (asBuffer) return { ok: true, status: res.status, data: Buffer.from(await res.arrayBuffer()) };
      return { ok: true, status: res.status, data: await res.text() };
    } catch (e) {
      lastErr = e;
      await sleep(Math.max(e.retryAfter || 0, Number(process.env.RETRY_BASE_MS ?? 1500) * 2 ** i));
    }
  }
  return { ok: false, status: 0, error: String(lastErr?.message || lastErr) };
}

/** ينزّل ملفًا من الموقع المنشور حاليًا (إن عُرف SITE_URL) ليُستعمل احتياطًا عند فشل مصدر خارجي. */
export async function fetchPrevious(relPath) {
  const base = process.env.SITE_URL?.replace(/\/$/, '');
  if (!base) return null;
  const r = await fetchRetry(`${base}/data/${relPath}`, { tries: 2, timeoutMs: 15000, asJson: true });
  return r.ok ? r.data : null;
}

export const ageHours = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 36e5 : Infinity);

export function stepSummary(md) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  console.log(md);
}

export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { x, y };
}
