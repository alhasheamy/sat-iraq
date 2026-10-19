import test from 'node:test';
import assert from 'node:assert/strict';
import { haversine, pathLength, polygonArea, fmtLen, fmtArea } from '../shared/measure.js';

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test('مسافة درجة واحدة على خط الاستواء ≈ 111.195 كم', () => {
  near(haversine([0, 0], [1, 0]), 111195.08, 1);
  near(haversine([0, 0], [0, 1]), 111195.08, 1);
  assert.equal(haversine([44, 33], [44, 33]), 0);
});

test('طول مسار مفتوح ومغلق', () => {
  const sq = [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01]];
  near(pathLength(sq), 3 * 1111.95, 2);
  near(pathLength(sq, true), 4 * 1111.95, 2);
  assert.equal(pathLength([[1, 1]]), 0);
});

test('مساحة مربع 0.01° على خط الاستواء ≈ 1.2364 كم²', () => {
  near(polygonArea([[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01]]), 1236429, 1500);
  assert.equal(polygonArea([[0, 0], [1, 1]]), 0);
});

test('المساحة تقلّ بحسب خط العرض (جيب التمام)', () => {
  const sq = (lat) => polygonArea([[44, lat], [44.01, lat], [44.01, lat + 0.01], [44, lat + 0.01]]);
  assert.ok(sq(33) < sq(0));
  near(sq(33) / sq(0), Math.cos(33.005 * Math.PI / 180), 0.002);
});

test('تنسيق الطول والمساحة', () => {
  assert.equal(fmtLen(12.34), '12.3 م'); assert.equal(fmtLen(1500), '1.50 كم');
  assert.equal(fmtArea(250), '250 م²'); assert.equal(fmtArea(25000), '2.50 هكتار'); assert.equal(fmtArea(2.5e6), '2.500 كم²');
});
