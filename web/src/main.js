import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { buildPlaceIndex, findPlaceInText, normalizeArabic } from '../../shared/arabic.js';

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
const imagery = layers.filter((l) => l.kind === 'imagery');
const overlays = layers.filter((l) => l.kind === 'overlay' && !/vector/i.test(l.format || ''));
const S = { layer: '__esri', date: { mode: 'latest' }, ov: new Set(), saver: false };
const log = (m) => { $('#log').textContent = m; };

// ---------- الخريطة ----------
const baseTpl = res?.base?.eox?.template ?? 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg';
const map = new maplibregl.Map({
  container: 'map', style: { version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf', sources: {}, layers: [] }, center: [dv.lon, dv.lat], zoom: dv.zoom,
  minZoom: 2, maxZoom: 20, dragRotate: false, attributionControl: false,
  maxBounds: [[-25, -4], [72, 46]],
});
map.touchZoomRotate.disableRotation();
maplibregl.setRTLTextPlugin(location.origin + '/rtl.js', true);
map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), 'bottom-right');
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

// صور JPEG اليومية بلا شفافية: يوم اليوم غير مكتمل التغطية فيظهر أسود، لذا «الأحدث» = اليوم السابق لها
const latestOf = (l) => { const d = l.latestDate || today; return l.kind === 'imagery' && /jpe?g/i.test(l.format || '') ? addDays(d, -1) : d; };
const dateFor = (l) => (S.date.mode === 'latest' ? latestOf(l) : S.date.date);
const maxz = (l) => { const m = l.maxZoom ?? 9; return S.saver && l.dataSaverMaxZoom ? Math.min(m, l.dataSaverMaxZoom) : m; };
function raster(id, l, opacity) {
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
  if (!l) return;
  map.addSource(id, { type: 'raster', tiles: [l.tileTemplate.replace('{time}', dateFor(l))], tileSize: 256, maxzoom: maxz(l) });
  map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': opacity, 'raster-fade-duration': 150 } }, map.getLayer('road-case') ? 'road-case' : undefined);
}
function applyMap() {
  if (!map.isStyleLoaded() && !map.getSource('base')) return;
  raster('img', EXT[S.layer] ?? imagery.find((l) => l.id === S.layer), 1);
  for (const o of overlays) raster('ov-' + o.id, S.ov.has(o.id) ? o : null, 0.75);
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
function addVec() {
  map.addSource('omt', { type: 'vector', url: 'https://tiles.openfreemap.org/planet' });
  VEC.forEach((l) => map.addLayer(l));
}
const setNames = (on) => VEC.forEach((l) => map.getLayer(l.id) && map.setLayoutProperty(l.id, 'visibility', on ? 'visible' : 'none'));
map.on('load', () => {
  map.addSource('base', { type: 'raster', tiles: [baseTpl], tileSize: 256, maxzoom: 13 });
  map.addLayer({ id: 'base', type: 'raster', source: 'base' });
  addVec();
  applyMap();
  setNames($('#names').checked);
});
map.on('zoom', () => document.body.classList.toggle('far', map.getZoom() < 6.5));
map.on('error', (e) => { if (e?.error?.status === 404) return; });

// ---------- الواجهة ----------
const S2 = '__s2', ESRI = '__esri';
const CLR = '__clarity';
const EXT = {
  [ESRI]: { id: ESRI, kind: 'base', maxZoom: 19, tileTemplate: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', note: 'صور عالية الدقة (أقل من متر في المدن). ليست صور اليوم، وتاريخ التصوير يختلف من منطقة لأخرى.' },
  [CLR]: { id: CLR, kind: 'base', maxZoom: 19, tileTemplate: 'https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', note: 'أرشيف Esri «Clarity»: صور أنقى وأقل ظلالًا وغيومًا، وقد تكون أقدم (نسخة تجريبية).' },
};
function hint() {
  const l = imagery.find((x) => x.id === S.layer);
  const z = map.getZoom(), native = EXT[S.layer] ? 19 : l ? maxz(l) : 13;
  $('#zhint').textContent = z > native + 0.6 ? (EXT[S.layer] ? 'هذا أقصى تقريب متاح للصور في هذه المنطقة.' : l ? `تجاوزت أقصى دقة لهذه الطبقة (${l.resolution_m} م) فتبدو الصورة مكبّرة. لتفاصيل أدق اختر «HLS 30 م» أو «Sentinel-2 10 م».` : 'تجاوزت أقصى دقة للخلفية (≈10 م)؛ الصورة مكبّرة.') : '';
}
map.on('zoomend', hint);
function refreshUI() {
  const l = imagery.find((x) => x.id === S.layer);
  $('#layer').value = S.layer ?? '';
  $('#date').value = S.date.mode === 'latest' ? (l ? latestOf(l) : today) : S.date.date;
  $('#date').max = today;
  $('#saver').checked = S.saver;
  document.querySelectorAll('#overlays input').forEach((i) => (i.checked = S.ov.has(i.dataset.id)));
  hint();
  $('#linfo').textContent = EXT[S.layer] ? EXT[S.layer].note : S.layer === S2 ? 'خلفية Sentinel-2 بلا غيوم، دقة 10 م (مركّب سنوي، وليست صورة اليوم).' : l ? [l.resolution_m && `دقة ${l.resolution_m} م`, l.latency && `التأخر: ${l.latency}`, l.status === 'no_recent_tile' && '⚠ لا بلاطة حديثة',
    /jpe?g/i.test(l.format || '') && S.date.mode === 'latest' && 'الأحدث = أمس لاكتمال التغطية (صورة اليوم تظهر ناقصة)',
    l.patchy && 'صور 30 م ليست متاحة كل يوم لكل مكان؛ جرّب تاريخًا آخر.'].filter(Boolean).join(' · ') : 'لا توجد طبقات متاحة حاليًا.';
}
const sync = () => { refreshUI(); applyMap(); };
const setDate = (d) => { S.date = d; sync(); };

$('#layer').append(h('option', { value: ESRI }, 'أدق صور (Esri · أقل من متر)'), h('option', { value: CLR }, 'أدق صور – أرشيف أنقى (Clarity)'), h('option', { value: S2 }, 'Sentinel-2 بلا غيوم (10 م · سنوي)'), ...imagery.map((l) => h('option', { value: l.id }, l.title_ar + (l.status === 'no_recent_tile' ? ' ⚠' : ''))));
$('#layer').onchange = (e) => { S.layer = e.target.value; sync(); };
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
$('#eox').textContent = res?.base?.eox?.attribution ?? 'EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data)';
$('#eox').append(' · الخرائط والأسماء: OpenFreeMap © OpenMapTiles، بيانات OpenStreetMap · الصور عالية الدقة: Esri, Maxar, Earthstar Geographics, and the GIS User Community');

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
function renderWx(title, cur, day, text) {
  const [em, desc] = WMO(cur.weather_code ?? 0);
  const r = (v) => (typeof v === 'number' ? Math.round(v) : '–');
  const days = (day?.time ?? []).slice(0, 7).map((t, i) => h('div', {}, h('b', {}, new Intl.DateTimeFormat('ar', { weekday: 'short', timeZone: 'UTC' }).format(new Date(t + 'T00:00:00Z'))), WMO(day.code[i])[0], h('br'), `${r(day.tmax[i])}°`, h('br'), h('b', {}, `${r(day.tmin[i])}°`)));
  $('#wx').replaceChildren(h('h3', {}, 'الطقس: ' + title),
    h('div', { class: 'now' }, h('span', { class: 'e' }, em), h('span', { class: 't' }, `${r(cur.temperature_2m)}°`),
      h('span', { class: 'hint' }, `${desc}\nمحسوسة ${r(cur.apparent_temperature)}° · رطوبة ${r(cur.relative_humidity_2m)}%\nرياح ${r(cur.wind_speed_10m)} م/ث`)),
    text ? h('div', { class: 'hint' }, text) : null, h('div', { class: 'days' }, days));
  document.body.classList.add('open');
}
function showCity(c) {
  const w = wx?.cities?.find((x) => x.id === c.id);
  if (w?.current) return renderWx(c.ar, w.current, w.daily, summary?.cities?.[c.id]?.text);
  showPoint(c.lat, c.lon, c.ar);
}
const cache = new Map();
async function showPoint(lat, lon, title = 'الموقع المحدد') {
  const key = lat.toFixed(2) + ',' + lon.toFixed(2);
  let hit = cache.get(key);
  if (!hit || Date.now() - hit.t > 6e5) {
    $('#wx').replaceChildren(h('h3', {}, 'الطقس'), h('div', { class: 'hint' }, 'جارٍ التحميل…'));
    try {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&wind_speed_unit=ms&timezone=auto&forecast_days=7`;
      const r = await (await fetch(u)).json();
      hit = { t: Date.now(), cur: r.current, day: { time: r.daily.time, code: r.daily.weather_code, tmax: r.daily.temperature_2m_max, tmin: r.daily.temperature_2m_min } };
      if (!hit.cur) throw 0;
      cache.set(key, hit);
    } catch { $('#wx').replaceChildren(h('h3', {}, 'الطقس'), h('div', { class: 'hint warn' }, 'تعذّر جلب الطقس لهذه النقطة الآن.')); return; }
  }
  renderWx(title, hit.cur, hit.day);
}
const mobile = () => innerWidth <= 760;
const sheet = (on) => document.body.classList.toggle('open', on);
// على الجوال: النقر على الخريطة والقائمة مفتوحة يغلقها فقط، وإن كانت مغلقة يعرض طقس النقطة
map.on('click', (e) => { if (mobile() && document.body.classList.contains('open')) return sheet(false); showPoint(e.lngLat.lat, e.lngLat.lng); });
map.on('dragstart', () => mobile() && sheet(false));
addEventListener('keydown', (e) => e.key === 'Escape' && sheet(false));
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
$('#presets').append(...(await getJSON('/data/config/presets.json'))?.presets?.map((p) => h('button', { onclick: () => fly(p.lat, p.lon, p.zoom) }, p.ar)) ?? []);

// ---------- المساعد ----------
function run(a) {
  switch (a.type) {
    case 'fly_to': fly(a.lat, a.lon, a.zoom); return true;
    case 'set_layer': if (!imagery.some((l) => l.id === a.id)) return false; S.layer = a.id; sync(); return true;
    case 'set_date': setDate(a.date); return true;
    case 'toggle_overlay': if (!overlays.some((o) => o.id === a.id)) return false; a.on ? S.ov.add(a.id) : S.ov.delete(a.id); sync(); return true;
    case 'open_weather': { const c = cityById[a.cityId]; fly(a.lat, a.lon, 9); c ? showCity(c) : showPoint(a.lat, a.lon); return true; }
    case 'animate': animate(a.days); return true;
    case 'data_saver': S.saver = !!a.on; sync(); return true;
    case 'reset': S.date = { mode: 'latest' }; S.ov.clear(); S.layer = imagery[0]?.id; sync(); fly(dv.lat, dv.lon, dv.zoom); return true;
    default: return false;
  }
}
const OVL = [[/غبار|عجاج|هباء/, 'aerosol-aod'], [/حرارة سطح/, 'lst-day'], [/نبات|زراع|ndvi/, 'ndvi-8day']];
const LYR = [[/viirs|فيرس/, 'viirs-noaa20'], [/مودس|modis/, 'modis-terra'], [/تفصيل|hls|30 م/, 'hls-s30']];
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
  const l = imagery.find((x) => x.id === S.layer) ?? imagery[0];
  if (!l) return log('اختر طبقة صور يومية أولًا.');
  if (EXT[S.layer] || S.layer === S2) S.layer = l.id;
  const base = latestOf(l); let i = Math.min(7, Math.max(2, days));
  log(`تحريك آخر ${i} أيام…`);
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

refreshUI();
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
