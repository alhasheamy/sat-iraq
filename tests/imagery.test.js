import test from 'node:test';
import assert from 'node:assert/strict';
import {
  metaLayerId, metaQueryUrl, parseMeta, rankBest, fmtRes, metaLine, digitalZoom, bestSummary,
  parseOpenItem, stacQuery, openTileTemplate, nativeZoom, verdict, OPEN_HOST, isoDate, bidi,
} from '../shared/imagery.js';

// نزيل عوازل الاتجاه (غير المرئية) لنقارن النص الظاهر
const plain = (s) => s.replace(/[\u2060\u2066-\u2069]/g, '');

test('رقم طبقة بيانات الدقة = 23 − مستوى التقريب', () => {
  assert.equal(metaLayerId(19), 4);   // 30 سم
  assert.equal(metaLayerId(18), 5);   // 60 سم
  assert.equal(metaLayerId(10), 13);  // 150 م
  assert.equal(metaLayerId(3), 13);   // ما دون 10 يثبت على 13
  assert.equal(metaLayerId(40), 0);   // ما فوق 23 يثبت على 0
});

test('رابط الاستعلام عن بيانات الدقة', () => {
  const u = metaQueryUrl('https://x/MapServer', 44.4, 32.4, 17);
  assert.match(u, /MapServer\/6\/query\?/);
  assert.match(u, /geometry=44\.4%2C32\.4/);
  assert.match(u, /returnGeometry=false/);
  assert.match(u, /SRC_RES/);
});

test('قراءة استجابة بيانات الدقة', () => {
  const m = parseMeta({ features: [{ attributes: { SRC_DATE2: 1680307200000, SRC_RES: 0.3, SRC_ACC: 5, NICE_NAME: 'Maxar', NICE_DESC: 'WV03' } }] });
  assert.deepEqual(m, { date: '2023-04-01', res: 0.3, acc: 5, provider: 'Maxar', sensor: 'WV03' });
  assert.equal(parseMeta({ features: [] }), null);
  assert.equal(parseMeta(null), null);
  assert.equal(parseMeta({ error: { code: 400 } }), null);
  assert.equal(parseMeta({ features: [{ attributes: { SRC_DATE: 20190807, SRC_RES: 0 } }] }).date, '2019-08-07');
  assert.equal(parseMeta({ features: [{ attributes: { SRC_RES: 0 } }] }).res, null);
});

test('عند تقاطع عدة لقطات نأخذ الأدق ثم الأحدث', () => {
  const m = parseMeta({ features: [
    { attributes: { SRC_DATE2: 1600000000000, SRC_RES: 0.5, NICE_NAME: 'A' } },
    { attributes: { SRC_DATE2: 1500000000000, SRC_RES: 0.3, NICE_NAME: 'B' } },
    { attributes: { SRC_DATE2: 1650000000000, SRC_RES: 0.3, NICE_NAME: 'C' } },
  ] });
  assert.equal(m.provider, 'C');
});

test('ترتيب الأدق وحذف المكرر', () => {
  const a = { date: '2020-01-01', res: 0.5, provider: 'Maxar', sensor: 'WV02', rel: '2021-01-01', n: 1 };
  const b = { date: '2023-04-01', res: 0.3, provider: 'Maxar', sensor: 'WV03', rel: '2023-12-07', n: 2 };
  const out = rankBest([a, b, { ...b, rel: '2024-03-28', n: 3 }, { ...a, res: null, date: null, n: 4 }]);
  assert.equal(out.length, 3);
  assert.equal(out[0].n, 3);          // الأدق، وأحدث إصدار منه
  assert.equal(out.at(-1).n, 4);      // بلا دقة معروفة في الآخر
});

test('تنسيق الدقة وسطر البيانات', () => {
  assert.equal(fmtRes(0.3), '0.3 م');
  assert.equal(fmtRes(0.0499), '0.05 م');
  assert.equal(fmtRes(1.25), '1.3 م');
  assert.equal(fmtRes(null), '؟');
  assert.equal(metaLine(null), '');
  assert.match(plain(metaLine({ provider: 'Maxar', sensor: 'WV03', res: 0.3, date: '2023-04-01' })), /Maxar WV03 · دقة أصلية 0\.3 م · التقاط 2023-04-01/);
});

test('عزل اتجاه التاريخ والأسماء داخل الجمل العربية', () => {
  const d = isoDate('2019-08-07');
  assert.equal(plain(d), '2019-08-07');
  assert.ok(d.startsWith('\u2066') && d.endsWith('\u2069'));      // معزول LTR فلا ينعكس إلى 07-08-2019
  assert.ok(d.includes('-\u2060'));                                // لا ينكسر السطر عند الشرطة
  assert.equal(isoDate(null), '؟');
  assert.equal(plain(bidi('Maxar WV03')), 'Maxar WV03');
  assert.ok(bidi('x').startsWith('\u2068') && bidi('x').endsWith('\u2069'));
});

test('التكبير الرقمي يُكشف بمقارنة دقة المصدر بحجم البكسل', () => {
  assert.equal(digitalZoom(0.3, 0.3), 1);
  assert.equal(digitalZoom(0.3, 0.26), 1);   // أقل من 1.25×: لا يُعدّ تكبيرًا ملحوظًا
  assert.equal(digitalZoom(1.2, 0.3), 4);    // صورة 1.2 م معروضة بـ0.3 م/بكسل = تكبير 4×
  assert.equal(digitalZoom(null, 0.3), null);
  assert.equal(digitalZoom(0.3, 0), null);
});

test('ملخص أدق لقطة في الأرشيف', () => {
  const top = [{ res: 0.15, date: '2021-05-01' }];
  assert.match(plain(bestSummary(top, { res: 0.3 })), /0\.15 م \(2021-05-01\) مقابل 0\.3 م/);
  assert.match(bestSummary([{ res: 0.3, date: '2023-01-01' }], { res: 0.3 }), /هي الأدق/);
  assert.match(bestSummary([], null), /لم تُرجع/);
  assert.match(bestSummary(top, null), /أدق لقطة في الأرشيف/);
});

test('عنصر STAC حقيقي الشكل: Vantor وOAM', () => {
  const v = parseOpenItem({ id: 'B040001100E0F910', collection: 'vantor-opendata', bbox: [-105.36, 20.47, -105.14, 20.86],
    properties: { gsd: 0.54, datetime: '2026-10-16T17:53:15.962339Z', license: 'CC-BY-NC-4.0', title: 'Mexico-Hurricane-Simon-Oct-2026 - [POST] Vantor WV03', 'oam:platform_type': 'satellite', 'oam:producer_name': 'Vantor' } });
  assert.equal(v.gsd, 0.54); assert.equal(v.date, '2026-10-16'); assert.equal(v.kind, 'satellite'); assert.equal(v.license, 'CC-BY-NC-4.0'); assert.equal(v.producer, 'Vantor');
  const o = parseOpenItem({ id: '122b15c6-91d1-47a0-814a-eae6fb89de1b', collection: 'openaerialmap', bbox: [-43.13, -22.93, -43.12, -22.92],
    properties: { gsd: 0.09999999999999858, datetime: '2026-10-15T00:00:00Z', license: 'CC-BY-4.0', title: 'Niteroi 6923-74634', 'oam:platform_type': 'uav' } });
  assert.equal(o.kind, 'uav'); assert.equal(o.bbox.length, 4);
});

test('عناصر غير آمنة أو من مجموعات أخرى تُرفض، والنصوص تُنظَّف', () => {
  assert.equal(parseOpenItem({ id: 'x', collection: 'evil' }), null);
  assert.equal(parseOpenItem({ id: '../../etc', collection: 'openaerialmap' }), null);
  assert.equal(parseOpenItem({ id: 'a/b', collection: 'openaerialmap' }), null);
  assert.equal(parseOpenItem(null), null);
  const t = parseOpenItem({ id: 'ok-1', collection: 'openaerialmap', properties: { title: '<img src=x onerror=alert(1)>\nمسح', gsd: -3, datetime: 'bad' }, bbox: [1, 2, 3] });
  assert.ok(!/[<>]/.test(t.title)); assert.equal(t.gsd, null); assert.equal(t.date, null); assert.equal(t.bbox, null);
});

test('استعلام STAC بصيغة GET وقالب البلاطات', () => {
  const q = stacQuery({ collections: ['openaerialmap', 'vantor-opendata'], bbox: [44, 32, 45, 33], limit: 50 });
  assert.match(q, /collections=openaerialmap%2Cvantor-opendata/); assert.match(q, /bbox=44%2C32%2C45%2C33/); assert.match(q, /limit=50/);
  const p = stacQuery({ collections: ['openaerialmap'], intersects: { type: 'Point', coordinates: [44.4, 32.4] } });
  assert.match(decodeURIComponent(p), /"type":"Point"/);
  const tpl = openTileTemplate({ id: 'abc', collection: 'openaerialmap' });
  assert.equal(tpl, `${OPEN_HOST}/raster/collections/openaerialmap/items/abc/tiles/WebMercatorQuad/{z}/{x}/{y}@1x?assets=visual`);
});

test('أعلى مستوى تقريب مفيد بحسب دقة الصورة', () => {
  assert.equal(nativeZoom(0.3, 33), 19);
  assert.equal(nativeZoom(0.1, 33), 21);
  assert.equal(nativeZoom(0.54, 33), 18);
  assert.equal(nativeZoom(1000, 33), 10);
});

test('الحكم: هل الصورة المفتوحة أدق من Esri فعلًا؟', () => {
  assert.equal(verdict(0.05, 0.3), 'better');
  assert.equal(verdict(0.3, 0.3), 'same');
  assert.equal(verdict(0.5, 0.3), 'worse');
  assert.equal(verdict(0.5, 1.2), 'better');
  assert.equal(verdict(0.1, null), 'better');    // دقة Esri مجهولة لكن 0.1 م أدق حتمًا من أي صورة Esri في العراق
  assert.equal(verdict(0.5, null), 'unknown');   // لا ندّعي التفوق دون دليل
  assert.equal(verdict(null, 0.3), 'unknown');
});
