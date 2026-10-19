# منصة صور الأقمار الصناعية والطقس للعراق والشرق الأوسط

مجانية بالكامل · بلا إعلانات · بلا حسابات · تحديث تلقائي كل 3 ساعات.

- **الصور:** كلها من Esri (World Imagery افتراضيًا، وClarity، وأرشيف Wayback) يقرؤها المتصفح مباشرة ولا نخزّن صورًا. لا يعرض الموقع صور أقمار أقل دقة منها (Sentinel وVIIRS وMODIS وHLS محذوفة). طبقات NASA GIBS (غبار، حرارة، نبات، حرائق) بيانات فقط. صور الدرون أو الأقمار الأدق تُضاف عبر `config/extra-imagery.json` أو تُكتشف من OpenAerialMap (انظر `docs/IMAGERY-RESEARCH.md`).
- **الطقس والغبار:** سكربت مجدول (GitHub Actions) يجلب Open-Meteo ويكتب ملفات JSON ثابتة تُنشر مع الموقع.
- **المساعد الذكي:** دالة واحدة على Cloudflare Pages تستدعي `gpt-oss-20b` عبر Workers AI، وتُرجع أوامر محددة مسبقًا فقط بعد تحقق صارم.
- **الاستضافة:** Cloudflare Pages (مجاني) + GitHub Actions (مجاني للمستودعات العامة).

## ابدأ من هنا

| أنت | اقرأ |
|---|---|
| صاحب المشروع (نشر من الصفر على ويندوز) | [`docs/DEPLOY-WINDOWS.md`](docs/DEPLOY-WINDOWS.md) |
| الذكاء الاصطناعي الذي سيبني الواجهة | [`docs/HANDOFF.md`](docs/HANDOFF.md) ثم [`docs/FRONTEND-CONTRACT.md`](docs/FRONTEND-CONTRACT.md) |
| تريد معرفة الحدود المجانية | [`LIMITS.md`](LIMITS.md) |

## البنية

```
.github/workflows/deploy.yml   تحديث البيانات + بناء + نشر (كل 3 ساعات وعند كل رفع)
config/                        الطبقات والمدن والإعدادات (مصدر الحقيقة)
scripts/                       verify-layers · fetch-weather · assemble · prepare-wrangler
shared/                        عربي + تحقق مخرجات الذكاء الاصطناعي (يُستخدم في الخادم والواجهة)
functions/api/assistant.js     الدالة الوحيدة (Workers AI + KV اختياري)
deploy/                        _headers (سياسة الأمان) و_routes.json
web/                           الواجهة (حاليًا صفحة حالة مؤقتة في web/static)
tests/                         17 اختبارًا تعمل دون إنترنت
```

## أوامر محلية (اختيارية، تحتاج Node 22)

```
npm ci
npm test            # الاختبارات
npm run all         # يجلب البيانات ويبني dist/
```

## الإسناد

Esri, Maxar, Earthstar Geographics, and the GIS User Community · NASA GIBS/ESDIS (طبقات البيانات) · Open-Meteo.com (CC BY 4.0) · USGS · OpenAerialMap/HOT وVantor Open Data (عند طلبها فقط).
الموقع غير ربحي ولا يعرض إعلانات.
