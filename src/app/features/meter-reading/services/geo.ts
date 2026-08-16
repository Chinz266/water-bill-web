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

/**
 * จุดกึ่งกลางของกลุ่มพิกัด — ใช้ค่ากลาง (median) ทีละแกน ไม่ใช่ค่าเฉลี่ย
 *
 * มีไว้หา "ใจกลางหมู่บ้าน" จากพิกัดของบ้านที่เก็บไว้ เพื่อจับบ้านที่พิกัดเพี้ยน
 * ค่าเฉลี่ยใช้ไม่ได้ เพราะพิกัดที่เพี้ยนมักเพี้ยนไปไกลเป็นร้อยกิโล (เครื่องเดาจาก IP
 * แล้วคืนจุดกึ่งกลางของเขตเน็ตแทนตำแหน่งจริง) หลังเดียวก็ลากค่าเฉลี่ยออกนอกหมู่บ้านได้
 * ส่วนค่ากลางไม่สนใจว่าตัวนอกกลุ่มจะไกลแค่ไหน
 */
export function medianCoords(points: LatLng[]): LatLng | null {
  const usable = (points ?? []).filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!usable.length) return null;

  const middle = <K extends keyof LatLng>(key: K): number => {
    const values = usable.map((p) => p[key]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };

  return { lat: middle('lat'), lng: middle('lng') };
}

/**
 * ระยะที่ถือว่าพิกัด "หลุดออกไปนอกหมู่บ้าน" แล้ว
 *
 * หมู่บ้านจริงกว้างไม่กี่ร้อยเมตร ส่วนพิกัดที่เครื่องเดาจากเน็ต (ตอนหาสัญญาณ GPS ไม่ได้)
 * มักหลุดไปเป็นสิบเป็นร้อยกิโล — ตั้ง 2 กม. จึงแยกสองอย่างนี้ออกจากกันได้ขาด
 * โดยไม่ไปแตะพิกัดของหมู่บ้านที่บ้านกระจายกันไกลหน่อย
 */
export const OUTSIDE_VILLAGE_M = 2000;

/** จุดนี้หลุดออกไปนอกกลุ่มหรือยัง — ข้อมูลไม่ครบให้ตอบ false ไว้ก่อน (ห้ามกล่าวหามั่ว) */
export function isFarFrom(center: LatLng | null, point: LatLng | null, maxMeters = OUTSIDE_VILLAGE_M): boolean {
  if (!center || !point) return false;
  return distanceMeters(center, point) > maxMeters;
}

/**
 * ผลการเลือกตัวที่ใกล้ที่สุด — แยก "ไม่เจอ" ออกจาก "เจอแต่ชี้ขาดไม่ได้"
 *
 * เดิมคืน null ทั้งสองกรณี ฝั่งที่เรียกจึงบอกคนใช้งานได้แค่ "เดาไม่ได้" ทั้งที่สองอย่างนี้
 * ต้องทำคนละอย่าง: ไม่เจอ = ไปหาเองใน dropdown · ก้ำกึ่ง = ดูรูปแล้วกดเลือกจากสองหลังนี้
 */
export type NearestOutcome<T> =
  | { kind: 'match'; item: T; meters: number }
  | { kind: 'ambiguous'; item: T; meters: number; rival: T; rivalMeters: number }
  | { kind: 'none' };

/**
 * เลือกตัวที่ใกล้ที่สุด "แบบมั่นใจพอ" — เดาไม่ได้ให้บอกว่าเดาไม่ได้ ดีกว่าเดาผิด
 *
 * นอกจากต้องอยู่ในรัศมี maxMeters แล้ว ยังต้องทิ้งห่างอันดับสองอย่างน้อย minMargin
 * เพราะถ้าสองหลังห่างจากจุดถ่ายพอ ๆ กัน การที่หลังหนึ่งใกล้กว่าอีกหลัง 2 เมตร
 * ไม่ได้แปลว่าถูก — ความคลาดเคลื่อนของ GPS มากกว่านั้นเยอะ เดาไปก็เท่ากับโยนหัวก้อย
 *
 * ⚠️ ตัวที่คืนมาพร้อม kind 'ambiguous' ยัง **ห้ามเอาไปใช้เป็นคำตอบ** มีไว้บอกคนว่า
 *    ระบบลังเลอยู่ระหว่างหลังไหนกับหลังไหน ห่างกันเท่าไร เท่านั้น
 */
export function pickNearest<T>(
  from: LatLng,
  items: T[],
  coordsOf: (item: T) => LatLng | null,
  options: { maxMeters: number; minMargin: number }
): NearestOutcome<T> {
  const ranked = items
    .map((item) => ({ item, coords: coordsOf(item) }))
    .filter((row): row is { item: T; coords: LatLng } => row.coords !== null)
    .map((row) => ({ item: row.item, meters: distanceMeters(from, row.coords) }))
    .sort((a, b) => a.meters - b.meters);

  const nearest = ranked[0];
  if (!nearest || nearest.meters > options.maxMeters) return { kind: 'none' };

  const runnerUp = ranked[1];
  if (runnerUp && runnerUp.meters - nearest.meters < options.minMargin) {
    return {
      kind: 'ambiguous',
      item: nearest.item,
      meters: nearest.meters,
      rival: runnerUp.item,
      rivalMeters: runnerUp.meters
    };
  }

  return { kind: 'match', item: nearest.item, meters: nearest.meters };
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
