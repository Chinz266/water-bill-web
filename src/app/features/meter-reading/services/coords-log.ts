import { LatLng, distanceMeters } from './geo';

/**
 * รายงานพิกัดที่ไม่ตรงลง terminal — แทนการให้หน้าเว็บเขียนทับพิกัดบ้านเอง
 *
 * เดิมตอนออกบิลผ่าน หน้าเว็บจะยิง /member/update ทับพิกัดที่ "เสียชัด ๆ" ให้เงียบ ๆ
 * ซึ่งแก้ตรงจุดก็จริง แต่ไม่มีใครเห็นว่ามันไปทับของบ้านหลังไหนบ้าง และถ้าทับผิด
 * (รูปที่ถ่ายจากหน้าบ้านคนอื่น จับคู่มาผิดหลัง) ก็ไม่เหลือร่องรอยให้ย้อนดูเลย
 *
 * ตอนนี้เหลือแค่บอกให้รู้ว่าบ้านหลังไหนพิกัดไม่ตรง แล้วให้คนไปกดแก้เองที่หน้าทะเบียน
 * ลูกบ้าน (มีทั้งปุ่มเติมพิกัดจากรูป และปุ่มยกพิกัดจากครั้งที่จดอยู่แล้ว)
 */
export interface CoordsReport {
  /** หน้าที่เจอเรื่อง — ไล่ย้อนได้ว่าบรรทัดนี้เกิดตอนออกบิลโหมดไหน */
  source: 'batch-scan' | 'meter-cropper';
  houseNo: unknown;
  memberId: unknown;
  /** พิกัดที่บ้านหลังนี้เก็บไว้ในทะเบียน — null คือยังไม่เคยเก็บ */
  saved: LatLng | null;
  /** พิกัดที่ติดมากับรูปของบิลที่เพิ่งออกไป */
  photo: LatLng;
}

/** ทศนิยม 6 ตำแหน่ง ≈ 0.1 เมตร ละเอียดกว่านี้ไม่มีความหมายกับ GPS มือถือ */
const point = (coords: LatLng): string => `${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}`;

const gapLabel = (meters: number): string =>
  meters >= 1000 ? `${(meters / 1000).toFixed(1)} กม.` : `${Math.round(meters)} ม.`;

/**
 * บรรทัดเดียวจบต่อหนึ่งบ้าน — อ่านไล่ทีเดียวได้เหมือน log ของ meter-vision
 * ใช้ console.warn เพราะเป็นเรื่องที่ต้องมีคนตามไปแก้ ไม่ใช่ของที่ถูกต้องอยู่แล้ว
 */
export function logCoordsMismatch(report: CoordsReport): void {
  const saved = report.saved
    ? `${point(report.saved)} (ห่างจากรูป ${gapLabel(distanceMeters(report.saved, report.photo))})`
    : 'ยังไม่มี';

  console.warn(
    `[coords] พิกัดทะเบียนไม่ตรงกับรูป | บ้าน ${report.houseNo} (id ${report.memberId})` +
      ` | ทะเบียน ${saved} | รูป ${point(report.photo)} | ${report.source}` +
      ' | แก้ที่หน้าทะเบียนลูกบ้าน'
  );
}

/** รูปหนึ่งใบที่พิกัดชี้ได้สองหลังพอ ๆ กัน — ระบบเลือกให้ไม่ได้ ต้องให้คนกด */
export interface AmbiguousReport {
  source: CoordsReport['source'];
  photo: LatLng;
  /** หลังที่ใกล้ที่สุด และหลังรองที่ตามมาติด ๆ จนแยกไม่ออก */
  nearest: { houseNo: unknown; meters: number };
  rival: { houseNo: unknown; meters: number };
}

/**
 * รายงานจุดที่ GPS ชี้ขาดไม่ได้ ลง terminal — ไม่ได้มีไว้ให้ระบบเอาไปตัดสินอะไรต่อ
 *
 * มีไว้ให้ไล่ดูย้อนหลังว่าหมู่บ้านไหน/ช่วงบ้านเลขที่ไหนที่มิเตอร์อยู่ชิดกันจนเจ้าหน้าที่
 * ต้องมากดเลือกเองซ้ำ ๆ ทุกเดือน จุดพวกนั้นแก้ที่ต้นเหตุได้ (ไปวัดพิกัดของสองหลังนั้นใหม่
 * ให้ตรงมิเตอร์จริง) ซึ่งคุ้มกว่ามาไล่กดทีละรอบบิล
 *
 * ใช้ console.info ไม่ใช่ warn — ไม่มีอะไรพัง แค่ระบบไม่มั่นใจแล้วส่งงานคืนคนตามที่ควรเป็น
 */
export function logAmbiguousMatch(report: AmbiguousReport): void {
  const gap = Math.abs(report.rival.meters - report.nearest.meters);

  console.info(
    `[coords] พิกัดชี้ได้หลายหลัง | ${report.nearest.houseNo} (${gapLabel(report.nearest.meters)})` +
      ` กับ ${report.rival.houseNo} (${gapLabel(report.rival.meters)}) ต่างกัน ${gapLabel(gap)}` +
      ` | รูป ${point(report.photo)} | ${report.source}` +
      ' | ถ้าเจอซ้ำทุกเดือน ให้ไปวัดพิกัดสองหลังนี้ใหม่ที่หน้าทะเบียนลูกบ้าน'
  );
}
