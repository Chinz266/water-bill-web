/**
 * พิกัดและระยะห่าง — ใช้ช่วยจับคู่รูปมิเตอร์กับบ้าน
 *
 * รูปที่เจ้าหน้าที่ถ่ายมีพิกัดติดมาจากกล้อง (ดู exif.ts) ถ้าบ้านแต่ละหลังเก็บพิกัดไว้ด้วย
 * ก็เดาได้ว่ากำลังยืนอยู่หน้าบ้านหลังไหน ใช้เรียงรายชื่อและเตือนเวลาเลือกไม่ตรง
 *
 * ⚠️ GPS ของกล้องมือถือคลาดเคลื่อนราว 5–20 เมตร บ้านที่ติดกันจึงแยกไม่ออก
 *    ข้อมูลนี้ใช้ "ช่วยเลือก" กับ "เตือน" ได้ แต่ห้ามเอาไปตัดสินแทนคนเด็ดขาด
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * แปลงค่าพิกัดจากที่ไหนก็ไม่รู้ให้เป็นตัวเลขที่ใช้ได้จริง
 * หลังบ้านคืนมาเป็น string ได้ (คอลัมน์ decimal) ส่วน EXIF ก็เสียได้ทุกเมื่อ
 */
export function toCoords(lat: unknown, lng: unknown): LatLng | null {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  // 0,0 อยู่กลางมหาสมุทร — เจอแบบนี้คือค่าว่างที่ถูกแปลงเป็นเลข ไม่ใช่พิกัดจริง
  if (latitude === 0 && longitude === 0) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  return { lat: latitude, lng: longitude };
}

export interface NearestMatch<T> {
  item: T;
  meters: number;
}

/**
 * เลือกตัวที่ใกล้ที่สุด "แบบมั่นใจพอ" — เดาไม่ได้ให้คืน null ดีกว่าเดาผิด
 *
 * นอกจากต้องอยู่ในรัศมี maxMeters แล้ว ยังต้องทิ้งห่างอันดับสองอย่างน้อย minMargin
 * เพราะถ้าสองหลังห่างจากจุดถ่ายพอ ๆ กัน การที่หลังหนึ่งใกล้กว่าอีกหลัง 2 เมตร
 * ไม่ได้แปลว่าถูก — ความคลาดเคลื่อนของ GPS มากกว่านั้นเยอะ เดาไปก็เท่ากับโยนหัวก้อย
 */
export function pickNearest<T>(
  from: LatLng,
  items: T[],
  coordsOf: (item: T) => LatLng | null,
  options: { maxMeters: number; minMargin: number }
): NearestMatch<T> | null {
  const ranked = items
    .map((item) => ({ item, coords: coordsOf(item) }))
    .filter((row): row is { item: T; coords: LatLng } => row.coords !== null)
    .map((row) => ({ item: row.item, meters: distanceMeters(from, row.coords) }))
    .sort((a, b) => a.meters - b.meters);

  const nearest = ranked[0];
  if (!nearest || nearest.meters > options.maxMeters) return null;

  const runnerUp = ranked[1];
  if (runnerUp && runnerUp.meters - nearest.meters < options.minMargin) return null;

  return nearest;
}

/**
 * ระยะห่างเป็นเมตรด้วยสูตร haversine
 * ระยะในหมู่บ้านสั้นมากจนใช้สูตรระนาบธรรมดาก็พอ แต่ haversine ไม่ได้ช้ากว่ากัน
 * และไม่เพี้ยนถ้าวันหลังเอาไปใช้กับหมู่บ้านที่บ้านกระจายกันไกล
 */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6371000; // รัศมีโลกโดยประมาณ (เมตร)
  const rad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;

  // asin เกิน 1 ไม่ได้ — ปัดเศษทศนิยมอาจดันเลย 1 ไปนิดเดียวแล้วกลายเป็น NaN
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
