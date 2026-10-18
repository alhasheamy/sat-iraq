// خوادم وهمية للاختبار دون إنترنت (GIBS وEOX وOpen-Meteo). تُحمَّل بـ: node --import ./tests/mocks.mjs ...
const realFetch = globalThis.fetch;
const today = new Date();
const isoDaysAgo = (n) => new Date(today.getTime() - n * 864e5).toISOString().slice(0, 10);

const layerXml = (id, fmt, tms, def, ranges) => `<Layer><ows:Title xml:lang='en'>${id}</ows:Title><ows:Identifier>${id}</ows:Identifier>
<Style isDefault='true'><ows:Title xml:lang='en'>default</ows:Title><ows:Identifier>default</ows:Identifier></Style>
<Dimension><ows:Identifier>Time</ows:Identifier><ows:UOM>ISO8601</ows:UOM><Default>${def}</Default><Current>false</Current>${ranges.map((r) => `<Value>${r}</Value>`).join('')}</Dimension>
<TileMatrixSetLink><TileMatrixSet>${tms}</TileMatrixSet></TileMatrixSetLink><Format>${fmt}</Format>
<ResourceURL format='${fmt}' template='https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${id}/default/{Time}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.${fmt.endsWith('jpeg') ? 'jpg' : 'png'}' resourceType='tile'/>
<ResourceURL format='${fmt}' template='https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${id}/default/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png' resourceType='tile'/>
<ResourceURL format='text/xml' template='https://gibs.earthdata.nasa.gov/x/{BBOX}.xml' resourceType='Domains'/></Layer>`;

const CAPS = `<Capabilities xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' version='1.0.0' xmlns:xlink='http://www.w3.org/1999/xlink' xmlns='http://www.opengis.net/wmts/1.0' xmlns:ows='http://www.opengis.net/ows/1.1'><Contents>
${layerXml('VIIRS_NOAA20_CorrectedReflectance_TrueColor', 'image/jpeg', 'GoogleMapsCompatible_Level9', isoDaysAgo(0), [`2018-01-01/${isoDaysAgo(0)}/P1D`])}
${layerXml('MODIS_Terra_CorrectedReflectance_TrueColor', 'image/jpeg', 'GoogleMapsCompatible_Level9', isoDaysAgo(1), [`2000-02-24/${isoDaysAgo(1)}/P1D`])}
${layerXml('HLS_S30_Nadir_BRDF_Adjusted_Reflectance_v2', 'image/png', 'GoogleMapsCompatible_Level12', isoDaysAgo(2), [`2021-01-01/${isoDaysAgo(2)}/P1D`])}
${layerXml('MODIS_Combined_Value_Added_AOD', 'image/png', 'GoogleMapsCompatible_Level6', isoDaysAgo(1), [`2002-07-04/${isoDaysAgo(1)}/P1D`])}
</Contents></Capabilities>`;

globalThis.fetch = async (url, opts) => {
  const u = new URL(String(url));
  if (u.hostname === 'gibs.earthdata.nasa.gov') {
    if (u.pathname.endsWith('WMTSCapabilities.xml')) return new Response(CAPS, { status: 200 });
    const m = u.pathname.match(/\/best\/([^/]+)\/default\/(\d{4}-\d{2}-\d{2})\//);
    if (m) return new Response(Buffer.alloc(m[2] >= isoDaysAgo(2) ? 3000 : 200), { status: 200 });
    return new Response('', { status: 404 });
  }
  if (u.hostname === 'tiles.maps.eox.at') {
    return u.pathname.includes('s2cloudless-2024') ? new Response(Buffer.alloc(5000), { status: 200 }) : new Response('', { status: 404 });
  }
  if (/open-meteo\.com$/.test(u.hostname)) {
    const lats = u.searchParams.get('latitude').split(',').map(Number);
    const days = Number(u.searchParams.get('forecast_days') || 1);
    const hv = (u.searchParams.get('hourly') || '').split(',').filter(Boolean);
    const dv = (u.searchParams.get('daily') || '').split(',').filter(Boolean);
    const cv = (u.searchParams.get('current') || '').split(',').filter(Boolean);
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    const times = Array.from({ length: days * 24 }, (_, i) => new Date(start.getTime() + i * 36e5).toISOString().slice(0, 16));
    const dtimes = Array.from({ length: days }, (_, i) => new Date(start.getTime() + i * 864e5).toISOString().slice(0, 10));
    const res = lats.map((lat, k) => {
      const o = { latitude: lat, longitude: 40 + k, utc_offset_seconds: 10800 };
      if (hv.length) { o.hourly = { time: times }; for (const v of hv) o.hourly[v] = times.map((_, i) => (v === 'dust' ? (i * 7 + k * 3) % 400 : v === 'weather_code' ? 1 : v === 'wind_direction_10m' ? (i * 15) % 360 : 10 + ((i + k) % 25))); }
      if (dv.length) { o.daily = { time: dtimes }; for (const v of dv) o.daily[v] = dtimes.map(() => (v === 'sunrise' || v === 'sunset' ? '2026-10-18T06:00' : 20)); }
      if (cv.length) { o.current = { time: new Date().toISOString().slice(0, 13) + ':00' }; for (const v of cv) o.current[v] = v === 'weather_code' ? 2 : 25; }
      return o;
    });
    return new Response(JSON.stringify(res.length === 1 ? res[0] : res), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return realFetch(url, opts);
};
