// التحقق الصارم من مخرجات المساعد الذكي. أي شيء خارج القائمة المسموحة يُحذف.
// النموذج لا يملك إلا اقتراح أوامر؛ هذا الملف هو الحارس الوحيد قبل وصولها للمتصفح.

import { findPlaceInText } from './arabic.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_REPLY = 240;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const inBBox = (lat, lon, b) => lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;

function addDays(iso, delta) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** نص الرد: بلا وسوم ولا روابط ولا أحرف تحكم، وبطول محدود. */
export function sanitizeReply(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_REPLY);
}

/** مواصفة تاريخ → {mode:'latest'} أو {mode:'date', date} أو null. */
export function parseDateSpec(spec, todayISO) {
  if (spec === 'latest') return { mode: 'latest' };
  if (isNum(spec) && Number.isInteger(spec) && spec <= 0 && spec >= -30) {
    return { mode: 'date', date: addDays(todayISO, spec) };
  }
  if (typeof spec === 'string' && ISO_DATE.test(spec)) {
    const min = addDays(todayISO, -90);
    if (spec <= todayISO && spec >= min && !Number.isNaN(new Date(`${spec}T00:00:00Z`).getTime())) {
      return { mode: 'date', date: spec };
    }
  }
  return null;
}

/**
 * @param {unknown} raw  الكائن الذي أعاده النموذج بعد JSON.parse
 * @param {object} ctx   { imageryIds:Set, overlayIds:Set, placeIndex:Map, bbox, todayISO, maxActions }
 */
export function validateAssistantOutput(raw, ctx) {
  const out = { reply: '', actions: [] };
  if (!raw || typeof raw !== 'object') return out;
  out.reply = sanitizeReply(raw.reply);
  const list = Array.isArray(raw.actions) ? raw.actions : [];
  for (const a of list) {
    if (out.actions.length >= ctx.maxActions) break;
    if (!a || typeof a !== 'object' || typeof a.type !== 'string') continue;
    const clean = cleanAction(a, ctx);
    if (clean) out.actions.push(clean);
  }
  return out;
}

function resolveLocation(a, ctx) {
  if (typeof a.place === 'string') {
    const c = findPlaceInText(a.place.slice(0, 60), ctx.placeIndex);
    if (c) return { lat: c.lat, lon: c.lon, cityId: c.id };
  }
  if (isNum(a.lat) && isNum(a.lon) && inBBox(a.lat, a.lon, ctx.bbox)) {
    return { lat: Math.round(a.lat * 1e4) / 1e4, lon: Math.round(a.lon * 1e4) / 1e4 };
  }
  return null;
}

function cleanLayerRef(ref, ctx) {
  if (!ref || typeof ref !== 'object') return null;
  if (typeof ref.layer !== 'string' || !ctx.imageryIds.has(ref.layer)) return null;
  const date = parseDateSpec(ref.date ?? 'latest', ctx.todayISO);
  return date ? { layer: ref.layer, date } : null;
}

function cleanAction(a, ctx) {
  switch (a.type) {
    case 'fly_to': {
      const loc = resolveLocation(a, ctx);
      if (!loc) return null;
      const zoom = isNum(a.zoom) ? Math.min(14, Math.max(3, Math.round(a.zoom * 10) / 10)) : 9;
      return { type: 'fly_to', ...loc, zoom };
    }
    case 'set_layer':
      return typeof a.id === 'string' && ctx.imageryIds.has(a.id) ? { type: 'set_layer', id: a.id } : null;
    case 'set_date': {
      const date = parseDateSpec(a.date, ctx.todayISO);
      return date ? { type: 'set_date', date } : null;
    }
    case 'toggle_overlay':
      return typeof a.id === 'string' && ctx.overlayIds.has(a.id) && typeof a.on === 'boolean'
        ? { type: 'toggle_overlay', id: a.id, on: a.on }
        : null;
    case 'open_weather': {
      const loc = resolveLocation(a, ctx);
      return loc ? { type: 'open_weather', ...loc } : null;
    }
    case 'compare': {
      const left = cleanLayerRef(a.a, ctx);
      const right = cleanLayerRef(a.b, ctx);
      return left && right ? { type: 'compare', a: left, b: right } : null;
    }
    case 'animate':
      return isNum(a.days) ? { type: 'animate', days: Math.min(7, Math.max(2, Math.round(a.days))) } : null;
    case 'data_saver':
      return typeof a.on === 'boolean' ? { type: 'data_saver', on: a.on } : null;
    case 'reset':
      return { type: 'reset' };
    default:
      return null;
  }
}
