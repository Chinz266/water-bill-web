import { CanDeactivateFn } from '@angular/router';
import { toast } from 'ngx-sonner';
// import type เท่านั้น — ถ้า import ตัวจริง หน้านี้จะถูกโหลดตั้งแต่ตอนเปิดเว็บ ไม่ lazy อีกต่อไป
import type { BatchRegisterComponent } from './batch-register';

/**
 * กันเดินออกจากหน้าระหว่างคิวกำลังเดิน — ออกไปแล้วคอมโพเนนต์ถูกทำลาย
 * บ้านที่ยังไม่ได้ลงทะเบียนหายไปทั้งกอง เหลือบ้านที่สร้างไปแล้วครึ่ง ๆ กลาง ๆ
 * โดยไม่มีรายการค้างให้ดูว่าถึงหลังไหน (รูปกับข้อมูลที่พิมพ์ไว้ไม่ได้ถูกเก็บลงเครื่อง)
 */
export const batchRegisterLeaveGuard: CanDeactivateFn<BatchRegisterComponent> = (component) => {
  if (!component.isBusy) return true;

  toast.error('กำลังลงทะเบียนอยู่ กดปุ่ม "หยุดคิว" ก่อนออกจากหน้านี้', { id: 'reg-leave' });
  return false;
};
