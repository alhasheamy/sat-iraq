// دوال نقية (بلا DOM ولا شبكة) للّقطات الحقيقية التي سجّلها الناس على الخريطة:
//  1) ويكيميديا كومنز: صور فوتوغرافية بإحداثيات، ترخيص حر، بلا مفتاح (CORS بالمعامل origin=*).
//  2) Mapillary: صور شوارع مجتمعية (CC BY-SA 4.0). تحتاج «رمز عميل» مجانيًا يضعه صاحب الموقع في config/app.json.
// مغطاة باختبارات tests/photos.test.js.

export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const IMG_EXT = /\.(jpe?g|png|webp|tiff?)$/i;

/** أقصى نصف قطر يسمح به geosearch هو 10 كم. */
export const COMMONS_MAX_RADIUS = 10000;

export function commonsGeoUrl(lat, lon, radius = COMMONS_MAX_RADIUS, limit = 500) {
  const q = new URLSearchParams({
    action: 'query', list: 'geosearch', gscoord: `${(+lat).toFixed(5)}|${(+lon).toFixed(5)}`,
    gsradius: String(Math.round(Math.min(COMMONS_MAX_RADIUS, Math.max(10, radius)))), gslimit: String(Math.min(500, limit)),
    gsnamespace: '6', gsprimary: 'all', format: 'json', formatversion: '2', origin: '*',
  });
  return `${COMMONS_API}?${q}`;
}

/** نتيجة geosearch ← [{id, title, lat, lon}] للصور فقط (تُستبعد الخرائط SVG والفيديو والصوت). */
export function parseCommonsGeo(json) {
  const rows = Array.isArray(json?.query?.geosearch) ? json.query.geosearch : [];
  const out = [];
  for (const r of rows) {
    if (typeof r?.title !== 'string' || !r.title.startsWith('File:') || !IMG_EXT.test(r.title)) continue;
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon) || !Number.isFinite(r.pageid)) continue;
    out.push({ id: r.pageid, title: r.title.slice(0, 240), lat: r.lat, lon: r.lon });
  }
  return out;
}

export function commonsInfoUrl(title, width = 640) {
  const q = new URLSearchParams({
    action: 'query', titles: title, prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: String(width),
    iiextmetadatafilter: 'Artist|DateTimeOriginal|LicenseShortName|ImageDescription', format: 'json', formatversion: '2', origin: '*',
  });
  return `${COMMONS_API}?${q}`;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** يحوّل HTML قادمًا من ويكيميديا إلى نص عادي (يُعرض دائمًا بـtextContent، فهذا طبقة أمان إضافية). */
export function stripHtml(s, max = 200) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 31 && n < 0x10ffff ? String.fromCodePoint(n) : ' '; }
      return ENT[e.toLowerCase()] ?? m;
    })
    .replace(/[\u0000-\u001F<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

const host = (u) => { try { const x = new URL(u); return x.protocol === 'https:' ? x.hostname : null; } catch { return null; } };

/** استجابة imageinfo ← {thumb, page, artist, date, license, desc} أو null. الروابط تُقبل فقط من نطاقات ويكيميديا. */
export function parseCommonsInfo(json) {
  const p = json?.query?.pages?.[0], ii = p?.imageinfo?.[0];
  if (!ii) return null;
  const thumb = ii.thumburl ?? ii.url;
  if (host(thumb) !== 'upload.wikimedia.org') return null;
  const m = ii.extmetadata ?? {};
  return {
    thumb,
    page: host(ii.descriptionurl) === 'commons.wikimedia.org' ? ii.descriptionurl : null,
    artist: stripHtml(m.Artist?.value, 80) || null,
    date: stripHtml(m.DateTimeOriginal?.value, 40) || null,
    license: stripHtml(m.LicenseShortName?.value, 40) || null,
    desc: stripHtml(m.ImageDescription?.value, 160) || null,
  };
}

/** اسم الملف بلا «File:» والامتداد، للعرض. */
export const commonsName = (title) => stripHtml(String(title).replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' '), 90);

/** يحوّل نتائج geosearch إلى GeoJSON. */
export const photosGeoJSON = (list) => ({ type: 'FeatureCollection', features: list.map((r) => ({ type: 'Feature', id: r.id, geometry: { type: 'Point', coordinates: [r.lon, r.lat] }, properties: { id: r.id, title: r.title } })) });

// ---------------------------------------------------------------- Mapillary
const TOKEN_RE = /^MLY\|\d{4,20}\|[\w-]{8,80}$/;
export const validMlyToken = (t) => typeof t === 'string' && TOKEN_RE.test(t);
export const mlyTilesUrl = (token) => `https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}?access_token=${encodeURIComponent(token)}`;
export const mlyImageUrl = (id, token) => `https://graph.mapillary.com/${encodeURIComponent(String(id))}?fields=thumb_1024_url,captured_at,is_pano&access_token=${encodeURIComponent(token)}`;
export const validMlyId = (id) => /^\d{5,20}$/.test(String(id));
export function parseMlyImage(json) {
  const u = json?.thumb_1024_url;
  const h = host(u);
  if (!h || !/(^|\.)(fbcdn\.net|mapillary\.com)$/.test(h)) return null;
  const t = Number(json.captured_at);
  return { thumb: u, date: Number.isFinite(t) && t > 0 ? new Date(t).toISOString().slice(0, 10) : null, pano: json.is_pano === true };
}
export const mlyPage = (id) => `https://www.mapillary.com/app/?pKey=${encodeURIComponent(String(id))}&focus=photo`;
