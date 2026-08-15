/**
 * เก็บคิวสแกนหลายรูปไว้ในเครื่อง เผื่อไฟดับ/เน็ตหลุด/เผลอปิดแท็บกลางคัน
 *
 * เก็บเฉพาะ "ข้อมูลแถว" ไม่เก็บตัวรูป — เพราะหลังจาก AI อ่านเลขเสร็จแล้ว
 * การออกบิลใช้แค่ บ้าน + รอบบิล + เลขมิเตอร์ + วันจด รูปเป็นแค่ของไว้ให้คนเทียบด้วยตา
 * ถ้าดันไปเก็บรูปด้วยจะกลายเป็นหลายร้อยเมกะไบต์ต่อคิว เขียนช้าและเต็มโควตาเบราว์เซอร์
 *
 * ทุกฟังก์ชันต้องพังแบบเงียบ ๆ ได้ — localStorage โยน error ได้ทั้งตอนอ่านและเขียน
 * (โหมดส่วนตัวของ Safari, โควตาเต็ม, ผู้ใช้ปิดคุกกี้) และคิวนี้เป็นแค่ตัวช่วย
 * ห้ามทำให้หน้าจดมิเตอร์ใช้งานไม่ได้เด็ดขาด
 */

const STORAGE_KEY = 'water-bill.batch-queue';

/** คิวที่ค้างเกิน 3 วันถือว่าไม่เกี่ยวกับงานวันนี้แล้ว กู้มาก็มีแต่ทำให้สับสน */
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

export interface StoredRow {
  seq: number;
  fileName: string;
  /** เก็บเป็น ISO string เพราะ JSON ไม่มีชนิด Date */
  capturedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  memberId: number | null;
  matchedBy: string;
  matchMeters: number | null;
  billingKey: string;
  billingFromPhoto: boolean;
  unit: number | null;
  confidence: number | null;
  confirmHighUsage: boolean;
  status: string;
  error: string | null;
  billId: number | null;
}

export interface StoredQueue {
  savedAt: number;
  /** คิวของใคร — คนละคนที่ล็อกอินเครื่องเดียวกันต้องไม่เห็นคิวของอีกคน */
  adminId: number | null;
  rows: StoredRow[];
}

export function saveQueue(queue: StoredQueue): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.warn('เก็บคิวไว้ในเครื่องไม่สำเร็จ ข้ามไปก่อน:', err);
  }
}

export function clearQueue(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ลบไม่ได้ก็ปล่อยไป เดี๋ยวหมดอายุเองใน 3 วัน
  }
}

/**
 * อ่านคิวที่ค้างไว้ — คืน null ถ้าไม่มี/หมดอายุ/เป็นของคนอื่น/ข้อมูลเพี้ยน
 * ข้อมูลใน localStorage แก้ด้วยมือได้ จึงต้องตรวจรูปร่างทุกครั้ง ไม่ใช่ cast แล้วใช้เลย
 */
export function loadQueue(adminId: number | null): StoredQueue | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    console.warn('อ่านคิวจากเครื่องไม่สำเร็จ:', err);
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.rows) || typeof parsed.savedAt !== 'number') return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) return null;

    // เก็บตอนยังไม่รู้ว่าใคร (adminId เป็น null) ให้ใช้ได้ตามเดิม
    if (parsed.adminId != null && adminId != null && parsed.adminId !== adminId) return null;

    const rows = parsed.rows.filter(isStoredRow);
    return rows.length ? { savedAt: parsed.savedAt, adminId: parsed.adminId ?? null, rows } : null;
  } catch {
    // ข้อมูลเสีย อ่านไม่ออก — ทิ้งไปเลยดีกว่าปล่อยให้ค้างแล้วพังซ้ำทุกครั้งที่เปิดหน้า
    clearQueue();
    return null;
  }
}

function isStoredRow(row: any): row is StoredRow {
  return (
    !!row &&
    typeof row.seq === 'number' &&
    typeof row.billingKey === 'string' &&
    typeof row.status === 'string'
  );
}
