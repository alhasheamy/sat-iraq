// دوال نقية (بلا DOM ولا شبكة) لمعرفة دقة الصورة الفعلية، وللبحث عن صور مفتوحة أدق من Esri.
// مغطاة باختبارات tests/imagery.test.js. تُستعمل في الواجهة فقط.

// ---------------------------------------------------------------------------
// 1) بيانات دقة صور Esri (خدمة World_Imagery_Metadata)
// رقم الطبقة = 23 − مستوى التقريب: طبقة 4 = 30 سم = z19، وطبقة 13 = 150 م = z10 وما دون.
// (تحقّقنا منها من صفحة /layers الرسمية للخدمة: 14 طبقة من 1.9 سم إلى 150 م.)
export const clampZoom = (z) => Math.min(23, Math.max(10, Math.round(z)));
export const metaLayerId = (zoom) => 23 - clampZoom(zoom);

export function metaQueryUrl(base, lon, lat, zoom) {
  const q = new URLSearchParams({
    f: 'json', where: '1=1', geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', outFields: 'SRC_DATE2,SRC_DATE,SRC_RES,SRC_ACC,NICE_NAME,NICE_DESC', returnGeometry: 'false',
  });
  return `${base}/${metaLayerId(zoom)}/query?${q}`;
}

const ymd = (v) => {
  if (typeof v === 'number' && v > 1e11) return new Date(v).toISOString().slice(0, 10); // SRC_DATE2: ميلي ثانية
  if (typeof v === 'number' && v >= 19000101 && v <= 29991231) { const s = String(v); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; } // SRC_DATE: YYYYMMDD
  return null;
};
const pos = (x) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null);
const byFinest = (a, b) => (a.res ?? 1e9) - (b.res ?? 1e9) || (b.date ?? '').localeCompare(a.date ?? '');

/** يقرأ استجابة الاستعلام. إن تقاطعت عدة لقطات عند النقطة نأخذ الأدق ثم الأحدث. */
export function parseMeta(json) {
  const rows = (Array.isArray(json?.features) ? json.features : [])
    .map((f) => f?.attributes)
    .filter(Boolean)
    .map((a) => ({ date: ymd(a.SRC_DATE2) ?? ymd(a.SRC_DATE), res: pos(a.SRC_RES), acc: pos(a.SRC_ACC), provider: a.NICE_NAME || null, sensor: a.NICE_DESC || null }));
  return rows.length ? rows.sort(byFinest)[0] : null;
}

/** يرتّب الصفوف من الأدق (أصغر res) فالأحدث، ويحذف المكرر (نفس اللقطة في عدة إصدارات) محتفظًا بأحدث إصدار. */
export function rankBest(rows) {
  const seen = new Map();
  for (const r of rows) {
    const k = `${r.date}|${r.res}|${r.provider}|${r.sensor}`, p = seen.get(k);
    if (!p || r.rel > p.rel) seen.set(k, r);
  }
  return [...seen.values()].sort(byFinest);
}

// عزل اتجاه النص داخل الجمل العربية: التاريخ بعد كلمة عربية ينعكس (2019-08-07 يظهر 07-08-2019) وينكسر عند الشرطة،
// والأسماء اللاتينية قد تتبعثر. LRI/FSI/PDI عوازل اتجاه (Unicode)، وWJ يمنع كسر السطر عند الشرطة.
const LRI = '\u2066', FSI = '\u2068', PDI = '\u2069', WJ = '\u2060';
export const isoDate = (d) => (d ? `${LRI}${String(d).replaceAll('-', `-${WJ}`)}${PDI}` : '؟');
export const bidi = (s) => `${FSI}${s}${PDI}`;

export const fmtRes = (r) => (r == null ? '؟' : r < 1 ? `${+r.toFixed(2)} م` : `${+r.toFixed(1)} م`);

export const metaLine = (v) => (v
  ? `الصورة هنا: ${bidi([v.provider, v.sensor].filter(Boolean).join(' ') || 'مصدر غير معروف')} · دقة أصلية ${fmtRes(v.res)} · التقاط ${isoDate(v.date)}`
  : '');

/** تكبير رقمي: نسبة دقة الصورة الأصلية إلى ما يعرضه بكسل الشاشة (م/بكسل). يرجع 1 إن لم يكن هناك تكبير ملحوظ. */
export function digitalZoom(nativeRes, mpp) {
  if (!(nativeRes > 0) || !(mpp > 0)) return null;
  const f = nativeRes / mpp;
  return f >= 1.25 ? +f.toFixed(1) : 1;
}

/** ملخص «أدق لقطة في الأرشيف» مقارنةً بالصورة الحالية. top: نتيجة rankBest، cur: بيانات الإصدار الحالي. */
export function bestSummary(top, cur) {
  if (!top.length) return 'لم تُرجع الخدمة بيانات دقة لهذا الموقع.';
  const t = top[0];
  if (cur?.res != null && t.res != null) {
    return t.res < cur.res * 0.95
      ? `أدق لقطة في أرشيف Wayback: ${fmtRes(t.res)} (${isoDate(t.date)}) مقابل ${fmtRes(cur.res)} في الصورة الحالية. اضغط عليها لعرضها.`
      : `الصورة الحالية (${fmtRes(cur.res)}) هي الأدق بين كل إصدارات الأرشيف في هذا الموقع.`;
  }
  return `أدق لقطة في الأرشيف: ${fmtRes(t.res)} (${isoDate(t.date)}).`;
}

// ---------------------------------------------------------------------------
// 2) صور مفتوحة: فهرس OpenAerialMap (HOT). تُعرض صور الدرون والأقمار المجتمعية (CC BY 4.0) فوق Esri.
// تحقّقنا حيًّا (18–20 أكتوبر 2026) أن الاستعلام بصندوق العراق يعيد 63 صورة درون بدقة 1–2 سم لمواقع أثرية،
// وأن لكل صورة property اسمها tms بصيغة https://tiles.openaerialmap.org/<id>/0/<id>/{z}/{x}/{y} (XYZ).
// (واجهة STAC الجديدة api.imagery.hotosm.org لا توثّق مسار بلاطات، فأُزيلت من الكود.)
export const OAM_API = 'https://api.openaerialmap.org';
export const OAM_TILES_HOST = 'tiles.openaerialmap.org';
export const IRAQ_BBOX = [38.8, 29, 48.6, 37.4];

const clean = (s, n = 90) => (typeof s === 'string' ? s.replace(/[\u0000-\u001F<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');
const bboxOf = (b) => (Array.isArray(b) && b.length === 4 && b.every((v) => typeof v === 'number' && Number.isFinite(v)) ? b : null);

/** رابط استعلام الفهرس بصندوق [غرب, جنوب, شرق, شمال]. */
export function oamMetaUrl(bbox, limit = 100, page = 1) {
  const q = new URLSearchParams({ bbox: bbox.map((v) => +(+v).toFixed(5)).join(','), limit: String(Math.min(100, Math.max(1, limit))), page: String(Math.max(1, page)) });
  return `${OAM_API}/meta?${q}`;
}

/** قالب بلاطات مقبول فقط من نطاق OAM وبصيغة https وبالمتغيرات الثلاثة. */
export function validOamTiles(t) {
  if (typeof t !== 'string' || /[\s"'<>]/.test(t)) return null;
  try {
    const u = new URL(t.replace('{z}', '0').replace('{x}', '0').replace('{y}', '0'));
    if (u.protocol !== 'https:' || u.hostname !== OAM_TILES_HOST) return null;
  } catch { return null; }
  return ['{z}', '{x}', '{y}'].every((k) => t.includes(k)) ? t : null;
}

/** عنصر من نتائج /meta ← كائن صغير آمن، أو null إن لم يكن صالحًا. */
export function parseOamResult(r, metaLicense = null) {
  if (!r || typeof r !== 'object') return null;
  const tiles = validOamTiles(r.properties?.tms ?? r.tms);
  if (!tiles) return null;
  const fromPath = /^https:\/\/tiles\.openaerialmap\.org\/[\w]+\/\d+\/([\w]+)\/\{z\}/.exec(tiles)?.[1];
  const id = typeof fromPath === 'string' ? fromPath : typeof r._id === 'string' ? r._id : null;
  if (!id || !/^[\w.-]{1,80}$/.test(id)) return null;
  const d = r.acquisition_end ?? r.acquisition_start;
  return {
    id,
    collection: 'openaerialmap',
    title: clean(r.title) || id,
    gsd: pos(r.gsd),
    date: typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null,
    license: clean(r.license ?? metaLicense, 24) || 'CC-BY 4.0',
    kind: /uav|drone/i.test(String(r.platform ?? '')) ? 'uav' : 'satellite',
    producer: clean(r.provider, 60) || null,
    bbox: bboxOf(r.bbox),
    tiles,
  };
}

/** استجابة /meta كاملة ← قائمة عناصر صالحة. */
export function parseOamResponse(json) {
  const lic = clean(json?.meta?.license, 24) || null;
  return (Array.isArray(json?.results) ? json.results : []).map((r) => parseOamResult(r, lic)).filter(Boolean);
}

/** مركز صندوق [غرب, جنوب, شرق, شمال]. */
export const bboxCenter = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

/** قالب بلاطات صورة OAM (جاهز من الفهرس). */
export const openTileTemplate = (it) => it.tiles;

/** رابط فتح الصورة في عارض OAM الرسمي (احتياط إن منع الخادم عرض بلاطاتها داخل موقعنا). */
export const oamViewerUrl = (it) => { const c = it.bbox ? bboxCenter(it.bbox) : [0, 0]; return `https://map.openaerialmap.org/#/${c[0].toFixed(5)},${c[1].toFixed(5)},18`; };

/** بلاطة XYZ تحتوي نقطة (لفحص CORS ببلاطة حقيقية داخل تغطية الصورة). */
export function tileOf(lon, lat, z) {
  const n = 2 ** z, rad = (lat * Math.PI) / 180;
  return { x: Math.floor(((lon + 180) / 360) * n), y: Math.floor(((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n) };
}

/** أعلى مستوى تقريب تفيد عنده الصورة الأصلية (ما بعده تكبير رقمي) بحسب حجم البكسل بالمتر وخط العرض. */
export const nativeZoom = (gsd, lat) => Math.min(23, Math.max(10, Math.ceil(Math.log2((156543.03392 * Math.cos((lat * Math.PI) / 180)) / gsd))));

/** هل الصورة المفتوحة أدق من Esri في هذا الموقع؟ ref = دقة Esri المعروفة (م) أو null. */
export function verdict(gsd, ref) {
  if (!(gsd > 0)) return 'unknown';
  if (!(ref > 0)) return gsd < 0.28 ? 'better' : 'unknown'; // أفضل ما تقدمه Esri في العراق 0.3 م، فما دون 0.28 م أدق حتمًا
  return gsd < ref * 0.95 ? 'better' : gsd <= ref * 1.1 ? 'same' : 'worse';
}
export const VERDICT_LABEL = { better: '🟢 أدق من Esri', same: '⚪ مماثلة لـ Esri', worse: '🔴 أقل دقة من Esri', unknown: '⚪ الدقة غير معروفة' };
