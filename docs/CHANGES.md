# سجل التغييرات
- أُضيفت الواجهة الحقيقية في `web/` (Vite + MapLibre). لم تتغير الخلفية ولا `_headers`.
- ليست مدعومة بعد في هذه النسخة: أوامر المقارنة والتحريك، جسيمات الرياح، طبقة الحرائق (متجهة)، Sentinel-2 COG بدقة 10 م، كاش البلاطات.
- أُضيف النطاق server.arcgisonline.com إلى CSP (img-src وconnect-src) لطبقة Esri World Imagery عالية الدقة، لأن صور NASA وSentinel لا تُظهر الشوارع (30 م و10 م لكل بكسل).
- CSP: أُضيف tiles.openfreemap.org (أسماء وطرق OSM بلا مفاتيح وبلا حدود) وclarity.maptiles.arcgis.com (أرشيف Esri Clarity). الخطوط والعلامات تُجلب من OpenFreeMap مباشرة، فلا تستهلك تخزين Cloudflare.
- أُضيف /rtl.js (إضافة تشكيل العربية لخرائط MapLibre، نسخة asm.js لأنها لا تحتاج wasm).
- أُضيفت: جسيمات الرياح، تحريك 7 أيام، تحديد الموقع، أسماء ونواحٍ وشوارع للوطن العربي.
