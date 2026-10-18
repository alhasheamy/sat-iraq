// أدوات عربية مشتركة بين الخادم (Pages Function) والواجهة والاختبارات. بلا مكتبات خارجية.

const DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
const ARABIC_DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };

/** توحيد النص العربي للمقارنة: حذف التشكيل، توحيد الألف والياء والتاء المربوطة، الأرقام اللاتينية. */
export function normalizeArabic(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => ARABIC_DIGITS[d])
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** يزيل «ال» التعريف من بداية الكلمة المطبّعة. */
export function stripAl(word) {
  return word.startsWith('ال') && word.length > 3 ? word.slice(2) : word;
}

/** فهرس أسماء المدن: مفتاحه الاسم المطبّع (عربي وإنجليزي، مع «ال» وبدونها). */
export function buildPlaceIndex(cities) {
  const map = new Map();
  const add = (key, city) => {
    if (key && !map.has(key)) map.set(key, city);
  };
  for (const c of cities) {
    const ar = normalizeArabic(c.ar);
    add(ar, c);
    add(stripAl(ar), c);
    add(String(c.en || '').toLowerCase(), c);
    add(c.id, c);
  }
  return map;
}

/** يبحث عن مدينة معروفة داخل نص حر ويفضّل أطول اسم مطابق. */
export function findPlaceInText(text, index) {
  const norm = normalizeArabic(text);
  if (!norm) return null;
  if (index.has(norm)) return index.get(norm);
  const padded = ` ${norm} `;
  let best = null;
  let bestLen = 0;
  for (const [key, city] of index) {
    if (key.length < 3) continue;
    // كلمة كاملة مع السماح بسابقة حرف واحد (ب، ل، و، ف، ك) في العربية
    const re = new RegExp(`(^|\\s)[بلوفك]?${escapeRe(key)}(\\s|$)`);
    if (re.test(padded.trim()) || padded.includes(` ${key} `)) {
      if (key.length > bestLen) {
        best = city;
        bestLen = key.length;
      }
    }
  }
  return best;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
