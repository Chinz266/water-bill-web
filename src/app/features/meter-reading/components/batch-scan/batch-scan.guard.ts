import { CanDeactivateFn } from '@angular/router';
import { toast } from 'ngx-sonner';
// import type เท่านั้น — ถ้า import ตัวจริง หน้านี้จะถูกโหลดตั้งแต่ตอนเปิดเว็บ ไม่ lazy อีกต่อไป
import type { BatchScanComponent } from './batch-scan';

/**
 * กันเดินออกจากหน้าระหว่างคิวกำลังเดิน — ออกไปแล้วคอมโพเนนต์ถูกทำลาย
 * คิวที่เหลือหายไปทั้งกอง เหลือบิลที่ออกไปแล้วครึ่ง ๆ กลาง ๆ โดยไม่มีรายการค้างให้ดูว่าถึงใบไหน
 */
export const batchScanLeaveGuard: CanDeactivateFn<BatchScanComponent> = (component) => {
  if (!component.isBusy) return true;

  toast.error('กำลังทำงานอยู่ กดปุ่ม "หยุดคิว" ก่อนออกจากหน้านี้', { id: 'batch-leave' });
  return false;
};
