import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@fontsource/tajawal/arabic-400.css';
import '@fontsource/tajawal/arabic-500.css';
import '@fontsource/tajawal/arabic-700.css';
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
const S = { layer: 'esri', cmp: null, date: { mode: 'latest' }, ov: new Set(), saver: false, sharp: true };
const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2200); };
const extra = ((await getJSON('/data/config/extra-imagery.json'))?.sources ?? []).filter((e) => e.id && /^https:\/\//.test(e.tiles || '') && ['{z}', '{x}', '{y}'].every((t) => e.tiles.includes(t)));
const wb = ((await getJSON('/data/wayback.json'))?.items) ?? await fetch('https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json', { signal: AbortSignal.timeout(8000) }).then((r) => r.json()).then((j) => Object.entries(j).map(([n, v]) => ({ n: +n, d: /(\d{4}-\d{2}-\d{2})/.exec(v.itemTitle || '')?.[1] })).filter((x) => x.d).sort((a, b) => b.d.localeCompare(a.d))).catch(() => []);
let map2 = null;
const log = (m) => { $('#log').textContent = m; };

// ---------- الخريطة ----------
const baseTpl = res?.base?.eox?.template ?? 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg';
const map = new maplibregl.Map({
  container: 'map', hash: 'v', style: { version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf', sources: {}, layers: [] }, center: [dv.lon, dv.lat], zoom: dv.zoom,
  minZoom: 2, maxZoom: 19, dragRotate: false, attributionControl: false,
  maxBounds: [[-28, -18], [68, 44]],
});
map.touchZoomRotate.disableRotation();
maplibregl.setRTLTextPlugin(location.origin + '/rtl.js', true);
map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), 'bottom-right');
map.addControl(new maplibregl.FullscreenControl({ container: document.body }), 'bottom-right');
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

// صور JPEG اليومية بلا شفافية: يوم اليوم غير مكتمل التغطية فيظهر أسود، لذا «الأحدث» = اليوم السابق لها
const latestOf = (l) => { const d = l.latestDate || today; return l.kind === 'imagery' && /jpe?g/i.test(l.format || '') ? addDays(d, -1) : d; };
const dateFor = (l) => (S.date.mode === 'latest' ? latestOf(l) : S.date.date);
const maxz = (l) => { const m = l.maxZoom ?? 9; return S.saver && l.dataSaverMaxZoom ? Math.min(m, l.dataSaverMaxZoom) : m; };
function raster(id, l, opacity, m = map) {
  if (m.getLayer(id)) m.removeLayer(id);
  if (m.getSource(id)) m.removeSource(id);
  if (!l) return;
  m.addSource(id, { type: 'raster', tiles: [l.tileTemplate.replace('{time}', dateFor(l))], tileSize: l.sharp && S.sharp ? 128 : 256, maxzoom: maxz(l), ...(l.scheme === 'tms' ? { scheme: 'tms' } : {}), ...(l.bounds ? { bounds: l.bounds } : {}) });
  m.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': opacity, 'raster-fade-duration': 150 } }, m.getLayer('road-case') ? 'road-case' : undefined);
}
function applyMap() {
  if (!map.isStyleLoaded() && !map.getSource('base')) return;
  raster('img', srcDef(S.layer), 1);
  for (const o of overlays) raster('ov-' + o.id, S.ov.has(o.id) ? o : null, 0.75);
  if (map2 && S.cmp) raster('img2', srcDef(S.cmp), 1, map2);
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
function addVec() {
  map.addSource('omt', { type: 'vector', url: 'https://tiles.openfreemap.org/planet' });
  VEC.forEach((l) => map.addLayer(l));
}
const setNames = (on) => [map, map2].forEach((m) => m && VEC.forEach((l) => m.getLayer(l.id) && m.setLayoutProperty(l.id, 'visibility', on ? 'visible' : 'none')));
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
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const CLAR = 'https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const WBU = (n) => `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${n}/{z}/{y}/{x}`;
const gibs = imagery.filter((l) => l.status === 'ok' || l.status === 'no_recent_tile');
const srcDef = (k) => {
  if (k === 'esri') return { id: 'esri', maxZoom: 19, sharp: true, tileTemplate: ESRI, name: 'Esri World Imagery' };
  if (k === 'clarity') return { id: 'clarity', maxZoom: 19, sharp: true, tileTemplate: CLAR, name: 'Esri Clarity' };
  if (k?.startsWith('wb:')) return { id: k, maxZoom: 19, sharp: true, tileTemplate: WBU(k.slice(3)), name: 'Wayback ' + (wb.find((x) => 'wb:' + x.n === k)?.d ?? '') };
  if (k?.startsWith('x:')) { const e = extra.find((x) => 'x:' + x.id === k); if (e) return { id: k, maxZoom: e.maxZoom ?? 20, tileTemplate: e.tiles, scheme: e.scheme, bounds: e.bounds, attribution: e.attribution, name: e.title_ar }; }
  const l = gibs.find((x) => 'gibs:' + x.id === k);
  return l ? { ...l, name: l.title_ar } : srcDef('esri');
};
const mpp = () => 156543.03392 * Math.cos((map.getCenter().lat * Math.PI) / 180) / 2 ** (map.getZoom() + 1);
const hint = () => {
  const d = srcDef(S.layer), over = map.getZoom() + 1 > (d.maxZoom ?? 9) + 0.05;
  $('#zhint').textContent = over ? 'تكبير رقمي: الصورة الأصلية لا تزيد دقة عن هذا الحد، وما بعده مجرد تكبير للبكسلات.' : '';
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
let pop;
function renderWx(title, cur, day, text, at) {
  const [em, desc] = WMO(cur.weather_code ?? 0);
  const r = (v) => (typeof v === 'number' ? Math.round(v) : '–');
  const days = (day?.time ?? []).slice(0, 7).map((t, i) => h('div', {}, h('b', {}, new Intl.DateTimeFormat('ar', { weekday: 'short', timeZone: 'UTC' }).format(new Date(t + 'T00:00:00Z'))), WMO(day.code[i])[0], h('br'), `${r(day.tmax[i])}°`, h('br'), h('b', {}, `${r(day.tmin[i])}°`)));
  $('#wx').replaceChildren(h('h3', {}, 'الطقس: ' + title),
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
    $('#wx').replaceChildren(h('h3', {}, 'الطقس'), h('div', { class: 'hint' }, 'جارٍ التحميل…'));
    try {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&wind_speed_unit=ms&timezone=auto&forecast_days=7`;
      const r = await (await fetch(u)).json();
      hit = { t: Date.now(), cur: r.current, day: { time: r.daily.time, code: r.daily.weather_code, tmax: r.daily.temperature_2m_max, tmin: r.daily.temperature_2m_min } };
      if (!hit.cur) throw 0;
      cache.set(key, hit);
    } catch { $('#wx').replaceChildren(h('h3', {}, 'الطقس'), h('div', { class: 'hint warn' }, 'تعذّر جلب الطقس لهذه النقطة الآن.')); return; }
  }
  renderWx(title, hit.cur, hit.day, null, [lon, lat]);
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
$('#presets').append(h('button', { onclick: () => fly(24, 22, 3.2) }, 'الوطن العربي'), ...(await getJSON('/data/config/presets.json'))?.presets?.map((p) => h('button', { onclick: () => fly(p.lat, p.lon, p.zoom) }, p.ar)) ?? []);

// ---------- المساعد ----------
function run(a) {
  switch (a.type) {
    case 'fly_to': fly(a.lat, a.lon, a.zoom); return true;
    case 'set_layer': { const k = 'gibs:' + a.id; if (!gibs.some((l) => 'gibs:' + l.id === k)) return false; setSrc(k); return true; }
    case 'compare': { const A = 'gibs:' + a.a?.layer, B = 'gibs:' + a.b?.layer; if (!gibs.some((l) => 'gibs:' + l.id === A) || !gibs.some((l) => 'gibs:' + l.id === B)) return false; setSrc(A); S.cmp = B; $('#srcB').value = B; map2 ? sync() : cmpOn(); return true; }
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
      body: JSON.stringify({ text, state: { lat: c.lat, lon: c.lng, zoom: map.getZoom(), layer: S.layer.replace(/^gibs:/, ''), date: S.date.mode === 'latest' ? 'latest' : S.date.date, overlays: [...S.ov] } }) });
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
const gOpt = (l) => opt('gibs:' + l.id, `${l.title_ar} · ${l.resolution_m} م (حديثة)`);
$('#src').append(opt('esri', 'Esri World Imagery (الأدق · افتراضي)'), opt('clarity', 'Esri Clarity (أرشيف أوضح أحيانًا)'), ...(wb.length ? [opt('wb', 'Esri Wayback (أرشيف بتواريخ)')] : []), ...gibs.map(gOpt), ...extra.map(xOpt));
$('#wbsel').append(...wb.map((x) => opt('wb:' + x.n, x.d)));
$('#srcB').append(opt('esri', 'Esri الحالي'), opt('clarity', 'Esri Clarity'), ...wb.map((x) => opt('wb:' + x.n, 'Wayback ' + x.d)), ...gibs.map(gOpt), ...extra.map(xOpt));
function info() {
  const d = srcDef(S.layer);
  $('#srcinfo').textContent = d.resolution_m ? `${d.title_ar}: دقة ${d.resolution_m} م · التأخير ${d.latency ?? '—'}` : d.attribution ? 'المصدر: ' + d.attribution : '';
  $('#la').textContent = d.name; $('#lb').textContent = S.cmp ? srcDef(S.cmp).name : '';
}
function setSrc(k) {
  S.layer = k; const w = k.startsWith('wb:'), d = srcDef(k);
  map.setMaxZoom(Math.max(19, d.maxZoom ?? 19));
  if (d.bounds) { const c = map.getCenter(), b = d.bounds; if (c.lng < b[0] || c.lng > b[2] || c.lat < b[1] || c.lat > b[3]) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, maxZoom: 17 }); }
  $('#src').value = w ? 'wb' : k; $('#wbsel').hidden = !w; if (w) $('#wbsel').value = k;
  info(); sync();
}
$('#src').onchange = (e) => (e.target.value === 'wb' ? setSrc('wb:' + ($('#wbsel').value || wb[0].n)) : setSrc(e.target.value));
$('#wbsel').onchange = (e) => setSrc(e.target.value);
$('#sharp').onchange = (e) => { S.sharp = e.target.checked; sync(); };
$('#srcB').onchange = (e) => { S.cmp = e.target.value; info(); sync(); };
if (!gibs.length) $('#today').hidden = true;
$('#today').onclick = () => {
  const l = gibs.find((x) => x.status === 'ok') ?? gibs[0];
  S.date = { mode: 'latest' }; setSrc('gibs:' + l.id);
  if (map.getZoom() > 7) map.easeTo({ zoom: 6.5 });
  toast('صورة القمر اليوم: ' + l.title_ar);
};
const cmpEl = $('#cmp'); let cmpMove;
const setP = (v) => { v = Math.min(95, Math.max(5, v)); document.body.style.setProperty('--p', v + '%'); cmpEl.setAttribute('aria-valuenow', Math.round(v)); };
function cmpOn() {
  S.cmp = S.layer === 'esri' ? 'clarity' : 'esri'; $('#srcB').value = S.cmp;
  document.body.classList.add('cmp'); cmpEl.hidden = $('#cmplab').hidden = $('#cmpbox').hidden = false; $('#cmpbtn').setAttribute('aria-pressed', 'true'); setP(50);
  map2 = new maplibregl.Map({ container: 'map2', style: { version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf', sources: {}, layers: [] }, center: map.getCenter(), zoom: map.getZoom(), minZoom: 2, maxZoom: 24, interactive: false, attributionControl: false });
  cmpMove = () => map2.jumpTo({ center: map.getCenter(), zoom: map.getZoom() });
  map.on('move', cmpMove);
  map2.on('load', () => { map2.addSource('omt', { type: 'vector', url: 'https://tiles.openfreemap.org/planet' }); VEC.forEach((l) => map2.addLayer(l)); setNames($('#names').checked); applyMap(); });
  info();
}
function cmpOff() {
  map.off('move', cmpMove); map2?.remove(); map2 = null; S.cmp = null;
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

info();
refreshUI();
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
