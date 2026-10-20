// منع ظهور بلاطة «Map data not yet available» من Esri: حيث لا تتوفر بلاطات بالتقريب المطلوب،
// نأخذ البلاطة الأعلى (الأقل تقريبًا) ونكبّر الربع المناسب منها، فتبقى صورة القمر الصناعي ظاهرة مهما قرّبت.
// نتعرّف على بلاطة «غير متاحة» لأن Esri تُرجع الصورة نفسها (بايتات متطابقة) لكل بلاطة مفقودة:
//  1) عند البدء نجلب بلاطتين في أماكن لا تغطيها صور عالية الدقة (صحراء الربع الخالي ووسط الأطلسي) بأعلى تقريب؛ إن تطابقتا فهي البلاطة البديلة.
//  2) أي بلاطة تتكرر بايتاتها تمامًا في مكانين مختلفين تُعتبر بديلة أيضًا (تعلّم تلقائي).
// ملاحظة: لم يُتحقق من الصورة البديلة الحية داخل بيئة التطوير (الشبكة محجوبة هناك)؛ الاعتماد على التطابق لا على شكل الصورة.
import { tileCoordsOf } from '../../shared/overzoom.js';

const known = new Set();      // بصمات البلاطات البديلة المؤكدة
const seen = new Map();       // بصمة ← أول إحداثيات شوهدت
const fnv = (u8) => { let h = 0x811c9dc5; for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 0x01000193); } return `${u8.length}:${h >>> 0}`; };
const MIN_Z = 12;             // لا نفحص ما دون هذا المستوى (الصور هناك متوفرة دائمًا)

async function getTile(url, signal) {
  try {
    const r = await fetch(url, { signal });
    if (!r.ok) return { missing: true };
    const buf = await r.arrayBuffer();
    return { buf, key: fnv(new Uint8Array(buf)) };
  } catch (e) { if (signal?.aborted) throw e; return { missing: true }; }
}
const isPlaceholder = (t, c) => {
  if (t.missing) return true;
  if (c.z < MIN_Z) return false;
  if (known.has(t.key)) return true;
  const first = seen.get(t.key), id = `${c.z}/${c.x}/${c.y}`;
  if (!first) { seen.set(t.key, id); if (seen.size > 400) seen.delete(seen.keys().next().value); return false; }
  if (first !== id) { known.add(t.key); return true; }
  return false;
};

export function registerOverzoom(maplibregl, ESRI_URL_PREFIX = 'esri://') {
  const probes = [[51.0, 21.0], [-35.0, 30.0]];
  const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
  const lat2y = (lat, z) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z); };
  let probing = null;
  const probe = (urlFor) => (probing ??= probeNow(urlFor));
  async function probeNow(urlFor) {
    try {
      const res = await Promise.all(probes.map(([lo, la]) => getTile(urlFor(19, lat2y(la, 19), lon2x(lo, 19)))));
      const keys = res.filter((t) => t.key).map((t) => t.key);
      if (keys.length === 2 && keys[0] === keys[1]) known.add(keys[0]);
    } catch { /* التعلّم التلقائي يكفي */ }
  }
  maplibregl.addProtocol('esri', async (params, abort) => {
    const real = params.url.slice(ESRI_URL_PREFIX.length);
    const c0 = tileCoordsOf(real);
    if (!c0) { const r = await fetch(real, { signal: abort?.signal }); return { data: await r.arrayBuffer() }; }
    const urlFor = (z, y, x) => real.replace(/\d+\/\d+\/\d+(\?.*)?$/, `${z}/${y}/${x}$1`);
    await probe(urlFor);
    const t = await getTile(real, abort?.signal);
    if (!isPlaceholder(t, c0)) return { data: t.buf };
    // ابحث عن أقرب بلاطة أعلى متوفرة وكبّر ربعها
    for (let up = 1; up <= 7 && c0.z - up >= 0; up++) {
      const z = c0.z - up, x = c0.x >> up, y = c0.y >> up;
      const p = await getTile(urlFor(z, y, x), abort?.signal);
      if (isPlaceholder(p, { z, x, y })) continue;
      const bmp = await createImageBitmap(new Blob([p.buf]));
      const size = 256, span = 2 ** up, sw = bmp.width / span, sh = bmp.height / span;
      const sx = (c0.x - (x << up)) * sw, sy = (c0.y - (y << up)) * sh;
      const cv = new OffscreenCanvas(size, size), g = cv.getContext('2d');
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(bmp, sx, sy, sw, sh, 0, 0, size, size);
      const out = await (await cv.convertToBlob({ type: 'image/jpeg', quality: 0.92 })).arrayBuffer();
      return { data: out };
    }
    return { data: t.buf ?? new ArrayBuffer(0) };
  });
}
