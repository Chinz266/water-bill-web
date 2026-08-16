import { HttpErrorResponse } from '@angular/common/http';

// แปลง error จาก HttpClient ให้เป็นข้อความภาษาไทยที่ผู้ใช้อ่านรู้เรื่อง
export function extractErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof HttpErrorResponse)) return fallback;

  // status 0 = ยิงไปไม่ถึงเซิร์ฟเวอร์ (ลืมเปิด backend หรือ CORS บล็อก)
  // ข้อความต้องเป็นภาษาที่เจ้าหน้าที่หมู่บ้านอ่านแล้วรู้ว่าต้องทำอะไรต่อ ห้ามใช้ศัพท์เทคนิค
  if (err.status === 0) {
    return 'ตอนนี้เชื่อมต่อระบบไม่ได้ กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้รบกวนแจ้งผู้ดูแลระบบนะครับ';
  }

  // NestJS คืน { statusCode, message } โดย message อาจเป็น string หรือ array (validation)
  const message = err.error?.message;
  if (Array.isArray(message)) return message.join(', ');
  if (typeof message === 'string' && message.trim()) return message;

  return fallback;
}

/**
 * รหัสด่านที่หลังบ้านแนบมาใน body ({ statusCode, message, code })
 *
 * ต้องแยกด่านด้วยรหัส ไม่ใช่การหาคำในข้อความ — ข้อความเป็นภาษาไทยที่แก้เมื่อไหร่ก็ได้
 * และคำอย่าง "หลัก" หรือ "เลข" โผล่ในข้อความของหลายด่านพร้อมกัน พอแยกผิดจะเอาปุ่ม
 * "ยืนยันว่าถูกต้อง" ไปแปะให้ด่านที่ห้ามข้าม (เช่นรูปซ้ำ/บิลจ่ายแล้ว)
 *
 * ⚠️ status ไม่คงที่ — ด่านมิเตอร์เดินถอยหลังเป็น 400 ส่วนที่เหลือเป็น 409
 *    ตัดสินจากรหัสอย่างเดียว อย่าผูกกับ status
 */
export function extractErrorCode(err: unknown): string | null {
  if (!(err instanceof HttpErrorResponse)) return null;

  const code = err.error?.code;
  return typeof code === 'string' && code.trim() ? code : null;
}
