// يجلب الطقس والغبار من Open-Meteo (مجاني لغير التجاري) ويكتب ملفات JSON ثابتة تُنشر مع الموقع.
// حدود Open-Meteo المجانية (من شروطهم الرسمية): أقل من 10,000 استدعاء يوميًا و5,000 بالساعة و600 بالدقيقة.
// وزن الطلب = المواقع × (الأيام/14 إن زادت عن 14) × (المتغيرات/10 إن زادت عن 10).
// لذلك: دفعات من 50 موقعًا بفاصل ~6.5 ثانية (≈460 استدعاء/دقيقة)، ويُعاد استخدام آخر بيانات طازجة.
// عند فشل المصدر يُبقي آخر بيانات ناجحة بدل نشر موقع بلا بيانات.

import { readJson, writeGen, readGen, fetchRetry, fetchPrevious, ageHours, sleep, stepSummary } from './lib.mjs';

const app = readJson('config/app.json');
const { cities } = readJson('config/cities.json');
const FORCE = process.env.FORCE === '1';
const MAX_WEIGHT_PER_RUN = 2500; // حارس: لا نقترب من 10,000 يوميًا
const BATCH = 50;
const DELAY_MS = Number(process.env.BATCH_DELAY_MS ?? 6500);

const W = 'https://api.open-meteo.com/v1/forecast';
const AQ = 'https://air-quality-api.open-meteo.com/v1/air-quality';

let used = 0; // مجموع الأوزان المقدّرة
const errors = [];

const round = (v, s) => (v === null || v === undefined || Number.isNaN(v) ? -32768 : Math.round(v * s));
const toIsoZ = (t) => (t.endsWith('Z') ? t : `${t}Z`);
const countVars = (p) => ['hourly', 'daily', 'current'].reduce((n, k) => n + (p[k] ? p[k].split(',').length : 0), 0);

async function batchFetch(base, points, params) {
  const out = [];
  const vars = countVars(params);
  const days = Number(params.forecast_days ?? 7);
  const perLocWeight = Math.max(1, vars / 10) * Math.max(1, days / 14);
  for (let i = 0; i < points.length; i += BATCH) {
    const chunk = points.slice(i, i + BATCH);
    used += chunk.length * perLocWeight;
    if (used > MAX_WEIGHT_PER_RUN) throw new Error('تجاوز حارس الوزن لكل تشغيل');
    const qs = new URLSearchParams({
      latitude: chunk.map((p) => p.lat.toFixed(2)).join(','),
      longitude: chunk.map((p) => p.lon.toFixed(2)).join(','),
      ...params
    });
    const r = await fetchRetry(`${base}?${qs}`, { asJson: true, tries: 4, timeoutMs: 60000 });
    if (!r.ok) throw new Error(`${base} فشل: ${r.status || r.error}`);
    const data = Array.isArray(r.data) ? r.data : [r.data];
    if (data.length !== chunk.length) throw new Error('عدد النتائج لا يطابق عدد النقاط');
    out.push(...data);
    if (i + BATCH < points.length) await sleep(DELAY_MS);
  }
  return out;
}

function makeGrid() {
  const { west, south, east, north } = app.bbox;
  const step = app.grid.step;
  const nx = Math.round((east - west) / step) + 1;
  const ny = Math.round((north - south) / step) + 1;
  const points = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) points.push({ lat: north - j * step, lon: west + i * step });
  return { west, north, step, nx, ny, points };
}

async function reuse(files, generatedAt, maxAge) {
  if (FORCE || ageHours(generatedAt) >= maxAge) return false;
  const got = [];
  for (const f of files) {
    const prev = await fetchPrevious(f);
    if (!prev) return false;
    got.push([f, prev]);
  }
  for (const [f, prev] of got) writeGen(f, prev);
  return true;
}

async function keepOld(files) {
  let ok = false;
  for (const f of files) {
    const prev = await fetchPrevious(f);
    if (prev) {
      writeGen(f, { ...prev, stale: true });
      ok = true;
    }
  }
  return ok;
}

// ------------------------------------------------------------------ الشبكة الإقليمية
async function buildGrid(meta) {
  const files = ['grid/temp.json', 'grid/wind.json', 'grid/cloud.json', 'grid/rain.json', 'grid/dust.json', 'grid/aod.json'];
  if (await reuse(files, meta.prev.gridGeneratedAt, app.refresh.gridMaxAgeHours)) {
    meta.gridGeneratedAt = meta.prev.gridGeneratedAt;
    return 'reused';
  }
  const g = makeGrid();
  const cells = g.nx * g.ny;
  const { stepHours, forecastHours } = app.grid;
  const steps = forecastHours / stepHours;
  try {
    const wx = await batchFetch(W, g.points, {
      hourly: 'temperature_2m,wind_speed_10m,wind_direction_10m,precipitation,cloud_cover',
      wind_speed_unit: 'ms', timezone: 'GMT', forecast_days: '4'
    });
    const aq = await batchFetch(AQ, g.points, { hourly: 'dust,aerosol_optical_depth', timezone: 'GMT', forecast_days: '4' });

    const times = wx[0].hourly.time;
    const nowFloor = new Date(Math.floor(Date.now() / (stepHours * 36e5)) * stepHours * 36e5).toISOString().slice(0, 13);
    let start = times.findIndex((t) => t.slice(0, 13) >= nowFloor);
    if (start < 0) start = 0;
    const idx = Array.from({ length: steps }, (_, k) => start + k * stepHours).filter((i) => i < times.length);
    const stepTimes = idx.map((i) => toIsoZ(times[i]));
    const generatedAt = new Date().toISOString();
    const head = { version: 1, generatedAt, grid: { west: g.west, north: g.north, step: g.step, nx: g.nx, ny: g.ny }, times: stepTimes, nodata: -32768 };

    const series = (loc, key, src) => src[loc].hourly[key];
    const make = (name, scale, unit, fetchVal) => {
      const data = idx.map((ti) => Array.from({ length: cells }, (_, c) => round(fetchVal(c, ti), scale)));
      writeGen(`grid/${name}.json`, { ...head, scale, unit, data });
    };
    make('temp', 10, '°C', (c, ti) => series(c, 'temperature_2m', wx)[ti]);
    make('cloud', 1, '%', (c, ti) => series(c, 'cloud_cover', wx)[ti]);
    make('rain', 10, 'mm/h', (c, ti) => series(c, 'precipitation', wx)[ti]);
    make('dust', 1, 'µg/m³', (c, ti) => series(c, 'dust', aq)[ti]);
    make('aod', 100, 'AOD', (c, ti) => series(c, 'aerosol_optical_depth', aq)[ti]);

    // الرياح: مركّبتا u (شرقية) وv (شمالية) من السرعة والاتجاه (الاتجاه = المصدر الذي تأتي منه الرياح)
    const comp = (k) => (c, ti) => {
      const s = series(c, 'wind_speed_10m', wx)[ti];
      const d = series(c, 'wind_direction_10m', wx)[ti];
      if (s == null || d == null) return null;
      const r = (d * Math.PI) / 180;
      return k === 'u' ? -s * Math.sin(r) : -s * Math.cos(r);
    };
    const u = idx.map((ti) => Array.from({ length: cells }, (_, c) => round(comp('u')(c, ti), 10)));
    const v = idx.map((ti) => Array.from({ length: cells }, (_, c) => round(comp('v')(c, ti), 10)));
    writeGen('grid/wind.json', { ...head, scale: 10, unit: 'm/s', u, v });

    meta.gridGeneratedAt = generatedAt;
    return 'fetched';
  } catch (e) {
    errors.push(`grid: ${e.message}`);
    if (await keepOld(files)) {
      meta.gridGeneratedAt = meta.prev.gridGeneratedAt ?? null;
      return 'stale';
    }
    return 'missing';
  }
}

// ------------------------------------------------------------------ المدن
async function buildCitiesWeather(meta) {
  const files = ['cities-weather.json'];
  if (await reuse(files, meta.prev.citiesWeatherGeneratedAt, app.refresh.citiesMaxAgeHours)) {
    meta.citiesWeatherGeneratedAt = meta.prev.citiesWeatherGeneratedAt;
    return 'reused';
  }
  try {
    const res = await batchFetch(W, cities, {
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,cloud_cover,is_day',
      hourly: 'temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,cloud_cover',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,sunrise,sunset,uv_index_max,wind_speed_10m_max',
      wind_speed_unit: 'ms', timezone: 'auto', forecast_days: '7'
    });
    const generatedAt = new Date().toISOString();
    const out = cities.map((c, i) => {
      const r = res[i];
      const h = r.hourly;
      const from = Math.max(0, h.time.findIndex((t) => t >= (r.current?.time ?? '').slice(0, 13) + ':00'));
      const sl = (a) => a.slice(from, from + 48);
      return {
        id: c.id,
        utcOffsetSeconds: r.utc_offset_seconds,
        current: r.current,
        hourly: { time: sl(h.time), t: sl(h.temperature_2m), pop: sl(h.precipitation_probability), precip: sl(h.precipitation), code: sl(h.weather_code), wind: sl(h.wind_speed_10m), gust: sl(h.wind_gusts_10m), cloud: sl(h.cloud_cover) },
        daily: { time: r.daily.time, code: r.daily.weather_code, tmax: r.daily.temperature_2m_max, tmin: r.daily.temperature_2m_min, precip: r.daily.precipitation_sum, sunrise: r.daily.sunrise, sunset: r.daily.sunset, uv: r.daily.uv_index_max, windmax: r.daily.wind_speed_10m_max }
      };
    });
    writeGen('cities-weather.json', { version: 1, generatedAt, units: { temp: '°C', wind: 'm/s', precip: 'mm' }, cities: out });
    meta.citiesWeatherGeneratedAt = generatedAt;
    return 'fetched';
  } catch (e) {
    errors.push(`cities-weather: ${e.message}`);
    if (await keepOld(files)) {
      meta.citiesWeatherGeneratedAt = meta.prev.citiesWeatherGeneratedAt ?? null;
      return 'stale';
    }
    return 'missing';
  }
}

async function buildCitiesAir(meta) {
  const files = ['cities-air.json'];
  if (await reuse(files, meta.prev.citiesAirGeneratedAt, app.refresh.airMaxAgeHours)) {
    meta.citiesAirGeneratedAt = meta.prev.citiesAirGeneratedAt;
    return 'reused';
  }
  try {
    const res = await batchFetch(AQ, cities, { current: 'dust,pm10,us_aqi', hourly: 'dust,pm10', timezone: 'auto', forecast_days: '3' });
    const generatedAt = new Date().toISOString();
    const out = cities.map((c, i) => {
      const r = res[i];
      const h = r.hourly;
      const from = Math.max(0, h.time.findIndex((t) => t >= (r.current?.time ?? '').slice(0, 13) + ':00'));
      const sl = (a) => a.slice(from, from + 48);
      return { id: c.id, current: r.current, hourly: { time: sl(h.time), dust: sl(h.dust), pm10: sl(h.pm10) } };
    });
    writeGen('cities-air.json', { version: 1, generatedAt, units: { dust: 'µg/m³', pm10: 'µg/m³' }, cities: out });
    meta.citiesAirGeneratedAt = generatedAt;
    return 'fetched';
  } catch (e) {
    errors.push(`cities-air: ${e.message}`);
    if (await keepOld(files)) {
      meta.citiesAirGeneratedAt = meta.prev.citiesAirGeneratedAt ?? null;
      return 'stale';
    }
    return 'missing';
  }
}

// ------------------------------------------------------------------ ملخصات عربية بقوالب (بلا ذكاء اصطناعي)
const WMO_AR = {
  0: 'صافٍ', 1: 'غالبًا صافٍ', 2: 'غائم جزئيًا', 3: 'غائم', 45: 'ضباب', 48: 'ضباب صقيعي',
  51: 'رذاذ خفيف', 53: 'رذاذ', 55: 'رذاذ كثيف', 56: 'رذاذ متجمد', 57: 'رذاذ متجمد كثيف',
  61: 'مطر خفيف', 63: 'مطر', 65: 'مطر غزير', 66: 'مطر متجمد', 67: 'مطر متجمد غزير',
  71: 'ثلج خفيف', 73: 'ثلج', 75: 'ثلج كثيف', 77: 'حبيبات ثلج',
  80: 'زخات مطر خفيفة', 81: 'زخات مطر', 82: 'زخات مطر غزيرة', 85: 'زخات ثلج', 86: 'زخات ثلج كثيفة',
  95: 'عاصفة رعدية', 96: 'عاصفة رعدية مع برَد', 99: 'عاصفة رعدية مع برَد كثيف'
};
const dustLevel = (v) => (v >= app.dust.severeUgm3 ? 'severe' : v >= app.dust.highUgm3 ? 'high' : 'normal');
const dustAr = { normal: 'غبار منخفض', high: 'غبار مرتفع', severe: 'غبار شديد' };

function buildSummary(cw, ca) {
  if (!cw) return null;
  const airById = new Map((ca?.cities ?? []).map((c) => [c.id, c]));
  const items = {};
  let iraqMax = 0;
  let iraqMaxCity = null;
  for (const c of cw.cities) {
    const meta = cities.find((x) => x.id === c.id);
    const a = airById.get(c.id);
    const next24 = (a?.hourly?.dust ?? []).slice(0, 24).filter((x) => typeof x === 'number');
    const dMax = next24.length ? Math.max(...next24) : null;
    const level = dMax === null ? null : dustLevel(dMax);
    const cur = c.current;
    const desc = WMO_AR[cur?.weather_code] ?? '';
    const tmax = c.daily.tmax?.[0];
    const tmin = c.daily.tmin?.[0];
    const parts = [`${meta.ar}: ${desc}`.trim(), cur ? `الحرارة الآن ${Math.round(cur.temperature_2m)}°` : null, tmax != null ? `العظمى ${Math.round(tmax)}° والصغرى ${Math.round(tmin)}°` : null, level ? `${dustAr[level]} خلال 24 ساعة` : null];
    items[c.id] = { text: parts.filter(Boolean).join('، ') + '.', dustLevel: level, dustMax24h: dMax === null ? null : Math.round(dMax) };
    if (meta.country === 'IQ' && dMax !== null && dMax > iraqMax) {
      iraqMax = dMax;
      iraqMaxCity = meta.ar;
    }
  }
  return { version: 1, generatedAt: new Date().toISOString(), iraqDust: { level: dustLevel(iraqMax), maxUgm3: Math.round(iraqMax), city: iraqMaxCity, thresholds: app.dust }, cities: items };
}

// ------------------------------------------------------------------ التشغيل
const prev = (await fetchPrevious('meta.json')) ?? {};
const meta = { prev };
const result = {};
result.grid = await buildGrid(meta);
result.citiesWeather = await buildCitiesWeather(meta);
result.citiesAir = await buildCitiesAir(meta);

const summary = buildSummary(readGen('cities-weather.json'), readGen('cities-air.json'));
if (summary) writeGen('summary.json', summary);

writeGen('meta.json', {
  version: 1,
  generatedAt: new Date().toISOString(),
  gridGeneratedAt: meta.gridGeneratedAt ?? null,
  citiesWeatherGeneratedAt: meta.citiesWeatherGeneratedAt ?? null,
  citiesAirGeneratedAt: meta.citiesAirGeneratedAt ?? null,
  staleWarnHours: app.staleWarnHours,
  result,
  errors,
  apiWeightThisRun: Math.round(used),
  attribution: 'Weather data by Open-Meteo.com (CC BY 4.0)'
}, true);

stepSummary(`### الطقس\n- الشبكة: **${result.grid}** · المدن: **${result.citiesWeather}** · هواء المدن: **${result.citiesAir}**\n- الوزن التقديري المستهلك من Open-Meteo في هذا التشغيل: **${Math.round(used)}** (الحد اليومي 10,000)\n${errors.length ? '- أخطاء: ' + errors.join(' | ') : '- بلا أخطاء'}`);
if (result.grid === 'missing' && result.citiesWeather === 'missing') process.exitCode = 1;
