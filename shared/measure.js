// حساب المسافات والمساحات على الخريطة بالطريقة الجيوديسية على مجسّم WGS84 (خوارزمية Karney عبر geographiclib).
// نقاط الإدخال بصيغة [lon, lat] بالدرجات. دقتها الحسابية بحدود النانومتر؛ الدقة العملية تحددها دقة النقر (حجم البكسل) ودقة الصورة نفسها.
// (النسخة السابقة كانت كروية haversine + إسقاط مستطيل: خطؤها حتى 0.3% في المسافات وأكثر من 7% في المضلعات الكبيرة.)
import pkg from 'geographiclib-geodesic';

const { Geodesic } = pkg;
const WGS84 = Geodesic.WGS84;
const R = 6371008.8; // نصف قطر الأرض المتوسط (م): يُستعمل فقط في haversine السريعة لنصف قطر البحث
const rad = Math.PI / 180;

/** مسافة الدائرة العظمى التقريبية (م)، خطؤها حتى 0.5%. للاستعمال السريع غير الحساس (نصف قطر بحث). لا تُستعمل للقياس. */
export function haversine(a, b) {
  const dLa = (b[1] - a[1]) * rad, dLo = (b[0] - a[0]) * rad;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** المسافة الجيوديسية على WGS84 بين نقطتين (م). */
export function geodist(a, b) {
  return WGS84.Inverse(a[1], a[0], b[1], b[0]).s12;
}

/** طول المسار الجيوديسي (م). closed=true يضيف القطعة الأخيرة من آخر نقطة إلى الأولى. */
export function pathLength(pts, closed = false) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += geodist(pts[i - 1], pts[i]);
  if (closed && pts.length > 2) s += geodist(pts[pts.length - 1], pts[0]);
  return s;
}

/** مساحة مضلع (م²) على المجسّم. الأضلاع خطوط جيوديسية، فلا يختلف الجواب باختلاف الإسقاط ولا يتأثر بالمضلعات الكبيرة. */
export function polygonArea(pts) {
  if (pts.length < 3) return 0;
  const poly = WGS84.Polygon(false);
  for (const p of pts) poly.AddPoint(p[1], p[0]);
  return Math.abs(poly.Compute(false, true).area);
}

/** اتجاه البداية (azimuth) من a إلى b بالدرجات 0..360 من الشمال. */
export function bearing(a, b) {
  const az = WGS84.Inverse(a[1], a[0], b[1], b[0]).azi1;
  return (az + 360) % 360;
}

/** نقطة المنتصف الجيوديسية بين نقطتين. */
export function midpoint(a, b) {
  const g = WGS84.Inverse(a[1], a[0], b[1], b[0]);
  const m = WGS84.Direct(a[1], a[0], g.azi1, g.s12 / 2);
  return [m.lon2, m.lat2];
}

export const fmtLen = (m) => (m < 1000 ? `${m.toFixed(m < 10 ? 2 : 1)} م` : `${(m / 1000).toFixed(m < 1e5 ? 3 : 2)} كم`);
export const fmtArea = (a) => (a < 1e4 ? `${a.toFixed(a < 100 ? 1 : 0)} م²` : a < 1e6 ? `${(a / 1e4).toFixed(3)} هكتار` : `${(a / 1e6).toFixed(3)} كم²`);

/**
 * سطر دقة عملية للقياس: كل نقرة تحمل خطأً بحدود نصف بكسل (م/بكسل ÷ 2) على الأقل،
 * وللصورة نفسها دقة موقع مطلقة (SRC_ACC من Esri) لا تؤثر في القياس النسبي داخل اللقطة الواحدة لكنها تؤثر في الإحداثيات.
 * يرجع نصًا عربيًا قصيرًا أو '' إن لم تتوفر دقة البكسل.
 */
export function precisionNote(mpp, acc = null) {
  if (!(mpp > 0)) return '';
  const click = mpp / 2;
  const f = (v) => (v < 1 ? `${v.toFixed(2)} م` : `${v.toFixed(1)} م`);
  return `الحساب جيوديسي (WGS84). الدقة العملية ≈ ±${f(click)} لكل نقرة بحسب التقريب${acc > 0 ? ` · دقة موقع الصورة المطلقة ±${f(acc)}` : ''}.`;
}
