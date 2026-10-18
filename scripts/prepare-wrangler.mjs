// يولّد wrangler.toml من القالب. المتغيرات: CF_PROJECT_NAME (إلزامي)، KV_ID (اختياري).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';

const name = (process.env.CF_PROJECT_NAME || '').trim();
if (!/^[a-z0-9][a-z0-9-]{0,57}$/.test(name)) {
  console.error(`اسم مشروع Cloudflare غير صالح: "${name}". المسموح: أحرف إنجليزية صغيرة وأرقام وشرطات (حتى 58).`);
  process.exit(1);
}
const kv = (process.env.KV_ID || '').trim();
let t = fs.readFileSync(path.join(ROOT, 'wrangler.template.toml'), 'utf8').replace('__PROJECT_NAME__', name);
if (kv) {
  if (!/^[0-9a-f]{32}$/i.test(kv)) {
    console.error('KV_ID يجب أن يكون 32 خانة (أرقام وحروف a-f). تحقق من النسخ.');
    process.exit(1);
  }
  t = t.replace('__KV_ID__', kv);
} else {
  t = t.replace(/# __KV_BLOCK_START__[\s\S]*?# __KV_BLOCK_END__\n?/, '');
}
fs.writeFileSync(path.join(ROOT, 'wrangler.toml'), t);
console.log(`wrangler.toml جاهز: المشروع=${name} · KV=${kv ? 'مفعّل' : 'غير مفعّل (سقوف المساعد تعتمد على حد Cloudflare فقط)'}`);
