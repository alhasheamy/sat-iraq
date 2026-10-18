// يجلب قائمة إصدارات Esri World Imagery Wayback ويحفظها مضغوطة في data/wayback.json (نفس النطاق: بلا CORS)
import { fetchRetry, writeGen, stepSummary } from './lib.mjs';
const URL_ = 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json';
const r = await fetchRetry(URL_, { asJson: true });
if (!r.ok) { console.warn('تعذّر جلب Wayback؛ ستستعمل الواجهة المصدر المباشر.'); process.exit(0); }
const items = Object.entries(r.data).map(([n, v]) => ({ n: +n, d: /(\d{4}-\d{2}-\d{2})/.exec(v.itemTitle || '')?.[1] })).filter((x) => x.n && x.d).sort((a, b) => b.d.localeCompare(a.d));
writeGen('wayback.json', { generatedAt: new Date().toISOString(), items });
stepSummary(`### Wayback\n- الإصدارات: **${items.length}** (الأحدث ${items[0]?.d})`);
