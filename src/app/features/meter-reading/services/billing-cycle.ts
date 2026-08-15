/**
 * รอบบิลของบ้านแต่ละหลัง — คิดจาก "วันที่ไปจดจริง" ไม่ใช่เดือนบนปฏิทิน
 *
 * เจ้าหน้าที่เดินจดทั้งหมู่บ้านไม่จบในวันเดียว บ้านต้นซอยอาจโดนจดวันที่ 3
 * ท้ายซอยวันที่ 9 และเดือนถัดไปก็เลื่อนไปอีก ถ้าถือว่าทุกหลังใช้น้ำ
 * "เดือนสิงหาคม" เท่ากันหมด บ้านที่รอบยาว 35 วันกับบ้านที่รอบ 26 วัน
 * จะถูกเทียบกันเหมือนใช้เวลาเท่ากัน ทั้งที่ต่างกันเกือบสิบวัน
 *
 * รอบของบ้านหนึ่งจึงคือ "วันจดครั้งก่อน → วันจดครั้งนี้" ซึ่งตรงกับวิธีที่
 * หลังบ้านคิดหน่วยน้ำอยู่แล้ว (เลขตั้งต้นมาจากบิลใบก่อนของบ้านหลังเดียวกัน)
 * ใบแรกสุดของบ้านจึงไม่มีรอบ เพราะเลขตั้งต้นมาจากตอนลงทะเบียน ไม่ใช่จากบิล
 *
 * ไฟล์นี้เป็นฟังก์ชันล้วน ไม่มี Angular เพราะถูกเรียกทั้งจากหน้าเจ้าหน้าที่
 * หน้าลูกบ้าน และเอกสารที่พิมพ์ลงกระดาษ
 */

export interface BillingCycle {
  /** วันที่จดของรอบก่อน = จุดเริ่มของรอบนี้ */
  start: Date;
  /** วันที่จดของรอบนี้ */
  end: Date;
  /** จำนวนวันที่นับได้จริง (5 ก.ค. → 4 ส.ค. = 30 วัน) */
  days: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * แปลงวันที่จากหลังบ้านให้เป็น Date ของ "วันนั้นตามเวลาไทย"
 *
 * ห้ามโยน 'YYYY-MM-DD' เข้า new Date() ตรง ๆ เพราะสเปกบอกให้อ่านเป็นเที่ยงคืน UTC
 * พอเอาไปเรียก .getDate() บนเครื่องที่ timezone ติดลบ วันจะถอยไปหนึ่งวันเงียบ ๆ
 * ซึ่งกลายเป็นจำนวนวันในรอบบิลคลาดไปหนึ่งวันทั้งระบบ
 */
export function toLocalDate(raw: unknown): Date | null {
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : startOfDay(raw);
  if (typeof raw === 'number') {
    const stamp = new Date(raw);
    return isNaN(stamp.getTime()) ? null : startOfDay(stamp);
  }
  if (typeof raw !== 'string') return null;

  // รับทั้ง '2026-08-05', '2026-08-05T00:00:00Z' และแบบ EXIF '2026:08:05'
  const parts = /^(\d{4})[-:/](\d{1,2})[-:/](\d{1,2})/.exec(raw.trim());
  if (parts) {
    const year = Number(parts[1]);
    const month = Number(parts[2]);
    const day = Number(parts[3]);
    const date = new Date(year, month - 1, day);

    // เทียบย้อนกลับ เพราะ JS เลื่อนวันที่เกินจริงให้เงียบ ๆ ('2026-02-31' → 3 มี.ค.)
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return null;
    }
    return date;
  }

  const fallback = new Date(raw);
  return isNaN(fallback.getTime()) ? null : startOfDay(fallback);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * จำนวนวันระหว่างสองวัน — คิดจากเลขวัน/เดือน/ปี ไม่ใช่ลบ timestamp กันตรง ๆ
 * (ไทยไม่มี DST ก็จริง แต่ถ้าวันหลังมีใครเปิดดูจากต่างประเทศจะได้ไม่เพี้ยน)
 */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / MS_PER_DAY);
}

/** วันที่จดมิเตอร์ของบิลใบหนึ่ง — /bills กับ /me/bills ซ้อนคนละชั้น จึงต้องรับทั้งสองแบบ */
export function readingDateOf(bill: any): Date | null {
  return toLocalDate(bill?.meter_reading?.reading_date ?? bill?.reading_date);
}

/** บ้านเจ้าของบิล — บางที่ซ้อนมาเป็นก้อน member บางที่แบนมาเป็น members_id */
function memberIdOf(bill: any): number | null {
  const id = bill?.member?.id ?? bill?.members_id;
  return Number.isFinite(Number(id)) ? Number(id) : null;
}

/**
 * ทำตารางรอบบิลจากบิลทั้งกอง (คีย์ = id ของบิล)
 *
 * ต้องคิดจากทั้งกองทีเดียว เพราะรอบของใบหนึ่งต้องรู้ "ใบก่อนหน้าของบ้านหลังเดียวกัน"
 * ซึ่งดูจากตัวบิลใบเดียวไม่ได้เลย และหลังบ้านก็ไม่ได้ส่งวันจดของรอบก่อนติดมาด้วย
 */
export function buildCycleIndex(bills: any[]): Map<number, BillingCycle> {
  const byMember = new Map<number, { id: number; date: Date }[]>();

  for (const bill of bills ?? []) {
    const memberId = memberIdOf(bill);
    const date = readingDateOf(bill);
    if (memberId === null || !date || bill?.id === undefined || bill?.id === null) continue;

    const rows = byMember.get(memberId) ?? [];
    rows.push({ id: Number(bill.id), date });
    byMember.set(memberId, rows);
  }

  const index = new Map<number, BillingCycle>();
  for (const rows of byMember.values()) {
    rows.sort((a, b) => a.date.getTime() - b.date.getTime());

    for (let i = 1; i < rows.length; i++) {
      const start = rows[i - 1].date;
      const end = rows[i].date;
      const days = daysBetween(start, end);

      // จดสองใบลงวันเดียวกัน (ออกบิลย้อนหลังหรือทับใบเดิม) ไม่ใช่รอบที่มีความหมาย
      if (days <= 0) continue;

      index.set(rows[i].id, { start, end, days });
    }
  }

  return index;
}

/**
 * วันประจำเดือนที่บ้านหลังนี้ถูกจด — ใช้ค่ากลาง (median) ไม่ใช่ค่าเฉลี่ย
 * เดือนที่เจ้าหน้าที่ติดธุระแล้วจดช้าไปสิบวันมีจริง ค่าเฉลี่ยจะโดนดึงตามไปด้วย
 * ส่วนค่ากลางยังชี้วันที่ปกติของบ้านหลังนั้นอยู่
 */
export function anchorDayOf(dates: Date[]): number | null {
  const days = (dates ?? [])
    .filter((date): date is Date => date instanceof Date && !isNaN(date.getTime()))
    .map((date) => date.getDate())
    .sort((a, b) => a - b);

  if (!days.length) return null;
  return days[Math.floor(days.length / 2)];
}

/** วันจดครั้งล่าสุดที่เกิดก่อนวันที่กำหนด — จุดเริ่มของรอบที่กำลังจะออกบิล */
export function latestReadingBefore(dates: Date[], before: Date): Date | null {
  const earlier = (dates ?? [])
    .filter((date): date is Date => date instanceof Date && !isNaN(date.getTime()))
    .filter((date) => daysBetween(date, before) > 0)
    .sort((a, b) => a.getTime() - b.getTime());

  return earlier.length ? earlier[earlier.length - 1] : null;
}

/** วันที่ตามรอบประจำของบ้าน ในเดือนที่กำหนด (วันที่ 31 ในเดือน ก.พ. หดเหลือ 28/29 ให้เอง) */
function anchorDateIn(year: number, month: number, anchorDay: number): Date {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(anchorDay, lastDay));
}

/**
 * รูปที่ถ่ายวันนี้ ควรลงเป็นบิล "รอบเดือนไหน" ของบ้านหลังนี้
 *
 * บ้านที่ถูกจดปลายเดือน (วันที่ 28) แล้วเจ้าหน้าที่ไปจดวันที่ 2 ของเดือนถัดไป
 * ยังเป็นรอบของเดือนก่อน ไม่ใช่เดือนใหม่ — ถ้าลงเดือนใหม่ เดือนที่ใช้น้ำจริง
 * จะไม่มีบิล แถมไปกินโควตา "1 บ้าน 1 บิลต่อเดือน" ของเดือนที่ยังไม่ได้จดอีก
 *
 * จึงเทียบว่าวันถ่ายใกล้วันจดประจำของเดือนไหนมากกว่ากัน ระหว่างเดือนของรูปเอง
 * กับเดือนก่อนหน้า และ **ไม่เสนอเดือนที่ยังมาไม่ถึง** เพราะบิลของเดือนหน้า
 * ต้องรอไปจดเดือนหน้าจริง ๆ ไม่ใช่ออกล่วงหน้าจากรูปวันนี้
 */
export function suggestBillingMonth(
  captured: Date,
  anchorDay: number | null
): { key: string; month: string; year: string } {
  const year = captured.getFullYear();
  const month = captured.getMonth();

  if (!anchorDay) return billingKeyOf(year, month);

  const own = Math.abs(daysBetween(anchorDateIn(year, month, anchorDay), captured));
  const previousMonth = new Date(year, month - 1, 1);
  const previous = Math.abs(
    daysBetween(
      anchorDateIn(previousMonth.getFullYear(), previousMonth.getMonth(), anchorDay),
      captured
    )
  );

  return previous < own
    ? billingKeyOf(previousMonth.getFullYear(), previousMonth.getMonth())
    : billingKeyOf(year, month);
}

/** รูปแบบเดียวกับ BillPrintService.monthOptions() เพื่อให้เทียบ key กันได้ตรง ๆ */
function billingKeyOf(year: number, month: number): { key: string; month: string; year: string } {
  const mm = String(month + 1).padStart(2, '0');
  const yyyy = String(year);
  return { key: `${yyyy}-${mm}`, month: mm, year: yyyy };
}

/**
 * วันจดที่ผูกอยู่กับข้อมูลบ้านจาก /member/all
 *
 * หลังบ้านส่งของซ้อนมาไม่เหมือนกันทุกรุ่น (บางทีเป็น meter_readings บางทีเป็น bills)
 * และอาจไม่ส่งมาเลย — หน้าเว็บจึงต้องเก็บเท่าที่มี แล้วถ้าไม่มีก็เงียบไป
 * ไม่ใช่ยิง API เพิ่มทุกครั้งที่เปิดหน้าทะเบียนเพื่อของประกอบชิ้นเดียว
 */
export function memberReadingDates(member: any): Date[] {
  const raw: unknown[] = [
    ...(Array.isArray(member?.meter_readings) ? member.meter_readings.map((r: any) => r?.reading_date) : []),
    ...(Array.isArray(member?.bills) ? member.bills.map((b: any) => b?.meter_reading?.reading_date ?? b?.reading_date) : []),
    member?.initial_reading?.reading_date
  ];

  return raw
    .map((value) => toLocalDate(value))
    .filter((date): date is Date => date !== null);
}
