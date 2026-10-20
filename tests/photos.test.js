import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commonsGeoUrl, parseCommonsGeo, commonsInfoUrl, parseCommonsInfo, stripHtml, commonsName, photosGeoJSON,
  validMlyToken, mlyTilesUrl, mlyImageUrl, validMlyId, parseMlyImage, mlyPage,
} from '../shared/photos.js';

test('رابط geosearch: نطاق وإحداثيات وCORS', () => {
  const u = new URL(commonsGeoUrl(33.3152, 44.3661, 50000));
  assert.equal(u.origin, 'https://commons.wikimedia.org');
  assert.equal(u.searchParams.get('gscoord'), '33.31520|44.36610');
  assert.equal(u.searchParams.get('gsradius'), '10000');        // أقصى ما تسمح به الواجهة
  assert.equal(u.searchParams.get('gslimit'), '500');
  assert.equal(u.searchParams.get('gsnamespace'), '6');
  assert.equal(u.searchParams.get('origin'), '*');
  assert.equal(new URL(commonsGeoUrl(1, 1, 3)).searchParams.get('gsradius'), '10');
});

test('نتائج geosearch: الصور فقط وبقيم سليمة', () => {
  const out = parseCommonsGeo({ query: { geosearch: [
    { pageid: 1, title: 'File:Baghdad_skyline.jpg', lat: 33.3, lon: 44.4 },
    { pageid: 2, title: 'File:Map.svg', lat: 33.3, lon: 44.4 },
    { pageid: 3, title: 'File:Clip.webm', lat: 33.3, lon: 44.4 },
    { pageid: 4, title: 'Category:X', lat: 33.3, lon: 44.4 },
    { pageid: 5, title: 'File:Bad.jpg', lat: 'x', lon: 44.4 },
    { pageid: 6, title: 'File:Mosque.PNG', lat: 33.1, lon: 44.1 },
  ] } });
  assert.deepEqual(out.map((x) => x.id), [1, 6]);
  assert.deepEqual(parseCommonsGeo(null), []);
  assert.deepEqual(parseCommonsGeo({ query: {} }), []);
  const g = photosGeoJSON(out);
  assert.equal(g.features.length, 2); assert.deepEqual(g.features[0].geometry.coordinates, [44.4, 33.3]);
});

test('تنظيف HTML القادم من ويكيميديا', () => {
  assert.equal(stripHtml('<a href="javascript:alert(1)">Ali &amp; Sara</a>'), 'Ali & Sara');
  assert.equal(stripHtml('<script>x</script>نص &#1575;&#x644; &nbsp;مرحبا'), 'x نص ال مرحبا');
  assert.ok(!/[<>]/.test(stripHtml('a &lt;img src=x onerror=1&gt; b')));
  assert.equal(stripHtml(null), '');
  assert.equal(stripHtml('x'.repeat(500), 50).length, 50);
  assert.equal(commonsName('File:Al_Mutanabbi_Street,_Baghdad.jpg'), 'Al Mutanabbi Street, Baghdad');
});

test('imageinfo: روابط من ويكيميديا فقط', () => {
  const ok = parseCommonsInfo({ query: { pages: [{ imageinfo: [{ thumburl: 'https://upload.wikimedia.org/x/640px-a.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:a.jpg',
    extmetadata: { Artist: { value: '<a href="//x">Ahmed</a>' }, DateTimeOriginal: { value: '2019-05-03' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, ImageDescription: { value: '<b>مسجد</b>' } } }] }] } });
  assert.deepEqual(ok, { thumb: 'https://upload.wikimedia.org/x/640px-a.jpg', page: 'https://commons.wikimedia.org/wiki/File:a.jpg', artist: 'Ahmed', date: '2019-05-03', license: 'CC BY-SA 4.0', desc: 'مسجد' });
  assert.equal(parseCommonsInfo({ query: { pages: [{ imageinfo: [{ thumburl: 'https://evil.example/a.jpg' }] }] } }), null);
  assert.equal(parseCommonsInfo({ query: { pages: [{ imageinfo: [{ thumburl: 'http://upload.wikimedia.org/a.jpg' }] }] } }), null);
  assert.equal(parseCommonsInfo({ query: { pages: [{ missing: true }] } }), null);
  const nopage = parseCommonsInfo({ query: { pages: [{ imageinfo: [{ thumburl: 'https://upload.wikimedia.org/a.jpg', descriptionurl: 'https://evil.example/' }] }] } });
  assert.equal(nopage.page, null);
  assert.equal(new URL(commonsInfoUrl('File:A b.jpg')).searchParams.get('titles'), 'File:A b.jpg');
});

test('Mapillary: التحقق من الرمز والمعرّف والروابط', () => {
  const tok = 'MLY|4142433049226064|72206abe5035850d6743b23a49c41333';
  assert.ok(validMlyToken(tok));
  for (const bad of ['', 'abc', 'MLY|x|y', 'MLY|123|', null, 'MLY|1234|abc def abc']) assert.ok(!validMlyToken(bad), String(bad));
  assert.match(mlyTilesUrl(tok), /^https:\/\/tiles\.mapillary\.com\/maps\/vtp\/mly1_public\/2\/\{z\}\/\{x\}\/\{y\}\?access_token=MLY%7C/);
  assert.match(mlyImageUrl('1234567890123456', tok), /^https:\/\/graph\.mapillary\.com\/1234567890123456\?fields=thumb_1024_url,captured_at,is_pano&access_token=/);
  assert.ok(validMlyId(1234567890123456)); assert.ok(!validMlyId('../x')); assert.ok(!validMlyId('12'));
  assert.deepEqual(parseMlyImage({ thumb_1024_url: 'https://scontent-fra5-1.xx.fbcdn.net/m1/v/t6/a.jpg', captured_at: 1560000000000, is_pano: true }), { thumb: 'https://scontent-fra5-1.xx.fbcdn.net/m1/v/t6/a.jpg', date: '2019-06-08', pano: true });
  assert.equal(parseMlyImage({ thumb_1024_url: 'https://evil.example/a.jpg' }), null);
  assert.equal(parseMlyImage({ thumb_1024_url: 'https://fbcdn.net.evil.example/a.jpg' }), null);
  assert.equal(parseMlyImage({}), null);
  assert.equal(mlyPage('123456'), 'https://www.mapillary.com/app/?pKey=123456&focus=photo');
});
