// يجمع الموقع النهائي في dist/:
//   الواجهة: web/dist (ناتج بناء Vite إن وُجد) وإلا web/static
//   البيانات: .generated/data → dist/data
//   الإعدادات التي تحتاجها الواجهة: config/{cities,presets,app}.json → dist/data/config
//   ملفات Cloudflare: deploy/_headers وdeploy/_routes.json
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, GEN, stepSummary } from './lib.mjs';

const dist = path.join(ROOT, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const cp = (from, to) => fs.cpSync(from, to, { recursive: true });
const webDist = path.join(ROOT, 'web', 'dist');
const webStatic = path.join(ROOT, 'web', 'static');
const uiSource = fs.existsSync(path.join(webDist, 'index.html')) ? webDist : webStatic;
cp(uiSource, dist);

if (fs.existsSync(GEN)) cp(GEN, path.join(dist, 'data'));
else console.warn('تحذير: لا توجد بيانات مولّدة (.generated/data). شغّل: npm run data');

fs.mkdirSync(path.join(dist, 'data', 'config'), { recursive: true });
for (const f of ['cities', 'presets', 'app']) cp(path.join(ROOT, 'config', `${f}.json`), path.join(dist, 'data', 'config', `${f}.json`));

cp(path.join(ROOT, 'deploy', '_headers'), path.join(dist, '_headers'));
cp(path.join(ROOT, 'deploy', '_routes.json'), path.join(dist, '_routes.json'));

fs.writeFileSync(path.join(dist, 'data', 'build.json'), JSON.stringify({ builtAt: new Date().toISOString(), commit: process.env.GITHUB_SHA ?? null, ui: path.relative(ROOT, uiSource) }));

// فحوص حدود Cloudflare Pages المجانية
let count = 0, total = 0, biggest = { size: 0, file: '' };
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else {
      const s = fs.statSync(p).size;
      count++; total += s;
      if (s > biggest.size) biggest = { size: s, file: path.relative(dist, p) };
    }
  }
})(dist);

const MB = (n) => (n / 1048576).toFixed(2);
stepSummary(`### التجميع\n- الواجهة من: \`${path.relative(ROOT, uiSource)}\`\n- الملفات: **${count}** (الحد 20,000) · الحجم الكلي: **${MB(total)} MB** · أكبر ملف: \`${biggest.file}\` (${MB(biggest.size)} MB، الحد 25 MB)`);
if (count > 20000 || biggest.size > 25 * 1048576) {
  console.error('تجاوز حدود Cloudflare Pages المجانية');
  process.exit(1);
}
