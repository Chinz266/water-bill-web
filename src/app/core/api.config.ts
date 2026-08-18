/**
 * 🌐 ที่อยู่ของหลังบ้าน (NestJS) — จุดเดียวของทั้งแอป
 * (interceptor ก็ใช้ค่านี้ตัดสินใจว่า request ไหนต้องแนบ JWT)
 *
 * ใช้ hostname เดียวกับที่เปิดเว็บอยู่ แล้วต่อพอร์ต 3000 ของหลังบ้าน
 * - เปิดบนคอมผ่าน localhost  → API = http://localhost:3000
 * - เปิดบนมือถือผ่าน IP เครื่อง → API = http://192.168.x.x:3000 (มือถือเข้าถึงได้)
 *   ถ้า fix เป็น localhost ตายตัว มือถือจะยิงไปหาตัวเอง แล้ว API พังทันที
 */
const BACKEND_PORT = 3000;

function resolveApiBaseUrl(): string {
  // เผื่อรันในที่ที่ไม่มี window (เช่น unit test ใน node) — ฝั่งเบราว์เซอร์จะคำนวณใหม่เอง
  if (typeof window !== 'undefined' && window.location?.hostname) {
    return `http://${window.location.hostname}:${BACKEND_PORT}`;
  }
  return `http://localhost:${BACKEND_PORT}`;
}

export const API_BASE_URL = resolveApiBaseUrl();
