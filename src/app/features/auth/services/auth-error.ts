import { HttpErrorResponse } from '@angular/common/http';

// แปลง error จาก HttpClient ให้เป็นข้อความภาษาไทยที่ผู้ใช้อ่านรู้เรื่อง
export function extractErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof HttpErrorResponse)) return fallback;

  // status 0 = ยิงไปไม่ถึงเซิร์ฟเวอร์ (ลืมเปิด NestJS หรือ CORS บล็อก)
  if (err.status === 0) {
    return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบว่า NestJS รันอยู่ที่ port 3000';
  }

  // NestJS คืน { statusCode, message } โดย message อาจเป็น string หรือ array (validation)
  const message = err.error?.message;
  if (Array.isArray(message)) return message.join(', ');
  if (typeof message === 'string' && message.trim()) return message;

  return fallback;
}
