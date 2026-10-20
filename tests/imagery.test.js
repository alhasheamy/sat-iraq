import test from 'node:test';
import assert from 'node:assert/strict';
import {
  metaLayerId, metaQueryUrl, parseMeta, rankBest, fmtRes, metaLine, digitalZoom, bestSummary,
  parseOamResult, parseOamResponse, validOamTiles, oamMetaUrl, oamViewerUrl, bboxCenter, tileOf, openTileTemplate, nativeZoom, verdict, OAM_API, IRAQ_BBOX, isoDate, bidi,
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

// عيّنة بشكل ما أعاده فهرس OAM الحي لموقع أثري عراقي (تل الأحمر الشرقي، 5 نوفمبر 2021)
const OAM_SAMPLE = {
  title: 'Tell AL-Ahmer east (تل الاحمر الشرقي)', license: 'CC-BY 4.0', gsd: 0.01011, platform: 'uav', provider: 'A.A.',
  bbox: [44.129606, 32.57772, 44.131686, 32.579267], acquisition_start: '2021-11-05T21:26:00.000Z', acquisition_end: '2021-11-05T22:00:00.000Z',
  properties: { tms: 'https://tiles.openaerialmap.org/69513e1b9ec18574a42c4163/0/69513e1b9ec18574a42c4164/{z}/{x}/{y}' },
};

test('نتيجة OAM حقيقية الشكل ← عنصر صغير آمن', () => {
  const it = parseOamResult(OAM_SAMPLE);
  assert.equal(it.id, '69513e1b9ec18574a42c4164');
  assert.equal(it.gsd, 0.01011); assert.equal(it.kind, 'uav'); assert.equal(it.date, '2021-11-05'); assert.equal(it.license, 'CC-BY 4.0');
  assert.equal(it.tiles, OAM_SAMPLE.properties.tms); assert.equal(openTileTemplate(it), it.tiles); assert.equal(it.bbox.length, 4);
  assert.equal(it.producer, 'A.A.');
});

test('استجابة /meta كاملة: التراخيص والعناصر غير الصالحة', () => {
  const list = parseOamResponse({ meta: { license: 'CC-BY 4.0', found: 3 }, results: [
    { ...OAM_SAMPLE, license: undefined },
    { ...OAM_SAMPLE, properties: { tms: 'https://evil.example.com/a/0/b/{z}/{x}/{y}' } },
    { ...OAM_SAMPLE, properties: {} },
  ] });
  assert.equal(list.length, 1); assert.equal(list[0].license, 'CC-BY 4.0');
  assert.deepEqual(parseOamResponse(null), []); assert.deepEqual(parseOamResponse({ results: 'x' }), []);
});

test('قوالب البلاطات: نطاق OAM وhttps والمتغيرات الثلاثة فقط', () => {
  const ok = 'https://tiles.openaerialmap.org/a1/0/b2/{z}/{x}/{y}';
  assert.equal(validOamTiles(ok), ok);
  for (const bad of ['http://tiles.openaerialmap.org/a/0/b/{z}/{x}/{y}', 'https://tiles.openaerialmap.org.evil.com/a/{z}/{x}/{y}', 'https://tiles.openaerialmap.org/a/{z}/{x}',
    'https://tiles.openaerialmap.org/a/{z}/{x}/{y}" onerror="x', 'javascript:alert(1)', 'https://user@tiles.openaerialmap.org@evil.com/{z}/{x}/{y}', null, 42]) assert.equal(validOamTiles(bad), null, String(bad));
});

test('نصوص النتائج تُنظَّف والقيم السيئة تُهمل', () => {
  const t = parseOamResult({ ...OAM_SAMPLE, title: '<img src=x onerror=alert(1)>\nمسح', gsd: -3, acquisition_end: 'bad', acquisition_start: undefined, bbox: [1, 2, 3], platform: 'satellite' });
  assert.ok(!/[<>]/.test(t.title)); assert.equal(t.gsd, null); assert.equal(t.date, null); assert.equal(t.bbox, null); assert.equal(t.kind, 'satellite');
  assert.equal(parseOamResult(null), null);
});

test('رابط الاستعلام والفحوص المساعدة', () => {
  const u = new URL(oamMetaUrl(IRAQ_BBOX, 500));
  assert.equal(u.origin, OAM_API); assert.equal(u.pathname, '/meta');
  assert.equal(u.searchParams.get('bbox'), '38.8,29,48.6,37.4'); assert.equal(u.searchParams.get('limit'), '100'); assert.equal(u.searchParams.get('page'), '1');
  assert.deepEqual(bboxCenter([44, 32, 46, 34]), [45, 33]);
  assert.match(oamViewerUrl({ bbox: [44.129606, 32.57772, 44.131686, 32.579267] }), /^https:\/\/map\.openaerialmap\.org\/#\/44\.13065,32\.57849,18$/);
  assert.deepEqual(tileOf(0, 0, 1), { x: 1, y: 1 });
  assert.deepEqual(tileOf(44.421645, 32.462291, 18), { x: 163418, y: 106056 }); // نقطة لقطتك في الحلة (محسوبة سابقًا)
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
