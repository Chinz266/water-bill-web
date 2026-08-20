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

/** ทิศทางแบบที่คนหน้างานใช้จริง — ต้องสะกดตรงกับ RelativeDirectionUtil ของหลังบ้านคำต่อคำ */
export type SideLabel = 'บน' | 'ล่าง' | 'ซ้าย' | 'ขวา';

/**
 * ระยะต่ำสุดที่ทิศทางระหว่างสองจุด "เป็นข้อมูล" ไม่ใช่เสียงรบกวน (เมตร)
 *
 * ตรงกับ RelativeDirectionUtil.GPS_FLOOR_M ของหลังบ้าน — สองหมุดที่ห่างกันน้อยกว่านี้
 * ให้ทิศอะไรก็ได้ขึ้นกับว่าตอนลงทะเบียนเครื่องเพี้ยนไปทางไหน วัดใหม่อีกรอบอาจสลับข้างเลย
 */
export const SIDE_FLOOR_M = 3;

/**
 * ความคลาดที่ต้องสมมติให้บ้านที่ยังไม่มีประวัติการจดพอจะวัดการกระจายได้ (เมตร)
 *
 * ตรงกับ MemberService.MAX_ACCEPTABLE_ACCURACY_M — เพดานที่ระบบยอมรับตอนลงทะเบียน
 * ระบบไม่ได้เก็บค่าความคลาดจริงของแต่ละหมุดไว้ เพดานจึงเป็นขอบเขตเดียวที่มี
 *
 * ผลคือบ้านที่เพิ่งลงทะเบียนจะไม่ได้ป้ายซ้าย/ขวาเลยจนกว่าจะจดไปสัก 3 ครั้ง —
 * **ถูกแล้ว** หมุดสองอันที่คลาดได้ ±20 ม. บอกลำดับของบ้านที่ห่างกัน 15 ม. ไม่ได้จริง ๆ
 * ป้ายที่ขึ้นมาตอนนั้นคือการเดาที่ดูน่าเชื่อถือ ซึ่งแย่กว่าการไม่ขึ้นอะไรเลย
 */
export const UNMEASURED_SPREAD_M = 20;

/**
 * ระยะขั้นต่ำที่ทิศระหว่างบ้านสองหลัง "เป็นข้อมูล" สำหรับคู่นี้โดยเฉพาะ
 *
 * ═══ ทำไมค่าตายตัวใช้ไม่ได้ ═══
 *
 * ความแม่นของพิกัดต่างกันหลายเท่าตามสภาพหน้างาน — มิเตอร์กลางทุ่งโล่งกระจายไม่ถึง 5 ม.
 * ส่วนมิเตอร์ใต้ชายคาติดกำแพงกระจายได้ถึง 40 ม. เกณฑ์เดียวจึงหลวมเกินไปสำหรับบ้านแรก
 * และคับเกินไปสำหรับบ้านหลังเสมอ ไม่ว่าจะตั้งไว้ที่เท่าไร
 * (`BillsService.nearLimitFor()` ของหลังบ้านคิดแบบเดียวกันนี้กับรัศมี "ใกล้" อยู่แล้ว)
 *
 * ความคลาดของผลต่างระหว่างสองจุดคือ √(σ₁² + σ₂²) จึงรวมด้วย hypot ไม่ใช่บวกตรง ๆ
 *
 * ⚠️ ใช้ spread (MAD ของการจดแต่ละครั้ง) ตรง ๆ ทั้งที่ค่าที่ถูกต้องทางสถิติคือความคลาด
 *    ของ**มัธยฐาน** ซึ่งเล็กกว่าตามจำนวนครั้งที่จด (≈ 1.86·MAD/√N) — หลังบ้านไม่ได้ส่ง
 *    จำนวนครั้งมาให้ และการประเมินสูงเกินไปแปลว่าป้ายขึ้นน้อยกว่าที่ควร ซึ่งเป็นทิศที่
 *    ผิดพลาดได้อย่างปลอดภัยกว่าการขึ้นป้ายที่เชื่อไม่ได้
 */
export function sideFloorFor(spreadA: number | null, spreadB: number | null): number {
  const a = spreadA ?? UNMEASURED_SPREAD_M;
  const b = spreadB ?? UNMEASURED_SPREAD_M;

  return Math.max(SIDE_FLOOR_M, Math.hypot(a, b));
}

/**
 * มุมกวาดจากทิศเหนือตามเข็มนาฬิกา (0–360) — null เมื่อสองจุดทับกันสนิท
 *
 * ใช้ atan2(ตะวันออก, เหนือ) บนระนาบท้องถิ่น เหมือนหลังบ้าน ระยะระดับเมตรไม่มีทาง
 * เห็นความต่างจากสูตร great-circle และสูตรนี้อ่านออกว่ากำลังทำอะไรอยู่
 */
export function bearingDegrees(from: LatLng, to: LatLng): number | null {
  const rad = (deg: number) => (deg * Math.PI) / 180;

  const north = to.lat - from.lat;
  const east = (to.lng - from.lng) * Math.cos(rad((from.lat + to.lat) / 2));

  if (north === 0 && east === 0) return null;

  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
}

/**
 * จุดปลายทางอยู่ทางไหนของจุดตั้งต้น — **null เมื่อสองจุดใกล้กันเกินกว่าจะเชื่อทิศได้**
 *
 * ⚠️ ตัวนี้ตอบได้แค่ "หมุดสองหมุดที่จดไว้ วางตัวยังไงเทียบกัน" ไม่ได้ตอบว่า "คนถ่ายยืนอยู่
 *    ตรงไหน" — ระยะห่างระหว่างหมุดต้องชนะความคลาดเคลื่อนตอนลงทะเบียนก่อน ถึงจะมีความหมาย
 *    มิเตอร์บนกำแพงเดียวกันห่างกัน 30 ซม. จึงคืน null เสมอ ซึ่งเป็นคำตอบที่ถูก
 *    (ตัวที่ตอบซ้าย/ขวาในกลุ่มนั้นได้จริงคือ sequence_index ที่คนจดไว้ล่วงหน้า)
 *
 * แบ่งช่วงที่ 45° ตามแนวทแยงเหมือนหลังบ้านเป๊ะ — ป้ายบนจอกับข้อความที่หลังบ้านตีกลับมา
 * ต้องเรียกทิศเดียวกันด้วยคำเดียวกัน ไม่งั้นคนอ่านแล้วนึกว่าเป็นคนละเรื่อง
 */
export function sideOf(from: LatLng, to: LatLng, floorMeters = SIDE_FLOOR_M): SideLabel | null {
  if (distanceMeters(from, to) < floorMeters) return null;

  const bearing = bearingDegrees(from, to);
  if (bearing === null || !Number.isFinite(bearing)) return null;

  const angle = ((bearing % 360) + 360) % 360;
  if (angle >= 315 || angle < 45) return 'บน';
  if (angle < 135) return 'ขวา';
  if (angle < 225) return 'ล่าง';
  return 'ซ้าย';
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
