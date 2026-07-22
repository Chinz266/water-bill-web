/**
 * หมวดหมู่และสถานะของระบบแจ้งเรื่อง — ใช้ร่วมกันทั้งหน้าลูกบ้านและหน้าเจ้าหน้าที่
 *
 * ⚠️ ค่า `value` ต้องตรงกับ REPORT_CATEGORIES / REPORT_STATUSES ฝั่งหลังบ้าน
 *    (water-bill-service/src/report/report.constants.ts) ถ้าแก้ต้องแก้ทั้งสองที่
 *    หลังบ้านเก็บเป็นรหัสอังกฤษ ส่วนคำไทยที่ผู้ใช้เห็นแปลที่นี่
 */

export interface ReportCategoryOption {
  value: string;
  label: string;
  icon: string;
}

export const REPORT_CATEGORIES: ReportCategoryOption[] = [
  { value: 'WATER_OUT', label: 'น้ำไม่ไหล', icon: '🚱' },
  { value: 'WATER_DIRTY', label: 'น้ำขุ่น / สกปรก', icon: '🟤' },
  { value: 'PIPE_LEAK', label: 'ท่อแตก / น้ำรั่ว', icon: '💦' },
  { value: 'METER_BROKEN', label: 'มิเตอร์ผิดปกติ', icon: '⏱️' },
  { value: 'BILL_WRONG', label: 'บิลไม่ถูกต้อง', icon: '🧾' },
  { value: 'OTHER', label: 'เรื่องอื่น ๆ', icon: '💬' },
];

/** แปลงรหัสหมวดเป็นคำไทย — ถ้าเจอรหัสแปลก ๆ (ข้อมูลเก่า) ให้คืนคำกลาง ๆ ไม่ให้จอว่าง */
export function categoryLabel(value: string): string {
  return REPORT_CATEGORIES.find((c) => c.value === value)?.label ?? 'เรื่องอื่น ๆ';
}

export function categoryIcon(value: string): string {
  return REPORT_CATEGORIES.find((c) => c.value === value)?.icon ?? '💬';
}

export interface ReportStatusOption {
  value: string;
  label: string;
  /** คลาส chip ใน styles.css — คุมสีป้ายสถานะให้ตรงกันทุกหน้า */
  chip: string;
}

export const REPORT_STATUSES: ReportStatusOption[] = [
  { value: 'Pending', label: 'รอดำเนินการ', chip: 'chip-warning' },
  { value: 'InProgress', label: 'กำลังดำเนินการ', chip: 'chip-info' },
  { value: 'Resolved', label: 'เสร็จสิ้น', chip: 'chip-success' },
];

export function statusLabel(value: string): string {
  return REPORT_STATUSES.find((s) => s.value === value)?.label ?? 'รอดำเนินการ';
}

export function statusChip(value: string): string {
  return REPORT_STATUSES.find((s) => s.value === value)?.chip ?? 'chip-warning';
}

/** ความยาวรายละเอียดสูงสุด — ต้องตรงกับ REPORT_DETAIL_MAX ฝั่งหลังบ้าน */
export const REPORT_DETAIL_MAX = 2000;
