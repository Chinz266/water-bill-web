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
