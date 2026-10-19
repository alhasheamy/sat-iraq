# عقد الواجهة: ما تقدمه الخلفية وما تتوقعه

كل المسارات نسبية لجذر الموقع. كل ملفات `data/` تُحدَّث كل 3 ساعات تقريبًا. **قد يغيب أي ملف** (فشل مصدر خارجي عند أول تشغيل): الواجهة يجب أن تعمل بدونه وتُظهر رسالة واضحة.

## 1. ملفات البيانات

### `data/meta.json`
```
{ generatedAt, gridGeneratedAt, citiesWeatherGeneratedAt, citiesAirGeneratedAt,
  staleWarnHours: 9, result: {grid|citiesWeather|citiesAir: "fetched|reused|stale|missing"},
  errors: [string], apiWeightThisRun, attribution }
```
اعرض «آخر تحديث قبل كذا» لكل مجموعة، وحذّر إن تجاوز العمر `staleWarnHours`.

### `data/layers.resolved.json`  (الواجهة تقرأ هذا لا `config/layers.json`)
```
{ generatedAt,
  layers: [ { id, kind: "overlay", title_ar,
              status: "ok"|"no_recent_tile"|"unavailable",
              tileTemplate, format, matrixSet, maxZoom, latestDate, dataSaverMaxZoom?, ... } ] }
```
- أخفِ الطبقة إن كانت `status === "unavailable"`. أظهر `no_recent_tile` بتحذير.
- `tileTemplate` يحوي `{time}` و`{z}` و`{y}` و`{x}` (استبدل `{time}` بالتاريخ `YYYY-MM-DD` بنفسك، ويتولى MapLibre استبدال `{z}` و`{x}` و`{y}`). **اضبط `maxzoom` للمصدر من `maxZoom`** (وإلا طلبت الخريطة بلاطات غير موجودة).
- حجم البلاطة 256، الإسقاط EPSG:3857.
- طبقات GIBS هنا **بيانات فقط** (غبار، حرارة، نبات، حرائق). لا توجد فيها صور أقمار: صور القاعدة كلها Esri (esri وclarity وWayback وما في `config/extra-imagery.json`)، ومعرّفاتها `esri`/`clarity` ثابتة في `config/layers.json` بلا `gibsId`.
- نسب صور Esri: «Esri, Maxar, Earthstar Geographics, and the GIS User Community» على الخريطة (عنصر الإسناد) وفي التذييل.

### `data/status.json`
`{ generatedAt, layers: { [id]: { status, latestDate } }, stale? }`

### `data/grid/{temp,wind,cloud,rain,dust,aod}.json`
```
{ generatedAt, grid:{west,north,step,nx,ny}, times:[ISO UTC ...24], nodata:-32768,
  scale, unit, data: [ [..nx*ny ints] x24 ] }          // wind: u:[[..]], v:[[..]] بدل data
```
- الخلية `idx = j*nx + i` حيث `lat = north - j*step` و`lon = west + i*step` (صف أول = الشمال).
- القيمة الحقيقية = `int / scale`. `-32768` = لا بيانات. الخطوة الزمنية 3 ساعات.
- الرياح: `u` شرقية و`v` شمالية بالمتر/ثانية (بعد القسمة على `scale`). استخدمها لجسيمات متحركة على Canvas.

### `data/cities-weather.json`, `data/cities-air.json`, `data/summary.json`
- `cities-weather.json`: `cities[]` بحسب `id` من `data/config/cities.json`، فيها `current` و`hourly` (48 ساعة) و`daily` (7 أيام). الرياح بالمتر/ثانية.
- `cities-air.json`: `current` و`hourly.dust/pm10`.
- `summary.json`: `iraqDust {level: normal|high|severe, maxUgm3, city, thresholds}` و`cities[id] {text, dustLevel, dustMax24h}`. **نص عربي جاهز**: اعرضه كما هو.

### `data/config/{cities,presets,app}.json`
المدن (عربي/إنجليزي/إحداثيات/`iraqGov`)، ومناطق الاهتمام (`presets`)، وحدود التغطية والإعدادات (`bbox`, `defaultView`, `dust`, `staleWarnHours`).

## 2. الطقس لنقطة ينقر عليها المستخدم
من المتصفح مباشرة إلى `api.open-meteo.com` و`air-quality-api.open-meteo.com` (يُحسب على IP المستخدم لا علينا). لا تُرسل أكثر من طلب لكل نقرة، وخزّن آخر نتيجة لـ10 دقائق.

## 3. المساعد الذكي: `POST /api/assistant`
طلب: `{ "text": "≤200 حرفًا", "state": { lat, lon, zoom, layer, date, overlays } }`

استجابة ناجحة: `{ ok:true, reply, actions:[...], model }`. الأوامر بعد التحقق فقط:

| type | الحقول |
|---|---|
| `fly_to` | `lat, lon, zoom (3..14), cityId?` |
| `set_layer` | `id`: `esri` أو `clarity` |
| `set_date` | `date: {mode:"latest"} \| {mode:"date", date:"YYYY-MM-DD"}` |
| `toggle_overlay` | `id` (طبقة overlay), `on: boolean` |
| `open_weather` | `lat, lon, cityId?` |
| `compare` | `a:{layer}, b:{layer}` (`esri`/`clarity`؛ `date` يُتجاهل للصور) |
| `animate` | `days: 2..7` |
| `data_saver` | `on: boolean` |
| `reset` | - |

أخطاء: `400 bad_request` · `429 rate_limited` (سقف المستخدم) · `429 daily_cap` (سقف عام) · `503 ai_unavailable` · `405`.
**عند أي خطأ أو انقطاع:** اعتمد المحلل المحلي فقط (بنفس بنية الأوامر)، مع رسالة واضحة بلا إخفاء المشكلة. اعرض `reply` كنص عادي (`textContent`) لا HTML أبدًا.
المحلل المحلي يتولى الأوامر المتكررة قبل أي استدعاء للخادم (يوفّر حصة الذكاء الاصطناعي).

## 4. النطاقات المسموحة (CSP في `deploy/_headers`)
`'self'` · `*.earthdata.nasa.gov` (طبقات البيانات) · `server.arcgisonline.com` · `clarity.maptiles.arcgis.com` · `wayback.maptiles.arcgis.com` · `metadata.maptiles.arcgis.com` · `s3-us-west-2.amazonaws.com` · `api.imagery.hotosm.org` · `elevation-tiles-prod.s3.amazonaws.com` · `tiles.openfreemap.org` · `photon.komoot.io` · `nominatim.openstreetmap.org` · `api.open-meteo.com` · `air-quality-api.open-meteo.com` · `earthquake.usgs.gov`. (لا نطاقات لصور أقل دقة من Esri؛ يحرس ذلك `tests/sources.test.js`.)
ممنوع: سكربتات مضمّنة، خطوط ويب خارجية، صور من نطاقات أخرى. إن احتجت نطاقًا جديدًا فأضفه إلى الملف **واذكر السبب** في `docs/CHANGES.md`.

## 5. قواعد الأداء والبيانات
- التحميل الأول < 450 KB مضغوطًا بلا بلاطات. تحميل كسول للمساعد والطبقات الجوية.
- وضع توفير البيانات مفعّل افتراضيًا (يستعمل `dataSaverMaxZoom` لكل طبقة).
- ضع ناتج البناء بحيث تكون ملفات JS/CSS تحت `/assets/` (الرؤوس تخزّنها سنة).
- Service Worker: stale-while-revalidate لملفات `data/*.json`، وكاش للبلاطات بسقف ≈80 MB.

## 6. الإسناد في التذييل (إلزامي)
Esri, Maxar, Earthstar Geographics, and the GIS User Community (صور القاعدة) · NASA GIBS/ESDIS (طبقات البيانات) · «بيانات الطقس من Open-Meteo.com (CC BY 4.0)» مع رابط · USGS · OpenFreeMap/OpenStreetMap · OpenAerialMap/HOT وVantor عند عرضهما · «الموقع مجاني وغير ربحي».

## 7. معايير القبول
القسم 11 من التقرير النهائي، مع: كل طبقة تعرض فعليًا أو تُخفى، والموقع يعمل كاملًا بعد محاكاة غياب أي ملف في `data/` وفشل `/api/assistant`.
