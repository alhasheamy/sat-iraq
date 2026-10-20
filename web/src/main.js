import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@fontsource/tajawal/arabic-400.css';
import '@fontsource/tajawal/arabic-500.css';
import '@fontsource/tajawal/arabic-700.css';
import './style.css';
import { buildPlaceIndex, findPlaceInText, normalizeArabic } from '../../shared/arabic.js';
import { metaQueryUrl, parseMeta, rankBest, metaLine, digitalZoom, bestSummary, parseOamResponse, oamMetaUrl, oamViewerUrl, tileOf, bboxCenter, IRAQ_BBOX, openTileTemplate, nativeZoom, verdict, VERDICT_LABEL, fmtRes, isoDate, bidi } from '../../shared/imagery.js';
import { pathLength, polygonArea, fmtLen, fmtArea, geodist, midpoint, precisionNote } from '../../shared/measure.js';
import { initPhotos } from './photos.js';
import { registerOverzoom } from './overzoom.js';
registerOverzoom(maplibregl);

const $ = (s) => document.querySelector(s);
const h = (t, a = {}, ...k) => {
  const e = document.createElement(t);
  for (const [x, v] of Object.entries(a)) x === 'class' ? (e.className = v) : x.startsWith('on') ? e.addEventListener(x.slice(2), v) : e.setAttribute(x, v);
  e.append(...k.flat().filter((v) => v != null));
  return e;
};
const getJSON = async (p) => { try { const r = await fetch(p); if (!r.ok) throw 0; return await r.json(); } catch { return null; } };
const today = new Date().toISOString().slice(0, 10);
const addDays = (iso, d) => { const x = new Date(iso + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const LV = { normal: 'عادي', high: 'مرتفع', severe: 'شديد' };
const WMO = (c) => c === 0 ? ['☀️', 'صحو'] : c <= 2 ? ['🌤️', 'غائم جزئيًا'] : c === 3 ? ['☁️', 'غائم'] : c <= 48 ? ['🌫️', 'ضباب'] : c <= 57 ? ['🌦️', 'رذاذ'] : c <= 67 ? ['🌧️', 'مطر'] : c <= 77 ? ['❄️', 'ثلج'] : c <= 82 ? ['🌧️', 'زخات'] : ['⛈️', 'عاصفة رعدية'];

const [meta, res, summary, wx, cfg, cityCfg] = await Promise.all(
  ['meta', 'layers.resolved', 'summary', 'cities-weather', 'config/app', 'config/cities'].map((n) => getJSON(`/data/${n}.json`)));
const bbox = cfg?.bbox ?? { west: 24, south: 12, east: 64, north: 42 };
const dv = cfg?.defaultView ?? { lat: 33, lon: 43.7, zoom: 5.6 };
const cities = cityCfg?.cities ?? [];
const cityById = Object.fromEntries(cities.map((c) => [c.id, c]));
const placeIdx = buildPlaceIndex(cities);
const layers = (res?.layers ?? []).filter((l) => l.status !== 'unavailable');
// طبقات GIBS هنا بيانات فقط (غبار/حرارة/نبات/حرائق). كل صور القاعدة من Esri (راجع srcDef).
const overlays = layers.filter((l) => l.kind === 'overlay' && !/vector/i.test(l.format || ''));
const S = { layer: 'esri', cmp: null, date: { mode: 'latest' }, ov: new Set(), saver: false, sharp: true, enh: false, auto: false, nativeRes: null, nativeAcc: null };
const ENH = { 'raster-contrast': 0.12, 'raster-saturation': 0.08 }; // تحسين اختياري: تباين وتشبّع فقط، لا يضيف تفاصيل
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* التخزين محجوب */ } };
const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2200); };
const extra = ((await getJSON('/data/config/extra-imagery.json'))?.sources ?? []).filter((e) => e.id && /^https:\/\//.test(e.tiles || '') && ['{z}', '{x}', '{y}'].every((t) => e.tiles.includes(t)));
const wbParse = (j) => Object.entries(j).map(([n, v]) => ({ n: +n, d: /(\d{4}-\d{2}-\d{2})/.exec(v.itemTitle || '')?.[1], m: /services\/([^/]+)\/MapServer/.exec(v.metadataLayerUrl || '')?.[1] })).filter((x) => x.n && x.d).sort((a, b) => b.d.localeCompare(a.d));
let wb = (await getJSON('/data/wayback.json'))?.items ?? [];
// نسخة قديمة بلا اسم خدمة الدقة (m) أو قائمة فارغة: نقرأ قائمة Esri مباشرة
if (!wb.length || !wb[0].m) wb = await fetch('https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json', { signal: AbortSignal.timeout(8000) }).then((r) => r.json()).then(wbParse).catch(() => wb);
const oamSrc = new Map();
let map2 = null, m2ready = false, ready = false, mOn = false, t3 = false;
const log = (m) => { $('#log').textContent = m; };

// ---------- الخريطة ----------
// خلفية داكنة تظهر لحظة التحميل فقط. كل الصور من Esri، ولا تُعرض أي صور أقل دقة منها.
const BG = { id: 'bg', type: 'background', paint: { 'background-color': '#0b1b2b' } };
const map = new maplibregl.Map({
  container: 'map', hash: 'v', style: { version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf', sources: {}, layers: [BG] }, center: [dv.lon, dv.lat], zoom: dv.zoom,
  minZoom: 2, maxZoom: 19, maxPitch: 75, maxTileCacheSize: 300, dragRotate: false, attributionControl: false,
  maxBounds: [[-28, -18], [68, 44]],
});
map.touchZoomRotate.disableRotation();
maplibregl.setRTLTextPlugin(location.origin + '/rtl.js', true);
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), 'bottom-right');
map.addControl(new maplibregl.FullscreenControl({ container: document.body }), 'bottom-right');
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

// تاريخ «الأحدث» لطبقة بيانات (غبار/حرارة/نبات): آخر بلاطة فحصها خط البيانات، وإلا اليوم
const latestOf = (l) => l.latestDate || today;
const dateFor = (l) => (S.date.mode === 'latest' ? latestOf(l) : S.date.date);
const maxz = (l) => { const m = l.maxZoom ?? 9; return S.saver && l.dataSaverMaxZoom ? Math.min(m, l.dataSaverMaxZoom) : m; };
const ESRI_ATTR = 'Esri, Maxar, Earthstar Geographics, and the GIS User Community';
function raster(id, l, opacity, m = map) {
  if (m.getLayer(id)) m.removeLayer(id);
  if (m.getSource(id)) m.removeSource(id);
  if (!l) return;
  const tpl = (l.retina && S.sharp ? l.tileTemplate.replace('@1x', '@2x') : l.tileTemplate).replace('{time}', dateFor(l));
  m.addSource(id, { type: 'raster', tiles: [tpl], tileSize: l.sharp && S.sharp ? 128 : 256, maxzoom: maxz(l), ...(l.scheme === 'tms' ? { scheme: 'tms' } : {}), ...(l.bounds ? { bounds: l.bounds } : {}), attribution: l.attribution ?? (l.gibsId ? 'NASA GIBS/ESDIS' : '') });
  m.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': opacity, 'raster-fade-duration': 150, ...(S.enh && id.startsWith('img') ? ENH : {}) } }, m.getLayer('road-case') ? 'road-case' : undefined);
}
// مصدر محلي التغطية (درون/أرشيف خاص) يُعرض فوق Esri كي لا تبقى الخريطة فارغة خارج حدوده
function stack(m, id, key) {
  const d = srcDef(key);
  raster(id + '-under', d.local ? srcDef('esri') : null, 1, m);
  raster(id, d, 1, m);
}
function applyMap() {
  if (!ready) return;
  stack(map, 'img', S.layer);
  for (const o of overlays) raster('ov-' + o.id, S.ov.has(o.id) ? o : null, 0.75);
  if (map2 && m2ready && S.cmp) stack(map2, 'img2', S.cmp);
  hint();
}
const NAME = ['coalesce', ['get', 'name:ar'], ['get', 'name']];
const TXT = { 'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-max-width': 8 };
const HALO = { 'text-color': '#fff', 'text-halo-color': 'rgba(0,0,0,.85)', 'text-halo-width': 1.6 };
const zi = (...a) => ['interpolate', ['linear'], ['zoom'], ...a];
const cls = (...c) => ['match', ['get', 'class'], c, true, false];
const place = (id, c, min, max, size, color = '#fff') => ({ id, type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: min, maxzoom: max, filter: ['==', ['get', 'class'], c], layout: { ...TXT, 'text-size': size, 'symbol-sort-key': ['get', 'rank'] }, paint: { ...HALO, 'text-color': color } });
const VEC = [
  { id: 'bnd', type: 'line', source: 'omt', 'source-layer': 'boundary', filter: ['<=', ['get', 'admin_level'], 4], paint: { 'line-color': '#fff', 'line-opacity': 0.75, 'line-dasharray': [3, 2], 'line-width': zi(2, 0.5, 10, 1.6) } },
  { id: 'road-case', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 8, filter: cls('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'), layout: { 'line-cap': 'round' }, paint: { 'line-color': 'rgba(0,0,0,.55)', 'line-width': zi(8, 1.2, 14, 4, 18, 14) } },
  { id: 'road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12, filter: cls('tertiary', 'minor', 'service'), paint: { 'line-color': '#fff', 'line-opacity': 0.8, 'line-width': zi(12, 0.4, 14, 1.4, 18, 8) } },
  { id: 'road-major', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 6, filter: cls('motorway', 'trunk', 'primary', 'secondary'), paint: { 'line-color': '#ffd166', 'line-width': zi(6, 0.6, 12, 2, 18, 10) } },
  { id: 'water-n', type: 'symbol', source: 'omt', 'source-layer': 'water_name', minzoom: 3, layout: { ...TXT, 'text-size': 12 }, paint: { ...HALO, 'text-color': '#9be3ff' } },
  place('p-country', 'country', 2, 7, zi(2, 13, 6, 19), '#ffe08a'),
  place('p-state', 'state', 4, 9, zi(4, 11, 8, 15), '#ffe9a8'),
  place('p-city', 'city', 4, 14, zi(4, 12, 10, 19)),
  place('p-town', 'town', 7, 15, zi(7, 11, 12, 15)),
  place('p-village', 'village', 10, 17, zi(10, 11, 14, 14)),
  { ...place('p-suburb', 'suburb', 11, 18, zi(11, 11, 15, 14), '#e8f4ff'), filter: cls('suburb', 'quarter', 'neighbourhood', 'hamlet') },
  { id: 'road-n', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 12, layout: { ...TXT, 'symbol-placement': 'line', 'text-size': zi(12, 10, 18, 14) }, paint: HALO },
];
// مباني ثلاثية الأبعاد من طبقة building في OpenMapTiles (OpenFreeMap): render_height محسوب من height أو building:levels وإلا افتراضي
const B3D = { id: 'bld3d', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 14, layout: { visibility: 'none' }, filter: ['!=', ['get', 'hide_3d'], true],
  paint: { 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 5], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.85, 'fill-extrusion-vertical-gradient': true,
    'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 5], 0, '#f1f5f9', 15, '#dbe4ee', 40, '#b7c4d4', 100, '#8da0b8', 250, '#64748b'] } };
function addVec() {
  map.addSource('omt', { type: 'vector', url: 'https://tiles.openfreemap.org/planet' });
  VEC.forEach((l) => map.addLayer(l));
  map.addLayer(B3D, 'water-n'); // تحت النصوص كي لا تغطيها المباني
}
const setNames = (on) => [map, map2].forEach((m) => m && VEC.forEach((l) => m.getLayer(l.id) && m.setLayoutProperty(l.id, 'visibility', on ? 'visible' : 'none')));
map.on('load', () => {
  addVec();
  ready = true;
  applyMap();
  setNames($('#names').checked);
});
map.on('zoom', () => document.body.classList.toggle('far', map.getZoom() < 6.5));
{ let n = 0, t0 = 0, oamWarn = 0; // تنبيه واحد بدل سيل أخطاء عند تعذّر البلاطات
  map.on('error', (e) => {
    const st = e?.error?.status, now = Date.now();
    if (e?.sourceId === 'dem' && st !== 404 && st !== 204 && demFailed()) return;
    if (st === 404 || st === 204) return;
    if (S.layer.startsWith('oam:') && st >= 400) { if (now - oamWarn > 15000) { oamWarn = now; toast('تعذّر تحميل بلاطات هذه الصورة المفتوحة. اختر Esri من قائمة المصدر.'); } return; }
    if (now - t0 > 10000) { t0 = now; n = 0; }
    if (++n === 12) toast('تعذّر تحميل بعض بلاطات الصور. تحقق من الاتصال أو غيّر المصدر.');
  });
}

// ---------- الواجهة ----------
const ESRI = 'esri://https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const CLAR = 'esri://https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const WBU = (n) => `esri://https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${n}/{z}/{y}/{x}`;
const srcDef = (k) => {
  if (k === 'esri') return { id: 'esri', maxZoom: 19, sharp: true, tileTemplate: ESRI, name: 'Esri World Imagery', attribution: ESRI_ATTR };
  if (k === 'clarity') return { id: 'clarity', maxZoom: 19, sharp: true, tileTemplate: CLAR, name: 'Esri Clarity', attribution: ESRI_ATTR };
  if (k?.startsWith('wb:')) return { id: k, maxZoom: 19, sharp: true, tileTemplate: WBU(k.slice(3)), name: 'Wayback ' + (wb.find((x) => 'wb:' + x.n === k)?.d ?? ''), attribution: ESRI_ATTR + ' · Esri Wayback' };
  if (k?.startsWith('x:')) { const e = extra.find((x) => 'x:' + x.id === k); if (e) return { id: k, maxZoom: e.maxZoom ?? 20, tileTemplate: e.tiles, scheme: e.scheme, bounds: e.bounds, attribution: e.attribution, name: e.title_ar, local: true }; }
  if (k?.startsWith('oam:') && oamSrc.has(k)) return oamSrc.get(k);
  return srcDef('esri');
};
const mpp = () => 156543.03392 * Math.cos((map.getCenter().lat * Math.PI) / 180) / 2 ** (map.getZoom() + 1);
const hint = () => {
  const d = srcDef(S.layer), over = map.getZoom() + 1 > (d.maxZoom ?? 9) + 0.05;
  const dz = S.nativeRes && (S.layer === 'esri' || S.layer.startsWith('wb:')) ? digitalZoom(S.nativeRes, mpp()) : null;
  $('#zhint').textContent = dz > 1 ? `تكبير رقمي ×${dz}: دقة الصورة الأصلية هنا ${fmtRes(S.nativeRes)} بينما تعرض الشاشة ${fmtRes(mpp())} لكل بكسل، فتبدو مشوّشة. هذا حد المصدر وليس عطلًا.${$('#bestbtn').hidden ? '' : ' جرّب «🎯 أدق صورة هنا»: قد يوجد إصدار أدق في أرشيف Esri.'}`
    : over ? 'تكبير رقمي: الصورة الأصلية لا تزيد دقة عن هذا الحد، وما بعده مجرد تكبير للبكسلات.' : '';
};
const hud = () => { const c = map.getCenter(), m = mpp(); $('#hud').textContent = `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)} · z${(map.getZoom() + 1).toFixed(1)} · ≈${m < 1 ? m.toFixed(2) : m < 100 ? m.toFixed(1) : Math.round(m)} م/بكسل`; };
map.on('move', hud); hud();
$('#hud').onclick = async () => { try { await navigator.clipboard.writeText(location.href); toast('تم نسخ رابط الموقع'); } catch { toast('انسخ الرابط من شريط العنوان'); } };
$('#hud').onkeydown = (e) => e.key === 'Enter' && $('#hud').click();
map.on('zoomend', hint);
function refreshUI() {
  const first = overlays.find((o) => S.ov.has(o.id)) ?? overlays[0];
  $('#date').value = S.date.mode === 'latest' ? (first ? latestOf(first) : today) : S.date.date;
  $('#date').max = today;
  $('#saver').checked = S.saver;
  document.querySelectorAll('#overlays input').forEach((i) => (i.checked = S.ov.has(i.dataset.id)));
  hint();
}
const sync = () => { refreshUI(); applyMap(); };
const setDate = (d) => { S.date = d; sync(); };

$('#date').onchange = (e) => e.target.value && e.target.value <= today && setDate({ mode: 'date', date: e.target.value });
$('#prev').onclick = () => setDate({ mode: 'date', date: addDays($('#date').value || today, -1) });
$('#next').onclick = () => { const d = addDays($('#date').value || today, 1); d <= today ? setDate({ mode: 'date', date: d }) : setDate({ mode: 'latest' }); };
$('#latest').onclick = () => setDate({ mode: 'latest' });
$('#saver').onchange = (e) => { S.saver = e.target.checked; sync(); };
$('#overlays').append(...overlays.map((o) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', 'data-id': o.id, onchange: (e) => { e.target.checked ? S.ov.add(o.id) : S.ov.delete(o.id); sync(); } }), o.title_ar)));
if (!overlays.length) $('#overlays').textContent = 'لا توجد طبقات إضافية متاحة.';
$('#names').onchange = (e) => setNames(e.target.checked);
$('#wind').onchange = (e) => (e.target.checked ? startWind() : stopWind());
$('#anim').onclick = () => animate(7);
$('#menu').onclick = () => document.body.classList.toggle('open');

// حالة البيانات والغبار
if (meta?.generatedAt) {
  const hrs = (Date.now() - new Date(meta.generatedAt)) / 36e5;
  const stale = hrs > (meta.staleWarnHours ?? 9);
  $('#fresh').textContent = `آخر تحديث للبيانات: قبل ${hrs < 1 ? 'أقل من ساعة' : Math.round(hrs) + ' ساعة'}${stale ? ' ⚠ البيانات قديمة' : ''}`;
  $('#fresh').className = stale ? 'warn' : '';
} else $('#fresh').textContent = 'تعذّر تحميل حالة البيانات؛ قد تكون بيانات الطقس غير متاحة مؤقتًا.';
const d = summary?.iraqDust;
if (d) { $('#dust').textContent = `الغبار: ${LV[d.level] ?? d.level}${d.city ? ' · ' + d.city : ''}`; $('#dust').className = 'chip ' + d.level; } else $('#dust').remove();

// ---------- الطقس ----------
let pop;
const wxSet = (...kids) => { const w = $('#wx'); w.open = true; w.replaceChildren(h('summary', {}, 'الطقس'), ...kids); };
function renderWx(title, cur, day, text, at) {
  const [em, desc] = WMO(cur.weather_code ?? 0);
  const r = (v) => (typeof v === 'number' ? Math.round(v) : '–');
  const days = (day?.time ?? []).slice(0, 7).map((t, i) => h('div', {}, h('b', {}, new Intl.DateTimeFormat('ar', { weekday: 'short', timeZone: 'UTC' }).format(new Date(t + 'T00:00:00Z'))), WMO(day.code[i])[0], h('br'), `${r(day.tmax[i])}°`, h('br'), h('b', {}, `${r(day.tmin[i])}°`)));
  wxSet(h('h3', {}, 'الطقس: ' + title),
    h('div', { class: 'now' }, h('span', { class: 'e' }, em), h('span', { class: 't' }, `${r(cur.temperature_2m)}°`),
      h('span', { class: 'hint' }, `${desc}\nمحسوسة ${r(cur.apparent_temperature)}° · رطوبة ${r(cur.relative_humidity_2m)}%\nرياح ${r(cur.wind_speed_10m)} م/ث`)),
    text ? h('div', { class: 'hint' }, text) : null, h('div', { class: 'days' }, days));
  if (at) {
    pop?.remove();
    pop = new maplibregl.Popup({ offset: 14, closeButton: true, maxWidth: '220px' }).setLngLat(at)
      .setDOMContent(h('div', { class: 'pop' }, h('b', {}, title), h('div', { class: 'pt' }, em + ' ' + r(cur.temperature_2m) + '° · ' + desc),
        h('button', { onclick: () => { sheet(true); pop.remove(); } }, 'التفاصيل والأسبوع'))).addTo(map);
  }
}
function showCity(c) {
  const w = wx?.cities?.find((x) => x.id === c.id);
  if (w?.current) return renderWx(c.ar, w.current, w.daily, summary?.cities?.[c.id]?.text, [c.lon, c.lat]);
  showPoint(c.lat, c.lon, c.ar);
}
const cache = new Map();
async function showPoint(lat, lon, title = 'الموقع المحدد') {
  const key = lat.toFixed(2) + ',' + lon.toFixed(2);
  let hit = cache.get(key);
  if (!hit || Date.now() - hit.t > 6e5) {
    wxSet(h('div', { class: 'hint' }, 'جارٍ التحميل…'));
    try {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&wind_speed_unit=ms&timezone=auto&forecast_days=7`;
      const r = await (await fetch(u)).json();
      hit = { t: Date.now(), cur: r.current, day: { time: r.daily.time, code: r.daily.weather_code, tmax: r.daily.temperature_2m_max, tmin: r.daily.temperature_2m_min } };
      if (!hit.cur) throw 0;
      cache.set(key, hit);
    } catch { wxSet(h('div', { class: 'hint warn' }, 'تعذّر جلب الطقس لهذه النقطة الآن.')); return; }
  }
  renderWx(title, hit.cur, hit.day, null, [lon, lat]);
}
const mobile = () => innerWidth <= 760;
const sheet = (on) => document.body.classList.toggle('open', on);
// على الجوال: النقر على الخريطة والقائمة مفتوحة يغلقها فقط، وإن كانت مغلقة يعرض طقس النقطة
map.on('click', (e) => { if (mOn || photos?.hit(e)) return; if (mobile() && document.body.classList.contains('open')) return sheet(false); showPoint(e.lngLat.lat, e.lngLat.lng); });
map.on('dragstart', () => mobile() && sheet(false));
addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; sheet(false); if (mOn) setMeas(false); });
// السحب للأسفل لإغلاق القائمة (من المقبض، أو من أعلى المحتوى)
{ const side = $('#side'); let y0 = null, dy = 0;
  side.addEventListener('touchstart', (e) => { if (mobile() && (e.target.closest('#grab') || side.scrollTop <= 0)) { y0 = e.touches[0].clientY; dy = 0; } }, { passive: true });
  side.addEventListener('touchmove', (e) => { if (y0 == null) return; dy = e.touches[0].clientY - y0; if (dy > 0) { side.style.transition = 'none'; side.style.transform = `translateY(${dy}px)`; } else { side.style.transform = ''; y0 = null; } }, { passive: true });
  side.addEventListener('touchend', () => { if (y0 == null) return; side.style.transition = ''; side.style.transform = ''; if (dy > 70) sheet(false); y0 = null; }); }

// المدن والعلامات
const fly = (lat, lon, zoom = 9) => map.flyTo({ center: [lon, lat], zoom, essential: true, padding: { bottom: mobile() && document.body.classList.contains('open') ? innerHeight * 0.5 : 0, top: 0, left: 0, right: 0 } });
for (const c of cities) {
  const el = h('div', { class: 'pin' + (c.iraqGov ? '' : ' minor') }, h('i'), c.ar);
  el.onclick = (e) => { e.stopPropagation(); showCity(c); };
  new maplibregl.Marker({ element: el, anchor: 'left' }).setLngLat([c.lon, c.lat]).addTo(map);
}
$('#cities').append(...cities.filter((c) => c.iraqGov).map((c) => {
  const lv = summary?.cities?.[c.id]?.dustLevel;
  const t = wx?.cities?.find((x) => x.id === c.id)?.current?.temperature_2m;
  return h('button', { class: 'city', onclick: () => { fly(c.lat, c.lon, 10); showCity(c); } }, h('span', {}, c.ar), h('span', {}, typeof t === 'number' ? `${Math.round(t)}° ` : '', lv && lv !== 'normal' ? h('span', { class: 'badge ' + lv }, 'غبار ' + (LV[lv] ?? lv)) : null));
}));
$('#presets').append(h('button', { onclick: () => fly(24, 22, 3.2) }, 'الوطن العربي'), ...(await getJSON('/data/config/presets.json'))?.presets?.map((p) => h('button', { onclick: () => fly(p.lat, p.lon, p.zoom) }, p.ar)) ?? []);

// ---------- المساعد ----------
const ESRI_IDS = ['esri', 'clarity'];
function run(a) {
  switch (a.type) {
    case 'fly_to': fly(a.lat, a.lon, a.zoom); return true;
    case 'set_layer': { if (!ESRI_IDS.includes(a.id)) return false; setSrc(a.id); return true; }
    case 'compare': { const A = a.a?.layer, B = a.b?.layer; if (!ESRI_IDS.includes(A) || !ESRI_IDS.includes(B)) return false; setSrc(A); if (map2) { S.cmp = B; $('#srcB').value = B; info(); sync(); } else cmpOn(B); return true; }
    case 'set_date': setDate(a.date); return true;
    case 'toggle_overlay': if (!overlays.some((o) => o.id === a.id)) return false; a.on ? S.ov.add(a.id) : S.ov.delete(a.id); sync(); return true;
    case 'open_weather': { const c = cityById[a.cityId]; fly(a.lat, a.lon, 9); c ? showCity(c) : showPoint(a.lat, a.lon); return true; }
    case 'animate': animate(a.days); return true;
    case 'data_saver': S.saver = !!a.on; sync(); return true;
    case 'reset': S.date = { mode: 'latest' }; S.ov.clear(); sync(); fly(dv.lat, dv.lon, dv.zoom); return true;
    default: return false;
  }
}
const OVL = [[/غبار|عجاج|هباء/, 'aerosol-aod'], [/حرارة سطح/, 'lst-day'], [/نبات|زراع|ndvi/, 'ndvi-8day']];
const LYR = [[/clarity|كلاريتي/, 'clarity'], [/esri|ايسري|اسري|الافتراضي/, 'esri']];
function localParse(text) {
  const n = normalizeArabic(text), acts = [], city = findPlaceInText(text, placeIdx);
  const off = /(اخف|اغلق|الغ|ايقاف|بدون)/.test(n);
  for (const [re, id] of OVL) if (re.test(n)) acts.push({ type: 'toggle_overlay', id, on: !off });
  for (const [re, id] of LYR) if (re.test(n)) acts.push({ type: 'set_layer', id });
  if (/امس/.test(n)) acts.push({ type: 'set_date', date: { mode: 'date', date: addDays(today, -1) } });
  else if (/احدث|اليوم/.test(n)) acts.push({ type: 'set_date', date: { mode: 'latest' } });
  if (/حرك|تحريك|انيميشن/.test(n)) acts.push({ type: 'animate', days: +(n.match(/\d+/)?.[0] ?? 5) });
  if (/توفير/.test(n)) acts.push({ type: 'data_saver', on: !off });
  if (/اعاده|ابدا من جديد|reset/.test(n)) acts.push({ type: 'reset' });
  if (city) acts.push(/طقس|حراره|درجه|مطر/.test(n) ? { type: 'open_weather', lat: city.lat, lon: city.lon, cityId: city.id } : { type: 'fly_to', lat: city.lat, lon: city.lon, zoom: 10 });
  return acts.length ? { reply: 'تم.', actions: acts } : null;
}
const ERR = { rate_limited: 'تجاوزت الحد المسموح من الطلبات. حاول بعد قليل.', daily_cap: 'استُنفد سقف المساعد لهذا اليوم. تعمل الأوامر البسيطة محليًا فقط.', ai_unavailable: 'المساعد الذكي غير متاح الآن. تعمل الأوامر البسيطة محليًا فقط.' };
$('#ask').onsubmit = async (e) => {
  e.preventDefault();
  const text = $('#q').value.trim().slice(0, 200);
  if (!text) return;
  const local = localParse(text);
  if (local) { local.actions.forEach(run); log(local.reply); return; }
  log('جارٍ التفكير…');
  try {
    const c = map.getCenter();
    const r = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ text, state: { lat: c.lat, lon: c.lng, zoom: map.getZoom(), layer: S.layer, date: S.date.mode === 'latest' ? 'latest' : S.date.date, overlays: [...S.ov] } }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) { log(ERR[j.error] ?? 'تعذّر الاتصال بالمساعد. جرّب: أرني البصرة · الغبار · أمس · طقس أربيل'); return; }
    const done = (j.actions ?? []).map(run).filter(Boolean).length;
    log((j.reply || (done ? 'تم.' : 'لم أفهم الطلب.')) + ((j.actions?.length ?? 0) > done ? '\n(بعض الأوامر لم تُدعَم بعد في هذه النسخة.)' : ''));
  } catch { log('تعذّر الاتصال بالمساعد. تعمل الأوامر البسيطة محليًا: أرني البصرة · الغبار · أمس · طقس أربيل'); }
};

// ---------- تحريك الأيام ----------
let anim;
function animate(days) {
  clearInterval(anim);
  const o = overlays.find((x) => S.ov.has(x.id));
  if (!o) return log('فعّل طبقة إضافية (غبار، حرارة، نباتات) ثم اضغط التحريك.');
  const base = latestOf(o); let i = Math.min(7, Math.max(2, days));
  log(`تحريك آخر ${i} أيام للطبقة: ${o.title_ar}`);
  anim = setInterval(() => { setDate({ mode: 'date', date: addDays(base, -i) }); if (--i < 0) { clearInterval(anim); S.date = { mode: 'latest' }; sync(); } }, 1600);
}

// ---------- جسيمات الرياح ----------
let windRaf = 0;
async function startWind() {
  const g = await getJSON('/data/grid/wind.json');
  if (!g?.u) { $('#wind').checked = false; return log('بيانات الرياح غير متاحة حاليًا.'); }
  const cv = $('#windcv'), ctx = cv.getContext('2d'), { west, north, step, nx, ny } = g.grid, sc = g.scale || 1;
  let ti = 0; g.times.forEach((t, i) => { if (Math.abs(new Date(t) - Date.now()) < Math.abs(new Date(g.times[ti]) - Date.now())) ti = i; });
  const U = g.u[ti], V = g.v[ti];
  const v = (a, i, j) => (a[j * nx + i] === g.nodata ? 0 : a[j * nx + i] / sc);
  const samp = (lat, lon) => {
    const fx = (lon - west) / step, fy = (north - lat) / step;
    if (fx < 0 || fy < 0 || fx >= nx - 1 || fy >= ny - 1) return null;
    const i = fx | 0, j = fy | 0, dx = fx - i, dy = fy - j;
    const b = (a) => v(a, i, j) * (1 - dx) * (1 - dy) + v(a, i + 1, j) * dx * (1 - dy) + v(a, i, j + 1) * (1 - dx) * dy + v(a, i + 1, j + 1) * dx * dy;
    return [b(U), b(V)];
  };
  const size = () => { cv.width = innerWidth; cv.height = innerHeight; };
  size(); cv.style.display = 'block';
  const P = Array.from({ length: 1400 }, () => ({ age: 0 }));
  const spawn = (p) => { const b = map.getBounds(); p.lon = b.getWest() + Math.random() * (b.getEast() - b.getWest()); p.lat = b.getSouth() + Math.random() * (b.getNorth() - b.getSouth()); p.age = 40 + Math.random() * 80; };
  P.forEach(spawn);
  const clear = () => ctx.clearRect(0, 0, cv.width, cv.height);
  map.on('movestart', clear); addEventListener('resize', size);
  cancelAnimationFrame(windRaf);
  (function frame() {
    ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = 'rgba(0,0,0,.07)'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.globalCompositeOperation = 'source-over'; ctx.lineWidth = 1.3;
    const F = 900 * Math.pow(2, 5.6 - map.getZoom());
    for (const p of P) {
      const w = samp(p.lat, p.lon);
      if (!w || --p.age < 0) { spawn(p); continue; }
      const a = map.project([p.lon, p.lat]);
      p.lon += (w[0] * F) / (111320 * Math.cos((p.lat * Math.PI) / 180)); p.lat += (w[1] * F) / 111320;
      const b = map.project([p.lon, p.lat]), sp = Math.hypot(w[0], w[1]);
      ctx.strokeStyle = sp > 12 ? 'rgba(255,120,90,.9)' : sp > 6 ? 'rgba(255,230,120,.85)' : 'rgba(255,255,255,.75)';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    windRaf = requestAnimationFrame(frame);
  })();
}
function stopWind() { cancelAnimationFrame(windRaf); const cv = $('#windcv'); cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); cv.style.display = 'none'; }

// ---------- مصدر الصورة والمقارنة والبحث ----------
const opt = (v, t) => h('option', { value: v }, t);
const xOpt = (e) => opt('x:' + e.id, '📍 ' + e.title_ar);
$('#src').append(opt('esri', 'Esri World Imagery (الأدق · افتراضي)'), opt('clarity', 'Esri Clarity (أرشيف أوضح أحيانًا)'), ...(wb.length ? [opt('wb', 'Esri Wayback (أرشيف بتواريخ)')] : []), ...extra.map(xOpt));
$('#wbsel').append(...wb.map((x) => opt('wb:' + x.n, x.d)));
$('#srcB').append(opt('esri', 'Esri الحالي'), opt('clarity', 'Esri Clarity'), ...wb.map((x) => opt('wb:' + x.n, 'Wayback ' + x.d)), ...extra.map(xOpt));
function info() {
  const d = srcDef(S.layer);
  $('#srcinfo').textContent = d.attribution ? 'المصدر: ' + d.attribution : '';
  $('#la').textContent = d.name; $('#lb').textContent = S.cmp ? srcDef(S.cmp).name : '';
}
function setSrc(k) {
  S.layer = k; const w = k.startsWith('wb:'), d = srcDef(k);
  map.setMaxZoom(Math.max(19, d.maxZoom ?? 19));
  if (d.bounds) { const c = map.getCenter(), b = d.bounds; if (c.lng < b[0] || c.lng > b[2] || c.lat < b[1] || c.lat > b[3]) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, maxZoom: 17 }); }
  $('#src').value = w ? 'wb' : k; $('#wbsel').hidden = !w; if (w) $('#wbsel').value = k;
  info(); sync(); scheduleMeta();
}
$('#src').onchange = (e) => (e.target.value === 'wb' ? setSrc('wb:' + ($('#wbsel').value || wb[0].n)) : setSrc(e.target.value));
$('#wbsel').onchange = (e) => setSrc(e.target.value);
$('#sharp').onchange = (e) => { S.sharp = e.target.checked; sync(); };
$('#srcB').onchange = (e) => { S.cmp = e.target.value; info(); sync(); };
const cmpEl = $('#cmp'); let cmpMove;
const setP = (v) => { v = Math.min(95, Math.max(5, v)); document.body.style.setProperty('--p', v + '%'); cmpEl.setAttribute('aria-valuenow', Math.round(v)); };
function cmpOn(b) {
  if (t3) set3D(false);
  S.cmp = b ?? (S.layer === 'esri' ? 'clarity' : 'esri'); $('#srcB').value = S.cmp; m2ready = false;
  document.body.classList.add('cmp'); cmpEl.hidden = $('#cmplab').hidden = $('#cmpbox').hidden = false; $('#cmpbtn').setAttribute('aria-pressed', 'true'); setP(50);
  map2 = new maplibregl.Map({ container: 'map2', style: { version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf', sources: {}, layers: [BG] }, center: map.getCenter(), zoom: map.getZoom(), minZoom: 2, maxZoom: 24, interactive: false, attributionControl: false });
  cmpMove = () => map2.jumpTo({ center: map.getCenter(), zoom: map.getZoom() });
  map.on('move', cmpMove);
  map2.on('load', () => { m2ready = true; map2.addSource('omt', { type: 'vector', url: 'https://tiles.openfreemap.org/planet' }); VEC.forEach((l) => map2.addLayer(l)); setNames($('#names').checked); applyMap(); });
  info();
}
function cmpOff() {
  map.off('move', cmpMove); map2?.remove(); map2 = null; m2ready = false; S.cmp = null;
  document.body.classList.remove('cmp'); cmpEl.hidden = $('#cmplab').hidden = $('#cmpbox').hidden = true; $('#cmpbtn').setAttribute('aria-pressed', 'false'); info();
}
$('#cmpbtn').onclick = () => (map2 ? cmpOff() : cmpOn());
cmpEl.addEventListener('pointerdown', (e) => {
  cmpEl.setPointerCapture(e.pointerId);
  const mv = (ev) => setP((ev.clientX / innerWidth) * 100), up = () => { cmpEl.removeEventListener('pointermove', mv); cmpEl.removeEventListener('pointerup', up); };
  cmpEl.addEventListener('pointermove', mv); cmpEl.addEventListener('pointerup', up);
});
cmpEl.addEventListener('keydown', (e) => { const p = parseFloat(document.body.style.getPropertyValue('--p')) || 50; if (e.key === 'ArrowLeft') setP(p - 3); else if (e.key === 'ArrowRight') setP(p + 3); });

let pin;
const goPlace = (p) => {
  $('#gres').classList.remove('on'); pin?.remove();
  pin = new maplibregl.Marker({ color: '#ef4444' }).setLngLat([p.lon, p.lat]).addTo(map);
  p.bb ? map.fitBounds(p.bb, { maxZoom: 17, padding: 40, essential: true }) : fly(p.lat, p.lon, 16);
  if (mobile()) sheet(false);
};
const parseLL = (q) => { const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,،\s]\s*(-?\d+(?:\.\d+)?)\s*$/); return m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180 ? { lat: +m[1], lon: +m[2] } : null; };
async function geocode(q) {
  const c = map.getCenter();
  try {
    const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw 0;
    const f = (await r.json()).features ?? [];
    if (f.length) return f.map(({ properties: p, geometry: g }) => ({ name: [p.name, p.street, p.district, p.city ?? p.county, p.state, p.country].filter((x, i, a) => x && a.indexOf(x) === i).join('، '), lon: g.coordinates[0], lat: g.coordinates[1], bb: p.extent ? [[p.extent[0], p.extent[3]], [p.extent[2], p.extent[1]]] : null }));
  } catch { /* نكمل بالاحتياطي */ }
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=ar&q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(8000) });
  return (await r.json()).map((x) => ({ name: x.display_name, lat: +x.lat, lon: +x.lon, bb: x.boundingbox ? [[+x.boundingbox[2], +x.boundingbox[0]], [+x.boundingbox[3], +x.boundingbox[1]]] : null }));
}
$('#geo').onsubmit = async (e) => {
  e.preventDefault();
  const q = $('#gq').value.trim(), box = $('#gres');
  if (!q) return;
  const ll = parseLL(q); if (ll) return goPlace(ll);
  box.classList.add('on'); box.replaceChildren(h('div', { class: 'none' }, 'جارٍ البحث…'));
  try {
    const rs = await geocode(q);
    box.replaceChildren(...(rs.length ? rs.map((p) => h('button', { type: 'button', role: 'option', onclick: () => goPlace(p) }, p.name)) : [h('div', { class: 'none' }, 'لا نتائج. جرّب اسمًا آخر أو أضف اسم المدينة.')]));
  } catch { box.replaceChildren(h('div', { class: 'none warn' }, 'تعذّر البحث الآن. تحقق من الاتصال وحاول لاحقًا.')); }
};

let dip;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); dip = e; $('#install').hidden = false; });
$('#install').onclick = async () => { dip?.prompt(); await dip?.userChoice; dip = null; $('#install').hidden = true; };
map.once('idle', () => { $('#splash')?.classList.add('off'); setTimeout(() => $('#splash')?.remove(), 700); });
setTimeout(() => $('#splash')?.classList.add('off'), 6000);
map.on('dataloading', () => $('#load').classList.add('on')); map.on('idle', () => $('#load').classList.remove('on'));

// ---------- الدقة الفعلية للصورة وأدق إصدار في أرشيف Wayback (خدمة بيانات Esri) ----------
const mcache = new Map();
const metaBase = (m) => `https://metadata.maptiles.arcgis.com/arcgis/rest/services/${m}/MapServer`;
async function metaAt(m, lon, lat, z, signal) {
  const key = `${m}|${lon.toFixed(4)},${lat.toFixed(4)}|${z}`;
  if (mcache.has(key)) return mcache.get(key);
  const r = await fetch(metaQueryUrl(metaBase(m), lon, lat, z), { signal });
  if (!r.ok) throw new Error('meta');
  const v = parseMeta(await r.json());
  if (mcache.size > 600) mcache.clear();
  mcache.set(key, v);
  return v;
}
let mt, mAbort, scan;
async function showMeta() {
  const el = $('#imeta'), k = S.layer, z = Math.round(map.getZoom() + 1);
  const it = k === 'esri' ? wb[0] : k.startsWith('wb:') ? wb.find((x) => 'wb:' + x.n === k) : null;
  if (!it?.m || z < 10) { el.textContent = ''; S.nativeRes = null; S.nativeAcc = null; hint(); return; }
  mAbort?.abort(); mAbort = new AbortController();
  const c = map.getCenter();
  try {
    const v = await metaAt(it.m, c.lng, c.lat, z, mAbort.signal);
    el.textContent = metaLine(v) + (v && k === 'esri' ? ' (أحدث إصدار Esri)' : '');
    S.nativeRes = v?.res ?? null; S.nativeAcc = v?.acc ?? null; hint();
  } catch (e) { if (e.name !== 'AbortError') { el.textContent = ''; S.nativeRes = null; S.nativeAcc = null; hint(); } }
}
const scheduleMeta = () => { clearTimeout(mt); mt = setTimeout(showMeta, 600); };
map.on('moveend', scheduleMeta); map.once('idle', scheduleMeta);

// يفحص كل إصدارات الأرشيف عند مركز الخريطة ويعرض الأدق (أصغر متر/بكسل) ثم الأحدث
async function findBest() {
  const items = wb.filter((x) => x.m), box = $('#best'), c = map.getCenter();
  if (!items.length) { box.replaceChildren(h('div', { class: 'none warn' }, 'قائمة الأرشيف غير متاحة الآن.')); return; }
  scan?.abort(); const sc = (scan = new AbortController());
  const rows = [], st = h('div', { class: 'none' }, 'جارٍ فحص إصدارات الأرشيف…');
  box.replaceChildren(st);
  let i = 0, done = 0;
  const work = async () => {
    while (i < items.length && !sc.signal.aborted) {
      const it = items[i++];
      try { const v = await metaAt(it.m, c.lng, c.lat, 19, sc.signal); if (v) rows.push({ ...v, n: it.n, rel: it.d }); } catch { /* نتجاوز إصدارًا تعذّر فحصه */ }
      if (++done % 8 === 0) st.textContent = `جارٍ فحص إصدارات الأرشيف ${done}/${items.length}`;
    }
  };
  await Promise.all(Array.from({ length: 6 }, work));
  if (sc.signal.aborted) return;
  const top = rankBest(rows).slice(0, 6);
  let cur = null; try { cur = await metaAt(items[0].m, c.lng, c.lat, 19, sc.signal); } catch { /* اختياري */ }
  const finer = (r) => cur?.res != null && r.res != null && r.res < cur.res * 0.95;
  box.replaceChildren(h('div', { class: 'sum' }, bestSummary(top, cur)), ...top.map((r) => h('button', { type: 'button', class: finer(r) ? 'better' : '', onclick: () => setSrc('wb:' + r.n) },
    `${fmtRes(r.res)} · ${bidi([r.provider, r.sensor].filter(Boolean).join(' ') || 'مصدر غير معروف')} · ${r.date ? isoDate(r.date) : 'بلا تاريخ'} · إصدار ${isoDate(r.rel)}`)));
}
$('#bestbtn').onclick = findBest;
if (!wb.some((x) => x.m)) $('#bestbtn').hidden = true;

// ---------- صور مفتوحة (OpenAerialMap): تُعرض فوق Esri بطلب المستخدم أو بتنبيه إن كانت أدق ----------
async function oamSearch(bbox, limit = 100) {
  const r = await fetch(oamMetaUrl(bbox, limit), { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error('oam');
  return parseOamResponse(await r.json());
}
// نختبر بلاطة حقيقية داخل تغطية الصورة قبل التبديل: إن منع الخادم الطلب (CORS) أو تعذّر الوصول نخبر المستخدم بدل شاشة فارغة
async function probeOam(it) {
  const c = it.bbox ? bboxCenter(it.bbox) : [map.getCenter().lng, map.getCenter().lat];
  const z = Math.min(17, it.gsd ? nativeZoom(it.gsd, c[1]) : 17), t = tileOf(c[0], c[1], z);
  try { const r = await fetch(it.tiles.replace('{z}', z).replace('{x}', t.x).replace('{y}', t.y), { mode: 'cors', signal: AbortSignal.timeout(10000) }); return r.ok ? 'ok' : 'http'; }
  catch { return 'blocked'; }
}
async function useOpen(it) {
  const key = 'oam:' + it.id, c0 = it.bbox ? bboxCenter(it.bbox) : [map.getCenter().lng, map.getCenter().lat];
  toast('جارٍ تجهيز الصورة المفتوحة…');
  if ((await probeOam(it)) === 'blocked') {
    log('تعذّر الوصول إلى بلاطات هذه الصورة من الموقع (قد يمنعها خادمها أو الاتصال غير متاح). يمكنك فتحها في عارض OpenAerialMap الرسمي.');
    $('#oam').replaceChildren(h('a', { href: oamViewerUrl(it), target: '_blank', rel: 'noopener noreferrer', class: 'phlink' }, `افتح «${bidi(it.title)}» في عارض OpenAerialMap ↗`));
    return;
  }
  oamSrc.set(key, { id: key, local: true, maxZoom: it.gsd ? nativeZoom(it.gsd, c0[1]) : 20, tileTemplate: openTileTemplate(it), bounds: it.bbox ?? undefined,
    attribution: `OpenAerialMap/HOT · ${it.license ?? 'CC BY 4.0'}${it.producer ? ' · ' + it.producer : ''}`, name: '🛩️ ' + it.title });
  for (const sel of ['#src', '#srcB']) if (![...$(sel).options].some((o) => o.value === key)) $(sel).append(opt(key, '🛩️ ' + it.title.slice(0, 60)));
  setSrc(key);
  if (it.bbox) map.fitBounds([[it.bbox[0], it.bbox[1]], [it.bbox[2], it.bbox[3]]], { padding: 40, maxZoom: 19, essential: true });
}
const openRow = (it, ref, from) => {
  const v = verdict(it.gsd, ref), km = from && it.bbox ? geodist(from, bboxCenter(it.bbox)) / 1000 : null;
  return h('button', { type: 'button', class: v === 'better' ? 'better' : '', onclick: () => useOpen(it) },
    [VERDICT_LABEL[v], it.gsd ? fmtRes(it.gsd) : null, it.kind === 'uav' ? 'درون' : 'قمر', it.date ? isoDate(it.date) : null, bidi(it.title), km != null ? `يبعد ${km < 10 ? km.toFixed(1) : Math.round(km)} كم` : null].filter(Boolean).join(' · '));
};
async function findOpen() {
  const box = $('#oam'), b = map.getBounds();
  if (map.getZoom() + 1 < 9) { box.replaceChildren(h('div', { class: 'none' }, 'قرّب الخريطة إلى مدينة أو موقع محدد أولًا (مستوى تقريب 9 فأكثر)، أو اضغط «كل مواقع الدرون في العراق».')); return; }
  box.replaceChildren(h('div', { class: 'none' }, 'جارٍ البحث في OpenAerialMap…'));
  try {
    const its = (await oamSearch([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])).sort((x, y) => (x.gsd ?? 1e9) - (y.gsd ?? 1e9)).slice(0, 12);
    const ref = S.nativeRes;
    box.replaceChildren(...(its.length ? [h('div', { class: 'sum' }, ref ? `دقة Esri هنا ${fmtRes(ref)}. الأدق أولًا:` : 'الأدق أولًا:'), ...its.map((it) => openRow(it, ref))]
      : [h('div', { class: 'none' }, 'لا توجد صور مفتوحة تغطي هذا العرض. جرّب «كل مواقع الدرون في العراق» لترى أين تتوفر.')]));
  } catch { box.replaceChildren(h('div', { class: 'none warn' }, 'تعذّر الوصول إلى فهرس الصور المفتوحة الآن.')); }
}
let iraqOpen = null;
async function listIraqOpen() {
  const box = $('#oam');
  box.replaceChildren(h('div', { class: 'none' }, 'جارٍ جلب مواقع الدرون المسجّلة في العراق…'));
  try {
    iraqOpen ??= (await oamSearch(IRAQ_BBOX)).filter((x) => x.bbox);
    const c = map.getCenter(), from = [c.lng, c.lat], ref = S.nativeRes;
    const its = [...iraqOpen].sort((x, y) => geodist(from, bboxCenter(x.bbox)) - geodist(from, bboxCenter(y.bbox)));
    const best = Math.min(...its.map((x) => x.gsd ?? 1e9));
    box.replaceChildren(...(its.length ? [h('div', { class: 'sum' }, `${its.length} صورة مفتوحة مسجّلة في العراق${best < 1e9 ? `، أدقها ${fmtRes(best)}` : ''}. الأقرب إلى مركز الخريطة أولًا (تغطي كل صورة موقعًا صغيرًا، وغالبًا مواقع أثرية):`), ...its.slice(0, 25).map((it) => openRow(it, ref, from))]
      : [h('div', { class: 'none' }, 'لا توجد صور مفتوحة مسجّلة في العراق حاليًا.')]));
  } catch { box.replaceChildren(h('div', { class: 'none warn' }, 'تعذّر الوصول إلى فهرس الصور المفتوحة الآن.')); }
}
$('#oambtn').onclick = findOpen;
$('#oamall').onclick = listIraqOpen;

// تنبيه عند وجود صورة أدق من Esri في مركز الخريطة، بزر «اعرضها» (لا يغيّر المصدر الافتراضي Esri من تلقاء نفسه):
//  1) مصدر محلي في config/extra-imagery.json مُعلَّم "preferred": true (بلا أي طلب شبكي)
//  2) صور OpenAerialMap إن فعّل المستخدم «التنبيه» (استعلام بنقطة المركز فقط)
const chip = $('#oamchip'), autoSeen = new Map();
let autoT, autoLast = 0, autoSkip = 0, chipGo = null;
const hideChip = () => { chip.hidden = true; chipGo = null; };
const showChip = (text, go) => { chipGo = go; chip.querySelector('span').textContent = text; chip.hidden = false; };
const inBox = (c, b) => c.lng >= b[0] && c.lng <= b[2] && c.lat >= b[1] && c.lat <= b[3];
async function autoOpen() {
  if (mOn || map.getZoom() + 1 < 15) return hideChip();
  const c = map.getCenter();
  const loc = extra.find((e) => e.preferred === true && Array.isArray(e.bounds) && e.bounds.length === 4 && inBox(c, e.bounds) && 'x:' + e.id !== S.layer);
  if (loc) return showChip(`🟢 صورة أدق من Esri متاحة هنا: ${bidi(loc.title_ar)}`, () => setSrc('x:' + loc.id));
  if (!S.auto) return hideChip();
  if (Date.now() < autoSkip) return;
  const key = `${c.lng.toFixed(3)},${c.lat.toFixed(3)}`;
  let items = autoSeen.get(key);
  if (!items) {
    if (Date.now() - autoLast < 6000) return;
    autoLast = Date.now();
    try { const e = 1e-4; items = await oamSearch([c.lng - e, c.lat - e, c.lng + e, c.lat + e], 20); autoSeen.set(key, items); }
    catch { autoSkip = Date.now() + 60000; return; }
  }
  const best = items.filter((it) => verdict(it.gsd, S.nativeRes) === 'better' && 'oam:' + it.id !== S.layer).sort((x, y) => x.gsd - y.gsd)[0];
  if (!best) return hideChip();
  showChip(`🟢 صورة مفتوحة أدق من Esri هنا: ${bidi(best.title)} (${fmtRes(best.gsd)})`, () => useOpen(best));
}
const scheduleAuto = () => { clearTimeout(autoT); autoT = setTimeout(autoOpen, 1200); };
S.auto = lsGet('autoOpen') != null ? lsGet('autoOpen') === '1' : cfg?.openImagery?.autoDetect === true;
$('#autoopen').checked = S.auto;
$('#autoopen').onchange = (e) => { S.auto = e.target.checked; lsSet('autoOpen', S.auto ? '1' : '0'); scheduleAuto(); };
$('#oamgo').onclick = () => { const g = chipGo; hideChip(); g?.(); };
$('#oamx').onclick = hideChip;
map.on('moveend', scheduleAuto);

// ---------- أدوات: 3D (تضاريس + مبانٍ) وقياس جيوديسي وحفظ صورة وتحسين الوضوح ----------
// مصدران للارتفاعات (ترميز Terrarium): AWS Open Data ثم Mapterhorn احتياطًا إن فشل الأول (حجب/CORS).
const DEMS = [
  { tiles: ['https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 15, attribution: 'Terrain: Mapzen/AWS Open Data' },
  { tiles: ['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'], tileSize: 512, maxzoom: 14, attribution: 'Terrain: Mapterhorn' },
];
let demIx = 0;
const exag = () => +$('#exag').value || 1.3;
function addDem(i) {
  if (map.getSource('dem')) { map.setTerrain(null); map.removeSource('dem'); }
  map.addSource('dem', { type: 'raster-dem', encoding: 'terrarium', ...DEMS[i] });
}
function demFailed() {
  if (!t3 || demIx >= DEMS.length - 1) return false;
  demIx++; addDem(demIx); map.setTerrain({ source: 'dem', exaggeration: exag() });
  toast('تعذّر مصدر الارتفاعات الأول؛ جرّبنا مصدرًا احتياطيًا.');
  return true;
}
const applyB3D = () => map.getLayer('bld3d') && map.setLayoutProperty('bld3d', 'visibility', t3 && $('#b3d').checked ? 'visible' : 'none');
const SKY = { 'sky-color': '#7db6ff', 'horizon-color': '#dbeafe', 'fog-color': '#e8f1ff', 'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.2 };
function set3D(on) {
  if (on && map2) cmpOff();
  t3 = on; $('#t3d').setAttribute('aria-pressed', String(on)); $('#d3opts').hidden = !on;
  if (on) { if (!map.getSource('dem')) addDem(demIx); map.setTerrain({ source: 'dem', exaggeration: exag() }); try { map.setSky(SKY); } catch { /* نسخة بلا سماء */ } }
  else map.setTerrain(null);
  applyB3D();
  on ? map.dragRotate.enable() : map.dragRotate.disable();
  map.easeTo({ pitch: on ? 60 : 0, bearing: on ? map.getBearing() : 0, duration: 800 });
  if (on && map.getZoom() + 1 < 15) toast('قرّب إلى مستوى الأحياء (15 فأكثر) لتظهر المباني ثلاثية الأبعاد.');
}
$('#t3d').onclick = () => set3D(!t3);
$('#b3d').onchange = applyB3D;
$('#exag').oninput = () => { $('#exagv').textContent = exag().toFixed(1) + '×'; if (t3 && map.getSource('dem')) map.setTerrain({ source: 'dem', exaggeration: exag() }); };

// قياس: خطوط جيوديسية على WGS84 (shared/measure.js). الإحداثيات من نقرة المستخدم، والدقة العملية يحددها حجم البكسل ودقة الصورة.
let mp = [], mArea = false, mCur = null, mRaf = 0;
function ensureMeas() {
  if (map.getSource('meas')) return;
  map.addSource('meas', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const f = (t) => ['==', ['get', 'k'], t];
  map.addLayer({ id: 'meas-fill', type: 'fill', source: 'meas', filter: f('poly'), paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.25 } });
  map.addLayer({ id: 'meas-line', type: 'line', source: 'meas', filter: f('line'), paint: { 'line-color': '#ffd166', 'line-width': 3 } });
  map.addLayer({ id: 'meas-prev', type: 'line', source: 'meas', filter: f('prev'), paint: { 'line-color': '#ffd166', 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.9 } });
  map.addLayer({ id: 'meas-pt', type: 'circle', source: 'meas', filter: f('pt'), paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': '#ef4444', 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'meas-lbl', type: 'symbol', source: 'meas', filter: f('lbl'), layout: { 'text-field': ['get', 't'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-allow-overlap': true, 'text-offset': [0, -0.9] }, paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(0,0,0,.85)', 'text-halo-width': 1.6 } });
}
const measText = (pts) => (mArea
  ? (pts.length < 3 ? 'انقر ثلاث نقاط على الأقل لحساب المساحة' : `المساحة: ${fmtArea(polygonArea(pts))} · المحيط: ${fmtLen(pathLength(pts, true))}`)
  : (pts.length < 2 ? 'انقر على الخريطة لإضافة نقاط القياس' : `المسافة: ${fmtLen(pathLength(pts))}${pts.length > 2 ? ` · ${pts.length - 1} مقاطع` : ''}`));
function drawMeas() {
  ensureMeas();
  const pts = mCur && mp.length ? [...mp, mCur] : mp, feats = [];
  const seg = (a, b, k) => { feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [a, b] }, properties: { k } }); feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: midpoint(a, b) }, properties: { k: 'lbl', t: fmtLen(geodist(a, b)) } }); };
  mp.forEach((c) => feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { k: 'pt' } }));
  for (let i = 1; i < mp.length; i++) seg(mp[i - 1], mp[i], 'line');
  if (mArea && mp.length > 2) seg(mp[mp.length - 1], mp[0], 'line');
  if (mCur && mp.length) { seg(mp[mp.length - 1], mCur, 'prev'); if (mArea && mp.length > 1) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [mCur, mp[0]] }, properties: { k: 'prev' } }); }
  if (mArea && pts.length > 2) feats.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] }, properties: { k: 'poly' } });
  map.getSource('meas').setData({ type: 'FeatureCollection', features: feats });
  $('#mval').textContent = measText(mp);
  $('#mnote').textContent = precisionNote(mpp(), S.nativeAcc) + (t3 ? ' المسافات أفقية (لا تحسب انحدار التضاريس).' : '');
  $('#mmode').setAttribute('aria-pressed', String(mArea)); $('#mmode').textContent = mArea ? '↔ مسافة' : '▱ مساحة';
}
function setMeas(on) {
  mOn = on; mp = []; mCur = null; mArea = false;
  $('#meas').setAttribute('aria-pressed', String(on)); $('#mres').hidden = !on; map.getCanvas().style.cursor = on ? 'crosshair' : '';
  on ? map.doubleClickZoom.disable() : map.doubleClickZoom.enable();
  if (on || map.getSource('meas')) drawMeas();
  if (on && mobile()) sheet(false);
}
$('#meas').onclick = () => setMeas(!mOn);
$('#mend').onclick = () => setMeas(false);
$('#mclr').onclick = () => { mp = []; mCur = null; drawMeas(); };
const measUndo = () => { mp.pop(); mCur = null; drawMeas(); };
$('#mundo').onclick = measUndo;
$('#mmode').onclick = () => { mArea = !mArea; drawMeas(); };
$('#mcopy').onclick = async () => { try { await navigator.clipboard.writeText($('#mval').textContent); toast('تم نسخ النتيجة'); } catch { toast('تعذّر النسخ من هذا المتصفح'); } };
map.on('click', (e) => { if (!mOn) return; mp.push([e.lngLat.lng, e.lngLat.lat]); drawMeas(); });
map.on('mousemove', (e) => { if (!mOn || !mp.length) return; mCur = [e.lngLat.lng, e.lngLat.lat]; if (!mRaf) mRaf = requestAnimationFrame(() => { mRaf = 0; if (mOn) drawMeas(); }); });
addEventListener('keydown', (e) => { if (!mOn || e.target.closest?.('input,textarea,select')) return; if (e.key === 'Backspace' || e.key === 'Delete' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')) { e.preventDefault(); measUndo(); } });
map.on('zoomend', () => { if (mOn) drawMeas(); });

$('#enh').onchange = (e) => {
  S.enh = e.target.checked;
  for (const [m, id] of [[map, 'img'], [map, 'img-under'], [map2, 'img2'], [map2, 'img2-under']]) if (m?.getLayer(id)) for (const [p, v] of Object.entries(ENH)) m.setPaintProperty(id, p, S.enh ? v : 0);
};
$('#shot').onclick = () => {
  map.once('render', () => {
    try {
      const src = map.getCanvas(), cv = document.createElement('canvas'), k = devicePixelRatio || 1, d = srcDef(S.layer);
      cv.width = src.width; cv.height = src.height;
      const x = cv.getContext('2d');
      x.drawImage(src, 0, 0);
      x.fillStyle = 'rgba(0,0,0,.6)'; x.fillRect(0, cv.height - 26 * k, cv.width, 26 * k);
      x.fillStyle = '#fff'; x.font = `${Math.round(12 * k)}px Tajawal, sans-serif`;
      x.fillText(`${d.name} · ${$('#hud').textContent} · ${d.attribution ?? ESRI_ATTR} · © OpenStreetMap`, 10 * k, cv.height - 9 * k);
      cv.toBlob((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `iraq-sat-${Date.now()}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); });
    } catch { toast('تعذّر حفظ الصورة من هذا المتصفح.'); }
  });
  map.triggerRepaint();
};

// أقسام الشريط الجانبي: نتذكر المطوي والمفتوح
document.querySelectorAll('details.sec').forEach((d) => { const k = 'sec:' + d.id, v = lsGet(k); if (v != null) d.open = v === '1'; d.addEventListener('toggle', () => lsSet(k, d.open ? '1' : '0')); });
const photos = initPhotos({ map, maplibregl, h, $, toast, cfg });
info();
refreshUI();
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
