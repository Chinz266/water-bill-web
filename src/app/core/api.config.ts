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

/**
 * หา URL ของ Backend ให้เหมาะกับสภาพแวดล้อมที่เปิดหน้าเว็บ
 *
 * - โหมดพัฒนา HTTP ใช้ hostname เดียวกันที่พอร์ต 3000
 * - เว็บจริง HTTPS ใช้ reverse proxy ที่ /api เพื่อไม่ให้เบราว์เซอร์บล็อก mixed content
 * - override ใช้ได้ทั้ง URL เต็มและ path ภายในโดเมนเดียวกัน
 */
export function resolveApiBaseUrl(
  currentUrl?: string,
  override?: string,
): string {
  const pageUrl = new URL(
    currentUrl ??
      (typeof window !== 'undefined' ? window.location.href : 'http://localhost:4200'),
  );

  if (override?.trim()) {
    const apiUrl = new URL(override.trim(), pageUrl.origin);
    if (!['http:', 'https:'].includes(apiUrl.protocol)) {
      throw new Error('API URL ต้องใช้ http หรือ https เท่านั้น');
    }
    if (apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash) {
      throw new Error('API URL ห้ามมีข้อมูลล็อกอิน query string หรือ fragment');
    }
    if (pageUrl.protocol === 'https:' && apiUrl.protocol !== 'https:') {
      throw new Error('หน้าเว็บ HTTPS ต้องเชื่อมต่อ API ผ่าน HTTPS');
    }
    return apiUrl.href.replace(/\/$/, '');
  }

  if (pageUrl.protocol === 'https:') {
    return `${pageUrl.origin}/api`;
  }

  return `http://${pageUrl.hostname}:${BACKEND_PORT}`;
}

export const API_BASE_URL = resolveApiBaseUrl();
