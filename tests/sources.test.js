// حرّاس قرار المشروع: صور القاعدة من Esri فقط. أي صور أقل دقة (Sentinel/MODIS/VIIRS/HLS) ممنوعة كمصدر صورة.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const cfg = JSON.parse(read('config/layers.json'));
const headers = read('deploy/_headers');

test('كتالوج الطبقات: صور القاعدة Esri فقط، وطبقات GIBS كلها بيانات', () => {
  const imagery = cfg.layers.filter((l) => l.kind === 'imagery');
  assert.deepEqual(imagery.map((l) => l.id), ['esri', 'clarity']);
  assert.ok(imagery.every((l) => l.provider === 'esri' && !l.gibsId));
  assert.ok(cfg.layers.filter((l) => l.gibsId).every((l) => l.kind === 'overlay'));
  assert.equal(cfg.base, undefined);
  assert.equal(cfg.sentinel2, undefined);
});

test('سياسة الأمان: لا نطاقات صور غير Esri، وبها نطاقات Esri اللازمة', () => {
  for (const host of ['tiles.maps.eox.at', 'earth-search.aws.element84.com', 'sentinel-cogs.s3.us-west-2.amazonaws.com']) {
    assert.ok(!headers.includes(host), `يجب ألّا يظهر ${host}`);
  }
  for (const host of ['server.arcgisonline.com', 'clarity.maptiles.arcgis.com', 'wayback.maptiles.arcgis.com', 'metadata.maptiles.arcgis.com']) {
    assert.ok(headers.includes(host), `مفقود ${host}`);
  }
});

test('الواجهة لا تذكر أي مصدر صور أقل دقة', () => {
  const js = read('web/src/main.js') + read('web/index.html');
  assert.ok(!/eox|s2cloudless|CorrectedReflectance|HLS_S30|'gibs:|صورة القمر اليوم/i.test(js));
});

test('مصادر الصور الإضافية تشترط https والقوالب الثلاثة', () => {
  const x = JSON.parse(read('config/extra-imagery.json'));
  for (const s of x.sources ?? []) {
    assert.match(s.tiles, /^https:\/\//);
    for (const t of ['{z}', '{x}', '{y}']) assert.ok(s.tiles.includes(t), s.id);
  }
});
