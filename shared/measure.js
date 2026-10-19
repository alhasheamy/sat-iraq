// حساب المسافات والمساحات على الخريطة. نقاط الإدخال بصيغة [lon, lat] بالدرجات.
const R = 6371008.8; // نصف قطر الأرض المتوسط (م)
const rad = Math.PI / 180;

/** مسافة الدائرة العظمى بين نقطتين (م). */
export function haversine(a, b) {
  const dLa = (b[1] - a[1]) * rad, dLo = (b[0] - a[0]) * rad;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** طول المسار (م). closed=true يضيف القطعة الأخيرة من آخر نقطة إلى الأولى. */
export function pathLength(pts, closed = false) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += haversine(pts[i - 1], pts[i]);
  if (closed && pts.length > 2) s += haversine(pts[pts.length - 1], pts[0]);
  return s;
}

/** مساحة مضلع (م²) بإسقاط متساوي المستطيلات حول متوسط خط العرض: دقيقة للمواقع الأثرية والحقول والأحياء (أقل من عشرات الكيلومترات). */
export function polygonArea(pts) {
  if (pts.length < 3) return 0;
  const l0 = (pts.reduce((s, p) => s + p[1], 0) / pts.length) * rad;
  const xy = pts.map((p) => [p[0] * rad * R * Math.cos(l0), p[1] * rad * R]);
  let s = 0;
  xy.forEach(([x1, y1], i) => { const [x2, y2] = xy[(i + 1) % xy.length]; s += x1 * y2 - x2 * y1; });
  return Math.abs(s) / 2;
}

export const fmtLen = (m) => (m < 1000 ? `${m.toFixed(1)} م` : `${(m / 1000).toFixed(2)} كم`);
export const fmtArea = (a) => (a < 1e4 ? `${a.toFixed(0)} م²` : a < 1e6 ? `${(a / 1e4).toFixed(2)} هكتار` : `${(a / 1e6).toFixed(3)} كم²`);
