/** يستخرج z/x/y من آخر ثلاثة أرقام في رابط بلاطة Esri ‏(.../{z}/{y}/{x}). */
export function tileCoordsOf(url) {
  const m = /(\d+)\/(\d+)\/(\d+)(?:\?.*)?$/.exec(url);
  return m ? { z: +m[1], y: +m[2], x: +m[3] } : null;
}
