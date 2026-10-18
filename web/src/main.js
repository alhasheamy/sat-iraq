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
const S = { layer: imagery[0]?.id, date: { mode: 'latest' }, ov: new Set(), saver: false };
const log = (m) => { $('#log').textContent = m; };

// ---------- الخريطة ----------
const baseTpl = res?.base?.eox?.template ?? 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg';
const map = new maplibregl.Map({
  container: 'map', style: { version: 8, sources: {}, layers: [] }, center: [dv.lon, dv.lat], zoom: dv.zoom,
  minZoom: 3, maxZoom: 17, dragRotate: false, attributionControl: false,
  maxBounds: [[bbox.west - 6, bbox.south - 6], [bbox.east + 6, bbox.north + 6]],
});
map.touchZoomRotate.disableRotation();
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

const dateFor = (l) => (S.date.mode === 'latest' ? l.latestDate || today : S.date.date);
const maxz = (l) => { const m = l.maxZoom ?? 9; return S.saver && l.dataSaverMaxZoom ? Math.min(m, l.dataSaverMaxZoom) : m; };
function raster(id, l, opacity) {
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
  if (!l) return;
  map.addSource(id, { type: 'raster', tiles: [l.tileTemplate.replace('{time}', dateFor(l))], tileSize: 256, maxzoom: maxz(l) });
  map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': opacity, 'raster-fade-duration': 150 } });
}
function applyMap() {
  if (!map.isStyleLoaded() && !map.getSource('base')) return;
  raster('img', imagery.find((l) => l.id === S.layer), 1);
  for (const o of overlays) raster('ov-' + o.id, S.ov.has(o.id) ? o : null, 0.75);
}
map.on('load', () => {
  map.addSource('base', { type: 'raster', tiles: [baseTpl], tileSize: 256, maxzoom: 13 });
  map.addLayer({ id: 'base', type: 'raster', source: 'base' });
  applyMap();
});
map.on('zoom', () => document.body.classList.toggle('far', map.getZoom() < 6.5));
map.on('error', (e) => { if (e?.error?.status === 404) return; });

// ---------- الواجهة ----------
const S2 = '__s2';
function hint() {
  const l = imagery.find((x) => x.id === S.layer);
  const z = map.getZoom(), native = l ? maxz(l) : 13;
  $('#zhint').textContent = z > native + 0.6 ? (l ? `تجاوزت أقصى دقة لهذه الطبقة (${l.resolution_m} م) فتبدو الصورة مكبّرة. لتفاصيل أدق اختر «HLS 30 م» أو «Sentinel-2 10 م».` : 'تجاوزت أقصى دقة للخلفية (≈10 م)؛ الصورة مكبّرة.') : '';
}
map.on('zoomend', hint);
function refreshUI() {
  const l = imagery.find((x) => x.id === S.layer);
  $('#layer').value = S.layer ?? '';
  $('#date').value = S.date.mode === 'latest' ? (l?.latestDate ?? today) : S.date.date;
  $('#date').max = today;
  $('#saver').checked = S.saver;
  document.querySelectorAll('#overlays input').forEach((i) => (i.checked = S.ov.has(i.dataset.id)));
  hint();
  $('#linfo').textContent = S.layer === S2 ? 'خلفية Sentinel-2 بلا غيوم، دقة 10 م (مركّب سنوي، وليست صورة اليوم).' : l ? [l.resolution_m && `دقة ${l.resolution_m} م`, l.latency && `التأخر: ${l.latency}`, l.status === 'no_recent_tile' && '⚠ لا بلاطة حديثة',
    l.patchy && 'صور 30 م ليست متاحة كل يوم لكل مكان؛ جرّب تاريخًا آخر.'].filter(Boolean).join(' · ') : 'لا توجد طبقات متاحة حاليًا.';
}
const sync = () => { refreshUI(); applyMap(); };
const setDate = (d) => { S.date = d; sync(); };

$('#layer').append(h('option', { value: S2 }, 'Sentinel-2 بلا غيوم (10 م · سنوي)'), ...imagery.map((l) => h('option', { value: l.id }, l.title_ar + (l.status === 'no_recent_tile' ? ' ⚠' : ''))));
$('#layer').onchange = (e) => { S.layer = e.target.value; sync(); };
$('#date').onchange = (e) => e.target.value && e.target.value <= today && setDate({ mode: 'date', date: e.target.value });
$('#prev').onclick = () => setDate({ mode: 'date', date: addDays($('#date').value || today, -1) });
$('#next').onclick = () => { const d = addDays($('#date').value || today, 1); d <= today ? setDate({ mode: 'date', date: d }) : setDate({ mode: 'latest' }); };
$('#latest').onclick = () => setDate({ mode: 'latest' });
$('#saver').onchange = (e) => { S.saver = e.target.checked; sync(); };
$('#overlays').append(...overlays.map((o) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', 'data-id': o.id, onchange: (e) => { e.target.checked ? S.ov.add(o.id) : S.ov.delete(o.id); sync(); } }), o.title_ar)));
if (!overlays.length) $('#overlays').textContent = 'لا توجد طبقات إضافية متاحة.';
$('#menu').onclick = () => document.body.classList.toggle('open');
$('#eox').textContent = res?.base?.eox?.attribution ?? 'EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data)';

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
map.on('click', (e) => showPoint(e.lngLat.lat, e.lngLat.lng));

// المدن والعلامات
const fly = (lat, lon, zoom = 9) => map.flyTo({ center: [lon, lat], zoom, essential: true });
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

refreshUI();
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
