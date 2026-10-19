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
// 2) صور مفتوحة (OpenAerialMap وVantor Open Data) عبر فهرس STAC الخاص بـHOT
export const OPEN_HOST = 'https://api.imagery.hotosm.org';
export const OPEN_COLLECTIONS = ['openaerialmap', 'vantor-opendata'];

const clean = (s, n = 90) => (typeof s === 'string' ? s.replace(/[\u0000-\u001F<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');
const bboxOf = (b) => (Array.isArray(b) && b.length === 4 && b.every((v) => typeof v === 'number' && Number.isFinite(v)) ? b : null);

/** يحوّل عنصر STAC إلى كائن صغير آمن. يرفض أي عنصر خارج المجموعتين أو بمعرّف غير آمن للمسار. */
export function parseOpenItem(f) {
  if (!f || typeof f.id !== 'string' || !/^[\w.-]{1,80}$/.test(f.id) || !OPEN_COLLECTIONS.includes(f.collection)) return null;
  const p = f.properties ?? {};
  return {
    id: f.id,
    collection: f.collection,
    title: clean(p.title) || f.id,
    gsd: pos(p.gsd),
    date: typeof p.datetime === 'string' && /^\d{4}-\d{2}-\d{2}/.test(p.datetime) ? p.datetime.slice(0, 10) : null,
    license: clean(p.license, 24) || null,
    kind: p['oam:platform_type'] === 'uav' ? 'uav' : 'satellite',
    producer: clean(p['oam:producer_name'] ?? p.providers?.[0]?.name, 60) || null,
    bbox: bboxOf(f.bbox),
  };
}

/** نفس استعلام STAC بصيغة GET (احتياط إن رفض المتصفح طلب POST). */
export function stacQuery(body) {
  const q = new URLSearchParams();
  if (body.collections) q.set('collections', body.collections.join(','));
  if (body.bbox) q.set('bbox', body.bbox.join(','));
  if (body.intersects) q.set('intersects', JSON.stringify(body.intersects));
  q.set('limit', String(body.limit ?? 20));
  return q.toString();
}

/** قالب بلاطات TiTiler لعنصر STAC (نفس نقطة النهاية التي يستعملها متصفح OAM). */
export const openTileTemplate = (it) => `${OPEN_HOST}/raster/collections/${it.collection}/items/${it.id}/tiles/WebMercatorQuad/{z}/{x}/{y}@1x?assets=visual`;

/** أعلى مستوى تقريب تفيد عنده الصورة الأصلية (ما بعده تكبير رقمي) بحسب حجم البكسل بالمتر وخط العرض. */
export const nativeZoom = (gsd, lat) => Math.min(23, Math.max(10, Math.ceil(Math.log2((156543.03392 * Math.cos((lat * Math.PI) / 180)) / gsd))));

/** هل الصورة المفتوحة أدق من Esri في هذا الموقع؟ ref = دقة Esri المعروفة (م) أو null. */
export function verdict(gsd, ref) {
  if (!(gsd > 0)) return 'unknown';
  if (!(ref > 0)) return gsd < 0.28 ? 'better' : 'unknown'; // أفضل ما تقدمه Esri في العراق 0.3 م، فما دون 0.28 م أدق حتمًا
  return gsd < ref * 0.95 ? 'better' : gsd <= ref * 1.1 ? 'same' : 'worse';
}
export const VERDICT_LABEL = { better: '🟢 أدق من Esri', same: '⚪ مماثلة لـ Esri', worse: '🔴 أقل دقة من Esri', unknown: '⚪ الدقة غير معروفة' };
