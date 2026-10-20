import test from 'node:test';
import assert from 'node:assert/strict';
import { haversine, geodist, pathLength, polygonArea, bearing, midpoint, fmtLen, fmtArea, precisionNote } from '../shared/measure.js';

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b} (±${tol})`);

// القيم المرجعية حُسبت بمكتبتين مستقلتين في Python (geographiclib وpyproj.Geod على WGS84)، وليست من هذا الكود.
test('مسافات جيوديسية تطابق المرجع المستقل (≤ 1 سم)', () => {
  near(geodist([-73.7781, 40.6413], [-0.4543, 51.47]), 5554908.7905475, 0.01);   // JFK ← LHR
  near(geodist([44.3661, 33.3152], [47.7804, 30.5085]), 448434.1047354312, 0.01); // بغداد ← البصرة
  near(geodist([44.421645, 32.462291], [44.422645, 32.462291]), 94.01595496076416, 0.01); // 0.001° شرقًا في الحلة
  near(geodist([44.421645, 32.462291], [44.421645, 32.463291]), 110.89494027234285, 0.01); // 0.001° شمالًا في الحلة
  assert.equal(geodist([44, 33], [44, 33]), 0);
});

test('haversine التقريبية أقل دقة من الجيوديسية، وهذا سبب عدم استعمالها للقياس', () => {
  const a = [44.421645, 32.462291], b = [44.421645, 32.463291];
  const exact = geodist(a, b);
  assert.ok(Math.abs(haversine(a, b) - exact) > 0.2);   // خطأ ≈ 0.3 م على 111 م (0.27%)
  assert.ok(Math.abs(haversine(a, b) / exact - 1) < 0.006);
});

test('طول مسار مفتوح ومغلق', () => {
  const sq = [[44, 32], [44.01, 32], [44.01, 32.01], [44, 32.01]];
  const open = pathLength(sq), closed = pathLength(sq, true);
  near(closed - open, geodist(sq[3], sq[0]), 1e-6);
  near(closed, 4107.498202426697, 0.05);       // محيط المضلع المرجعي (pyproj)
  assert.equal(pathLength([[1, 1]]), 0);
  assert.equal(pathLength([]), 0);
});

test('مساحات جيوديسية تطابق المرجع المستقل (≤ 0.001%)', () => {
  const rel = (a, b) => assert.ok(Math.abs(a / b - 1) < 1e-5, `${a} vs ${b}`);
  rel(polygonArea([[0, 0], [1, 0], [1, 1], [0, 1]]), 12308778361.469452);                       // درجة مربعة عند خط الاستواء
  rel(polygonArea([[44, 32], [44.01, 32], [44.01, 32.01], [44, 32.01]]), 1047748.2614526749);    // 0.01° عند 32°
  rel(polygonArea([[39, 29], [48.5, 29], [48.5, 37], [39, 37]]), 787253307611.2051);             // شكل بحجم العراق
  rel(polygonArea([[44.3661, 33.3152], [47.7804, 30.5085], [43.1189, 36.335]]), 37942560610.59558); // بغداد-البصرة-الموصل
  assert.equal(polygonArea([[0, 0], [1, 1]]), 0);
});

test('المساحة لا تتأثر باتجاه ترتيب النقاط', () => {
  const p = [[44, 32], [44.01, 32], [44.01, 32.01], [44, 32.01]];
  near(polygonArea(p), polygonArea([...p].reverse()), 1e-6);
});

test('اتجاه ونقطة منتصف', () => {
  near(bearing([44, 32], [44, 33]), 0, 1e-9);
  near(bearing([44, 32], [45, 32]), 90, 0.5);
  near(bearing([44, 32], [44, 31]), 180, 1e-9);
  const m = midpoint([44, 32], [44, 34]);
  near(m[0], 44, 1e-9); near(geodist([44, 32], m), geodist(m, [44, 34]), 1e-6);
});

test('تنسيق الطول والمساحة', () => {
  assert.equal(fmtLen(1.234), '1.23 م'); assert.equal(fmtLen(12.34), '12.3 م'); assert.equal(fmtLen(1500), '1.500 كم'); assert.equal(fmtLen(250000), '250.00 كم');
  assert.equal(fmtArea(50), '50.0 م²'); assert.equal(fmtArea(250), '250 م²'); assert.equal(fmtArea(25000), '2.500 هكتار'); assert.equal(fmtArea(2.5e6), '2.500 كم²');
});

test('سطر الدقة العملية', () => {
  assert.equal(precisionNote(0), '');
  assert.match(precisionNote(0.24), /±0\.12 م لكل نقرة/);
  assert.match(precisionNote(0.24, 5), /دقة موقع الصورة المطلقة ±5\.0 م/);
  assert.match(precisionNote(10), /±5\.0 م/);
});
