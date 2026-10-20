// طبقات «اللقطات الحقيقية» على الخريطة (صور التقطها الناس في الأماكن نفسها):
//  • ويكيميديا كومنز: صور فوتوغرافية حرة الترخيص بإحداثيات، بلا مفتاح. تُجلب نقاطها حول مركز الخريطة (حتى 10 كم)
//    وتُجمَّع في عناقيد، وعند النقر تُجلب الصورة وبياناتها (المصوّر، التاريخ، الترخيص).
//  • Mapillary: صور شوارع مجتمعية (أكبر قاعدة صور شوارع مفتوحة). تحتاج «رمز عميل» مجانيًا؛ يلصقه صاحب الموقع في الواجهة
//    (يُحفظ في متصفحه فقط) أو يضعه في config/app.json ← mapillaryToken.
// كل ما يأتي من الشبكة يُعرض بـtextContent أو بعد تحقق من النطاق (shared/photos.js)، ولا يُستعمل innerHTML.
import {
  commonsGeoUrl, parseCommonsGeo, commonsInfoUrl, parseCommonsInfo, commonsName, photosGeoJSON, COMMONS_MAX_RADIUS,
  validMlyToken, mlyTilesUrl, mlyImageUrl, validMlyId, parseMlyImage, mlyPage,
} from '../../shared/photos.js';
import { haversine } from '../../shared/measure.js';

const EMPTY = { type: 'FeatureCollection', features: [] };
export const PHOTO_LAYERS = ['ph-cl', 'ph-cl-n', 'ph-pt', 'mly-seq', 'mly-img'];
const CLICKABLE = ['ph-cl', 'ph-pt', 'mly-img'];
const MIN_WEB_ZOOM = 11; // مستوى (256) الأدنى لجلب النقاط: أقل من ذلك يتجاوز عرض الخريطة 10 كم
const LS = 'mlyToken';

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* التخزين محجوب */ } };

export function initPhotos({ map, maplibregl, h, $, toast, cfg }) {
  let token = [lsGet(LS), cfg?.mapillaryToken].find(validMlyToken) ?? null;
  const seen = new Map();
  let on = false, mlyOn = false, ctl = null, lastKey = '', timer = 0, pop = null;
  const status = (t) => { $('#phstat').textContent = t; };

  // ---------- ويكيميديا كومنز ----------
  function ensure() {
    if (map.getSource('ph')) return;
    map.addSource('ph', { type: 'geojson', data: EMPTY, cluster: true, clusterRadius: 42, clusterMaxZoom: 16, attribution: 'Photos: Wikimedia Commons' });
    map.addLayer({ id: 'ph-cl', type: 'circle', source: 'ph', filter: ['has', 'point_count'], paint: { 'circle-color': ['step', ['get', 'point_count'], '#f59e0b', 20, '#ea580c', 100, '#be123c'], 'circle-radius': ['step', ['get', 'point_count'], 14, 20, 18, 100, 23], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'ph-cl-n', type: 'symbol', source: 'ph', filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-allow-overlap': true }, paint: { 'text-color': '#fff' } });
    map.addLayer({ id: 'ph-pt', type: 'circle', source: 'ph', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': '#f59e0b', 'circle-radius': 7, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    map.on('click', 'ph-cl', async (e) => {
      const f = e.features?.[0]; if (!f) return;
      try { const z = await map.getSource('ph').getClusterExpansionZoom(f.properties.cluster_id); map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(z + 0.5, 20), essential: true }); } catch { /* نتجاهل */ }
    });
    map.on('click', 'ph-pt', (e) => { const f = e.features?.[0]; if (f) showCommons(f.properties.title, f.geometry.coordinates.slice()); });
    for (const id of ['ph-cl', 'ph-pt']) { map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; }); map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; }); }
  }

  async function load() {
    if (!on) return;
    ensure();
    const webZoom = map.getZoom() + 1;
    if (webZoom < MIN_WEB_ZOOM) { status('قرّب الخريطة إلى مستوى مدينة (المستوى 11 فأكثر) لعرض لقطات ويكيميديا.'); return; }
    const c = map.getCenter(), b = map.getBounds();
    const r = Math.min(COMMONS_MAX_RADIUS, Math.max(500, haversine([c.lng, c.lat], [b.getEast(), b.getNorth()])));
    const key = `${c.lat.toFixed(2)},${c.lng.toFixed(2)},${Math.round(r / 1000)}`;
    if (key === lastKey) return;
    lastKey = key;
    ctl?.abort(); ctl = new AbortController();
    status('جارٍ البحث عن لقطات…');
    try {
      const res = await fetch(commonsGeoUrl(c.lat, c.lng, r), { signal: ctl.signal });
      if (!res.ok) throw new Error('http');
      for (const p of parseCommonsGeo(await res.json())) seen.set(p.id, p);
      if (seen.size > 5000) for (const k of [...seen.keys()].slice(0, seen.size - 4000)) seen.delete(k);
      map.getSource('ph')?.setData(photosGeoJSON([...seen.values()]));
      const near = [...seen.values()].filter((p) => haversine([c.lng, c.lat], [p.lon, p.lat]) <= r).length;
      status(near ? `${near} لقطة قريبة من مركز الخريطة (ويكيميديا كومنز). انقر نقطة برتقالية لعرض الصورة.` : 'لا لقطات مسجّلة هنا في ويكيميديا كومنز (تغطي المعالم والأماكن المعروفة أكثر من الأحياء). جرّب موقعًا معروفًا أو فعّل Mapillary للشوارع.');
    } catch (e) {
      if (e.name === 'AbortError') return;
      lastKey = ''; status('تعذّر جلب اللقطات الآن. تحقق من الاتصال وحاول لاحقًا.');
    }
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { load(); loadMly(); }, 700); };

  const popup = (lngLat, ...kids) => {
    pop?.remove();
    pop = new maplibregl.Popup({ maxWidth: '320px', offset: 12, closeButton: true }).setLngLat(lngLat).setDOMContent(h('div', { class: 'pop ph' }, ...kids)).addTo(map);
    return pop;
  };
  const line = (label, v) => (v ? h('div', { class: 'phl' }, h('b', {}, label + ': '), `⁨${v}⁩`) : null);
  const ext = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', class: 'phlink' }, text);

  async function showCommons(title, at) {
    popup(at, h('div', { class: 'hint' }, 'جارٍ تحميل اللقطة…'));
    try {
      const res = await fetch(commonsInfoUrl(title), { signal: AbortSignal.timeout(10000) });
      const info = res.ok ? parseCommonsInfo(await res.json()) : null;
      if (!info) throw new Error('info');
      const img = h('img', { src: info.thumb, alt: commonsName(title), class: 'phimg', loading: 'eager', referrerpolicy: 'no-referrer' });
      img.onerror = () => { img.replaceWith(h('div', { class: 'hint warn' }, 'تعذّر تحميل الصورة نفسها.')); };
      popup(at, img, h('b', { class: 'phname' }, commonsName(title)), line('التاريخ', info.date), line('المصوّر', info.artist), line('الترخيص', info.license), info.desc ? h('div', { class: 'hint' }, info.desc) : null,
        info.page ? ext(info.page, 'الصفحة الأصلية على ويكيميديا ↗') : null);
    } catch { popup(at, h('div', { class: 'hint warn' }, 'تعذّر تحميل بيانات هذه اللقطة الآن.')); }
  }

  // ---------- Mapillary (برمز عميل مجاني) ----------
  function ensureMly() {
    if (!token || map.getSource('mly')) return;
    map.addSource('mly', { type: 'vector', tiles: [mlyTilesUrl(token)], minzoom: 6, maxzoom: 14, attribution: 'Street-level: Mapillary CC BY-SA 4.0' });
    map.addLayer({ id: 'mly-seq', type: 'line', source: 'mly', 'source-layer': 'sequence', paint: { 'line-color': '#05cb63', 'line-opacity': 0.85, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 14, 3, 18, 5] } });
    map.addLayer({ id: 'mly-img', type: 'circle', source: 'mly', 'source-layer': 'image', minzoom: 14, paint: { 'circle-color': '#05cb63', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 3, 19, 8], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
    map.on('click', 'mly-img', onMlyClick);
    map.on('mouseenter', 'mly-img', onMlyEnter);
    map.on('mouseleave', 'mly-img', onMlyLeave);
  }
  const onMlyClick = (e) => { const f = e.features?.[0]; if (f) showMly(f.properties.id, e.lngLat); };
  const onMlyEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
  const onMlyLeave = () => { map.getCanvas().style.cursor = ''; };
  function dropMly() {
    map.off('click', 'mly-img', onMlyClick); map.off('mouseenter', 'mly-img', onMlyEnter); map.off('mouseleave', 'mly-img', onMlyLeave);
    for (const id of ['mly-img', 'mly-seq']) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource('mly')) map.removeSource('mly');
  }
  function loadMly() { if (mlyOn && map.getZoom() + 1 < 15) status('قرّب إلى المستوى 15 فأكثر لتظهر نقاط صور الشوارع؛ الخطوط الخضراء هي مسارات التصوير.'); }
  async function showMly(id, at) {
    if (!validMlyId(id)) return;
    popup(at, h('div', { class: 'hint' }, 'جارٍ تحميل صورة الشارع…'));
    try {
      const res = await fetch(mlyImageUrl(id, token), { signal: AbortSignal.timeout(10000) });
      const info = res.ok ? parseMlyImage(await res.json()) : null;
      if (!info) throw new Error('mly');
      const img = h('img', { src: info.thumb, alt: 'صورة شارع من Mapillary', class: 'phimg', referrerpolicy: 'no-referrer' });
      img.onerror = () => { img.replaceWith(h('div', { class: 'hint warn' }, 'تعذّر تحميل الصورة نفسها.')); };
      popup(at, img, line('التاريخ', info.date), info.pano ? h('div', { class: 'hint' }, 'صورة بانورامية 360° (افتحها في Mapillary للتدوير).') : null, h('div', { class: 'hint' }, 'Mapillary · CC BY-SA 4.0'), ext(mlyPage(id), 'افتحها في Mapillary ↗'));
    } catch { popup(at, h('div', { class: 'hint warn' }, 'تعذّر تحميل صورة الشارع. قد يكون الرمز غير صالح أو منتهيًا.')); }
  }

  // ---------- ربط الواجهة ----------
  const setVis = (ids, v) => ids.forEach((i) => map.getLayer(i) && map.setLayoutProperty(i, 'visibility', v ? 'visible' : 'none'));
  const paintMlyUi = () => {
    $('#mlytokrow').hidden = !!token; $('#mlyrow').hidden = !token;
    if (!token) { mlyOn = false; $('#mly').checked = false; }
  };
  $('#photos').onchange = (e) => {
    on = e.target.checked; ensure(); setVis(['ph-cl', 'ph-cl-n', 'ph-pt'], on);
    if (on) { lastKey = ''; load(); } else { ctl?.abort(); status(''); if (!mlyOn) pop?.remove(); }
  };
  $('#mly').onchange = (e) => { mlyOn = e.target.checked; ensureMly(); setVis(['mly-seq', 'mly-img'], mlyOn); if (mlyOn) loadMly(); else status(''); };
  $('#mlysave').onclick = () => {
    const v = $('#mlytok').value.trim();
    if (!validMlyToken(v)) { toast('الرمز غير صالح. يبدأ بـ MLY| ويحوي ثلاثة أجزاء.'); return; }
    token = v; lsSet(LS, v); $('#mlytok').value = ''; paintMlyUi(); toast('حُفظ الرمز في متصفحك فقط. فعّل «صور الشوارع».');
  };
  $('#mlyclr').onclick = () => { token = null; lsSet(LS, null); mlyOn = false; setVis(['mly-seq', 'mly-img'], false); dropMly(); paintMlyUi(); status(''); };
  paintMlyUi();
  map.on('moveend', () => { if (on || mlyOn) schedule(); });

  /** هل نقرة e فوق لقطة؟ (كي لا يعرض النقر نافذة الطقس فوق نافذة اللقطة). */
  const hit = (e) => { const layers = CLICKABLE.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none'); return layers.length > 0 && map.queryRenderedFeatures(e.point, { layers }).length > 0; };
  return { hit };
}
