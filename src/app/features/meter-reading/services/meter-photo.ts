import { API_BASE_URL } from '../../../core/api.config';

/**
 * รูปหน้าปัดมิเตอร์ที่ถ่ายไว้ตอนจดเลข — เก็บติดกับการจดมิเตอร์ (meter_readings)
 * ไม่ใช่ติดกับบิล เพราะบิลออกใหม่ทับได้แต่การจดครั้งนั้นคือเหตุการณ์เดียว
 *
 * หลังบ้านคืนมาเป็น path สั้น ๆ ('/uploads/meters/xxx.jpg') ไม่ใช่ URL เต็ม
 * ถ้าใส่ลง <img src> ตรง ๆ เบราว์เซอร์จะไปหาที่ origin ของหน้าเว็บ (:4200)
 * ซึ่งไม่มีไฟล์นั้น จึงต้องเติม API_BASE_URL (:3000) ให้เอง
 */
export function meterPhotoOf(bill: any): string | null {
  // รับทั้งแบบซ้อนใน meter_reading และแบบแบนมากับบิล เพราะ /bills กับ /me/bills
  // ไม่ได้ประกอบ response ด้วยโค้ดชุดเดียวกัน ถ้ายึดโครงเดียวแล้ววันหลังคืนอีกแบบ
  // รูปจะหายไปเงียบ ๆ โดยไม่มี error ให้เห็น
  const raw: string | null = bill?.meter_reading?.meter_photo ?? bill?.meter_photo ?? null;
  if (!raw) return null;

  // data: URL (รูปที่เพิ่งถ่ายยังไม่ได้ส่ง) และ URL เต็ม ใช้ได้ตามที่เป็น
  if (/^(data:|https?:)/i.test(raw)) return raw;

  return API_BASE_URL + (raw.startsWith('/') ? raw : `/${raw}`);
}
