import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeArabic, stripAl, buildPlaceIndex, findPlaceInText } from '../shared/arabic.js';

const cities = JSON.parse(fs.readFileSync(new URL('../config/cities.json', import.meta.url))).cities;
const index = buildPlaceIndex(cities);

test('التطبيع يحذف التشكيل ويوحّد الألف والتاء المربوطة', () => {
  assert.equal(normalizeArabic('أَرْنِي الغُبارَ'), 'ارني الغبار');
  assert.equal(normalizeArabic('مكّة المكرّمة'), 'مكه المكرمه');
  assert.equal(normalizeArabic('٢٠٢٦'), '2026');
});

test('stripAl', () => {
  assert.equal(stripAl('البصره'), 'بصره');
  assert.equal(stripAl('الي'), 'الي');
});

test('إيجاد مدينة داخل جملة', () => {
  assert.equal(findPlaceInText('أرني الغبار فوق البصرة', index)?.id, 'basra');
  assert.equal(findPlaceInText('طقس بغداد غدا', index)?.id, 'baghdad');
  assert.equal(findPlaceInText('في الحلة', index)?.id, 'hillah');
  assert.equal(findPlaceInText('لا شيء هنا', index), null);
});

test('الاسم الأطول يتغلب', () => {
  assert.equal(findPlaceInText('مدينة الكويت', index)?.id, 'kuwait-city');
});

test('كل مدن العراق التسع عشرة (مراكز المحافظات) موجودة', () => {
  assert.equal(cities.filter((c) => c.iraqGov).length, 19);
});
