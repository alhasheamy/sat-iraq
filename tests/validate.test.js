import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlaceIndex } from '../shared/arabic.js';
import { validateAssistantOutput, parseDateSpec, sanitizeReply } from '../shared/validate.js';

const cities = JSON.parse(fs.readFileSync(new URL('../config/cities.json', import.meta.url))).cities;
const ctx = {
  imageryIds: new Set(['esri', 'clarity']),
  overlayIds: new Set(['aerosol-aod', 'fires-noaa20']),
  placeIndex: buildPlaceIndex(cities),
  bbox: { west: 24, south: 12, east: 64, north: 42 },
  todayISO: '2026-10-18',
  maxActions: 4
};

test('أوامر سليمة تمر', () => {
  const r = validateAssistantOutput(
    { reply: 'تم عرض الغبار فوق البصرة.', actions: [
      { type: 'fly_to', place: 'البصرة', zoom: 8 },
      { type: 'toggle_overlay', id: 'aerosol-aod', on: true },
      { type: 'set_date', date: 'latest' } ] }, ctx);
  assert.equal(r.actions.length, 3);
  assert.equal(r.actions[0].cityId, 'basra');
});

test('معرّف طبقة مجهول يُرفض', () => {
  assert.equal(validateAssistantOutput({ actions: [{ type: 'set_layer', id: 'evil' }] }, ctx).actions.length, 0);
});

test('نوع أمر غير مسموح يُرفض (روابط وشيفرة)', () => {
  const r = validateAssistantOutput({ actions: [{ type: 'open_url', url: 'https://evil.example' }, { type: 'eval', code: 'alert(1)' }] }, ctx);
  assert.equal(r.actions.length, 0);
});

test('إحداثيات خارج النطاق تُرفض', () => {
  assert.equal(validateAssistantOutput({ actions: [{ type: 'fly_to', lat: 51.5, lon: -0.12 }] }, ctx).actions.length, 0);
});

test('تواريخ: مستقبلي أو قديم جدًا يُرفض', () => {
  assert.equal(parseDateSpec('2026-10-19', ctx.todayISO), null);
  assert.equal(parseDateSpec('2025-01-01', ctx.todayISO), null);
  assert.deepEqual(parseDateSpec(-2, ctx.todayISO), { mode: 'date', date: '2026-10-16' });
  assert.equal(parseDateSpec(-31, ctx.todayISO), null);
  assert.equal(parseDateSpec('2026-13-40', ctx.todayISO), null);
});

test('الحد الأقصى للأوامر', () => {
  const many = Array.from({ length: 10 }, () => ({ type: 'reset' }));
  assert.equal(validateAssistantOutput({ actions: many }, ctx).actions.length, 4);
});

test('تنظيف الرد من الوسوم والروابط', () => {
  const s = sanitizeReply('<img src=x onerror=alert(1)> زر https://evil.example الآن');
  assert.ok(!s.includes('<') && !s.includes('http'));
});

test('مدخلات غير كائنية لا تكسر', () => {
  for (const bad of [null, undefined, 5, 'x', [], { actions: 'no' }]) {
    assert.deepEqual(validateAssistantOutput(bad, ctx).actions, []);
  }
});

test('مقارنة بين مصدرين من Esri، والمصادر المحذوفة تُرفض', () => {
  const r = validateAssistantOutput({ actions: [{ type: 'compare', a: { layer: 'esri' }, b: { layer: 'clarity', date: 'latest' } }] }, ctx);
  assert.equal(r.actions[0].type, 'compare');
  assert.equal(validateAssistantOutput({ actions: [{ type: 'set_layer', id: 'esri' }] }, ctx).actions.length, 1);
  for (const gone of ['viirs-noaa20', 'modis-terra', 'hls-s30', 'eox']) assert.equal(validateAssistantOutput({ actions: [{ type: 'set_layer', id: gone }] }, ctx).actions.length, 0);
});

test('مخرجات خبيثة: حقن في حقول الأمر لا يمر', () => {
  const r = validateAssistantOutput({ reply: 'x', actions: [
    { type: 'toggle_overlay', id: 'aerosol-aod', on: 'yes' },
    { type: 'fly_to', place: '<script>alert(1)</script>', zoom: 99 },
    { type: '__proto__', id: 'x' },
    { type: 'compare', a: { layer: 'esri', date: '2026-10-17' }, b: { layer: 'nope', date: 'latest' } } ] }, ctx);
  assert.equal(r.actions.length, 0);
});
