// يتحقق من كتالوج الطبقات مقابل GetCapabilities الرسمي لـ NASA GIBS، ويكتب:
//   data/layers.resolved.json  (ما تقرؤه الواجهة: قوالب بلاطات صحيحة وأحدث تاريخ متاح)
//   data/status.json           (حالة كل طبقة)
// لا يُفشل النشر إن غابت طبقة؛ يعلّمها unavailable لتُخفى في الواجهة.
// صور القاعدة (Esri) ليست من GIBS فتُتجاهل هنا (كل ما بلا gibsId). لا خلفية EOX ولا أي صور أقمار أقل دقة.
// يفشل فقط إن تعذّر الوصول إلى GIBS كليًا ولا توجد نسخة سابقة.

import { XMLParser } from 'fast-xml-parser';
import { readJson, writeGen, fetchRetry, fetchPrevious, lonLatToTile, stepSummary, sleep } from './lib.mjs';

const cfg = readJson('config/layers.json');
const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const arr = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export function parseCapabilities(xmlText) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    isArray: (name) => ['Layer', 'Format', 'Dimension', 'ResourceURL', 'TileMatrixSetLink'].includes(name)
  });
  const xml = parser.parse(xmlText);
  const layers = new Map();
  for (const L of arr(xml?.Capabilities?.Contents?.Layer)) {
    const id = L.Identifier;
    if (!id) continue;
    // ملاحظة: في الملف الرسمي اسم البُعد "Time" بحرف كبير
    const time = arr(L.Dimension).find((d) => String(d.Identifier).toLowerCase() === 'time');
    layers.set(String(id), {
      id: String(id),
      formats: arr(L.Format),
      matrixSets: arr(L.TileMatrixSetLink).map((t) => t.TileMatrixSet),
      resources: arr(L.ResourceURL)
        .filter((u) => u['@_resourceType'] === 'tile')
        .map((u) => ({ format: u['@_format'], template: u['@_template'] })),
      timeDefault: time?.Default ? String(time.Default) : null,
      timeRanges: arr(time?.Value).map(String)
    });
  }
  return layers;
}

/** يجد الطبقة بالمعرّف، وإلا بأول معرّف يبدأ بالبادئة المحددة في الكتالوج. */
export function findLayer(caps, L) {
  if (caps.has(L.gibsId)) return { cap: caps.get(L.gibsId), via: 'exact' };
  if (L.gibsPrefix) {
    const hit = [...caps.keys()].filter((k) => k.startsWith(L.gibsPrefix)).sort()[0];
    if (hit) return { cap: caps.get(hit), via: `prefix:${hit}` };
  }
  return null;
}

function pickResource(cap, preferFormat) {
  const want = preferFormat === 'jpeg' ? 'image/jpeg' : 'image/png';
  const tiles = cap.resources.filter((r) => r.template.includes('{Time}'));
  const pool = tiles.length ? tiles : cap.resources;
  return pool.find((r) => r.format === want) || pool[0] || null;
}

const fill = (tpl, o) => tpl.replace('{Time}', o.time).replace('{TileMatrixSet}', o.tms).replace('{TileMatrix}', o.z).replace('{TileRow}', o.y).replace('{TileCol}', o.x);

async function probeLatest(resource, tms, capDefault) {
  const p = cfg.probe;
  const { x, y } = lonLatToTile(p.lon, p.lat, p.zoom);
  const start = capDefault && /^\d{4}-\d{2}-\d{2}/.test(capDefault) ? new Date(capDefault.slice(0, 10)) : today;
  const first = start > today ? today : start;
  for (let back = 0; back <= p.maxDaysBack; back++) {
    const d = new Date(first);
    d.setUTCDate(d.getUTCDate() - back);
    const url = fill(resource.template, { time: iso(d), tms, z: p.zoom, y, x });
    const r = await fetchRetry(url, { tries: 2, timeoutMs: 20000, asBuffer: true });
    if (r.ok && r.data.length >= p.minBytes) return { date: iso(d), bytes: r.data.length };
    await sleep(Number(process.env.PROBE_DELAY_MS ?? 200));
  }
  return null;
}

async function loadCapabilities() {
  const r = await fetchRetry(cfg.gibs.capabilities, { tries: 3, timeoutMs: 120000 });
  return r.ok ? parseCapabilities(r.data) : null;
}

async function main() {
  const caps = await loadCapabilities();
  if (!caps || caps.size === 0) {
    const prev = await fetchPrevious('layers.resolved.json');
    const prevStatus = await fetchPrevious('status.json');
    if (prev && prevStatus) {
      writeGen('layers.resolved.json', prev);
      writeGen('status.json', { ...prevStatus, stale: true, note: 'تعذّر الوصول إلى GIBS؛ نُسخت آخر حالة ناجحة.' });
      stepSummary('⚠️ تعذّر تحميل GetCapabilities؛ استُخدمت آخر نسخة منشورة.');
      return;
    }
    stepSummary('❌ تعذّر تحميل GetCapabilities ولا توجد نسخة سابقة.');
    process.exit(1);
  }

  const resolved = [];
  const rows = ['| الطبقة | المعرّف | الحالة | مجموعة المصفوفة | الصيغة | أحدث تاريخ |', '|---|---|---|---|---|---|'];
  for (const L of cfg.layers.filter((x) => x.gibsId)) {
    const found = findLayer(caps, L);
    if (!found) {
      resolved.push({ ...L, status: 'unavailable', reason: 'المعرّف غير موجود في GetCapabilities' });
      rows.push(`| ${L.title_ar} | ${L.gibsId} | ❌ غير موجود | - | - | - |`);
      continue;
    }
    const { cap, via } = found;
    const res = pickResource(cap, L.preferFormat);
    if (!res) {
      resolved.push({ ...L, status: 'unavailable', reason: 'لا قالب بلاطات' });
      rows.push(`| ${L.title_ar} | ${cap.id} | ❌ بلا قالب | - | - | - |`);
      continue;
    }
    const tms = cap.matrixSets[0];
    const maxZoom = Number((String(tms).match(/Level(\d+)/) || [])[1] ?? 0);
    let latest = cap.timeDefault ? cap.timeDefault.slice(0, 10) : null;
    let probed = null;
    if (L.probe) {
      probed = await probeLatest(res, tms, cap.timeDefault);
      if (probed) latest = probed.date;
    }
    const status = L.probe && !probed ? 'no_recent_tile' : 'ok';
    resolved.push({
      ...L,
      gibsIdResolved: cap.id,
      resolvedVia: via,
      status,
      tileTemplate: res.template.replace('{Time}', '{time}').replace('{TileMatrixSet}', tms).replace('{TileMatrix}', '{z}').replace('{TileRow}', '{y}').replace('{TileCol}', '{x}'),
      format: res.format,
      matrixSet: tms,
      maxZoom,
      timeDefault: cap.timeDefault,
      latestDate: latest
    });
    rows.push(`| ${L.title_ar} | ${cap.id}${via === 'exact' ? '' : ' (بالبادئة)'} | ${status === 'ok' ? '✅' : '⚠️ لا بلاطة حديثة'} | ${tms} | ${res.format} | ${latest ?? '-'} |`);
  }

  const generatedAt = new Date().toISOString();
  writeGen('layers.resolved.json', {
    version: 1,
    generatedAt,
    layers: resolved
  });
  writeGen('status.json', {
    version: 1,
    generatedAt,
    layers: Object.fromEntries(resolved.map((l) => [l.id, { status: l.status, latestDate: l.latestDate ?? null }]))
  }, true);
  stepSummary(`### نتيجة التحقق من الطبقات\n${rows.join('\n')}`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('verify-layers.mjs')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
