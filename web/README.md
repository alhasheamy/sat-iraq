# مجلد الواجهة

حاليًا يحتوي `static/` على **صفحة حالة مؤقتة** تثبت أن الاستضافة والبيانات تعمل.

**للذكاء الاصطناعي الذي يبني الواجهة:** أنشئ مشروع Vite هنا (`web/package.json`) بحيث يعمل `npm --prefix web ci && npm --prefix web run build` وينتج `web/dist/index.html`.
سير العمل في `.github/workflows/deploy.yml` يبني هذا المجلد تلقائيًا إن وُجد `web/package.json`، ويعمل `scripts/assemble.mjs` على نسخ `web/dist` بدل `web/static` عندما يجد فيه `index.html`.
اقرأ `docs/HANDOFF.md` و`docs/FRONTEND-CONTRACT.md` أولًا.
