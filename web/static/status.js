'use strict';
const $ = (id) => document.getElementById(id);
const getJson = async (p) => { const r = await fetch(p, { cache: 'no-cache' }); if (!r.ok) throw new Error(p + ' → ' + r.status); return r.json(); };
const ageH = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 36e5 : Infinity);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const ageText = (iso) => { const h = ageH(iso); return h === Infinity ? 'لا توجد' : h < 1 ? 'قبل دقائق' : 'قبل ' + Math.round(h) + ' ساعة'; };

async function data() {
  const box = $('data'); box.textContent = '';
  try {
    const m = await getJson('data/meta.json');
    const stale = Number(m.staleWarnHours || 9);
    for (const [label, iso] of [['الشبكة الإقليمية', m.gridGeneratedAt], ['طقس المدن', m.citiesWeatherGeneratedAt], ['هواء المدن', m.citiesAirGeneratedAt]]) {
      const d = el('div', 'item'); d.append(el('b', '', label + ': '));
      d.append(el('span', ageH(iso) > stale ? 'warn' : 'ok', ageText(iso) + (ageH(iso) > stale ? ' (قديم)' : '')));
      box.append(d);
    }
    if (m.errors && m.errors.length) box.append(el('div', 'item bad', 'أخطاء: ' + m.errors.join(' | ')));
  } catch (e) { box.append(el('div', 'item bad', 'تعذّر تحميل meta.json: ' + e.message)); }
}

async function dust() {
  const box = $('dust');
  try {
    const s = await getJson('data/summary.json'); const d = s.iraqDust;
    const lvl = { normal: ['منخفض', 'ok'], high: ['مرتفع', 'warn'], severe: ['شديد', 'bad'] }[d.level] || ['—', ''];
    box.textContent = ''; box.append(el('b', lvl[1], lvl[0]), document.createTextNode(' — الأعلى: ' + (d.city || '—') + ' (' + d.maxUgm3 + ' µg/م³)'));
  } catch (e) { box.textContent = 'غير متاح: ' + e.message; }
}

async function layers() {
  const tb = $('layers').querySelector('tbody');
  try {
    const l = await getJson('data/layers.resolved.json');
    for (const x of l.layers) {
      const tr = el('tr'); tr.append(el('td', '', x.title_ar), el('td', '', x.resolution_m ? x.resolution_m + ' م' : '—'));
      const st = { ok: ['جاهزة', 'ok'], no_recent_tile: ['لا بلاطة حديثة', 'warn'], unavailable: ['غير متاحة', 'bad'] }[x.status] || [x.status, ''];
      tr.append(el('td', st[1], st[0]), el('td', '', x.latestDate || '—')); tb.append(tr);
    }
  } catch (e) { const tr = el('tr'); const td = el('td', 'bad', e.message); td.colSpan = 4; tr.append(td); tb.append(tr); }
}

async function ai() {
  try { const r = await getJson('api/assistant'); $('ai').textContent = ''; $('ai').append(el('span', r.hasAI ? 'ok' : 'bad', r.hasAI ? 'ربط الذكاء الاصطناعي: يعمل' : 'ربط الذكاء الاصطناعي غير موجود'), document.createTextNode(' · سقوف: ' + (r.hasKV ? 'مفعّلة (KV)' : 'غير مفعّلة (KV غير مربوط)'))); }
  catch (e) { $('ai').textContent = 'الدالة غير متاحة: ' + e.message; $('ai').className = 'bad'; }
  $('aiForm').addEventListener('submit', async (ev) => {
    ev.preventDefault(); const out = $('aiOut'); out.hidden = false; out.textContent = '…';
    try { const r = await fetch('api/assistant', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: $('aiText').value }) }); out.textContent = r.status + '\n' + JSON.stringify(await r.json(), null, 1); }
    catch (e) { out.textContent = 'فشل: ' + e.message; }
  });
}
data(); dust(); layers(); ai();
