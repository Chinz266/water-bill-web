/**
 * เตรียมรูปหน้าปัดให้พร้อมส่งขึ้นหลังบ้าน — หลังบ้านรับเป็น data URL ใน JSON แล้วเก็บเป็นไฟล์
 *
 * ทำไมต้องคุมขนาดถึงระดับไบต์:
 * body-parser ของ NestJS ตั้งเพดาน JSON ไว้ 100kb เป็นค่าปริยาย ส่งเกินนี้จะโดนตีกลับ
 * เป็น `entity.too.large` ตั้งแต่ก่อนเข้า controller — คือบันทึกไม่ผ่านทั้งคำขอ
 * ทั้งที่ข้อมูลอย่างอื่นถูกหมด ส่วนรูปจากมือถือใบละ 3–8 MB และการแปลงเป็น base64
 * ยังบวกอีกหนึ่งในสาม จึงเกินเพดานแบบไม่ต้องลุ้น
 *
 * วิธีที่ใช้: ย่อขนาดกับลดคุณภาพไล่ลงไปทีละขั้นจนกว่าจะพอดีงบไบต์ที่ตั้งไว้
 * เอาใบที่ "ใหญ่ที่สุดเท่าที่ยังส่งผ่าน" เพราะรูปนี้มีไว้ให้คนเปิดเทียบเลขกับหน้าปัดย้อนหลัง
 * ถ้าย่อจนอ่านเลขไม่ออกก็ไม่เหลือประโยชน์อะไร
 *
 * ⚠️ ต้องอ่าน EXIF (วันถ่าย/พิกัด) จากไฟล์ต้นฉบับ **ก่อน** เรียกฟังก์ชันนี้เสมอ
 *    canvas เก็บแต่พิกเซล ข้อมูลที่กล้องฝังมาหายไปทั้งหมดตั้งแต่ตอนวาดลง canvas
 */

/**
 * งบขนาดของรูปหนึ่งใบใน JSON (ไบต์)
 *
 * ตั้งไว้ต่ำกว่าเพดาน 100kb ของหลังบ้านพอสมควร เผื่อฟิลด์อื่นในคำขอเดียวกัน
 * 👉 ถ้าฝั่งหลังบ้านขยายเพดานแล้ว (`app.use(json({ limit: '15mb' }))`) เพิ่มค่านี้ได้เลย
 *    รูปจะคมขึ้นมากและยังส่งผ่านเหมือนเดิม
 */
export const MAX_PHOTO_BYTES = 80_000;

/** ไล่ย่อจากใหญ่ไปเล็ก — ขั้นแรกคือขนาดที่อยากได้ ที่เหลือคือทางถอยเมื่อยังไม่พอดีงบ */
const EDGE_STEPS = [1280, 1024, 800, 640, 480];
const QUALITY_STEPS = [0.82, 0.65, 0.5];

export interface PhotoEncodeOptions {
  /** ด้านที่ยาวที่สุดของรูปที่อยากได้ (px) */
  maxEdge?: number;
  /** ความยาวของ data URL ที่ยอมได้ (ไบต์) */
  maxBytes?: number;
}

export async function photoDataUrl(
  file: Blob,
  { maxEdge = EDGE_STEPS[0], maxBytes = MAX_PHOTO_BYTES }: PhotoEncodeOptions = {}
): Promise<string | null> {
  const image = await loadImage(file);
  if (!image) return null;

  let smallest: string | null = null;

  for (const edge of EDGE_STEPS.filter((step) => step <= maxEdge)) {
    for (const quality of QUALITY_STEPS) {
      const encoded = encode(image, edge, quality);
      if (!encoded) return smallest; // canvas ใช้ไม่ได้ — ลองต่อไปก็ได้ผลเดิม

      smallest = encoded;
      if (encoded.length <= maxBytes) return encoded;
    }
  }

  // เล็กสุดแล้วยังเกินงบ (แทบเป็นไปไม่ได้) — ส่งใบเล็กสุดไป ให้หลังบ้านเป็นคนตัดสิน
  return smallest;
}

function loadImage(file: Blob): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      resolve(null);
      return;
    }

    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };

    // ไฟล์ที่เบราว์เซอร์เปิดไม่ขึ้น (เช่น .HEIC บนแอนดรอยด์) ก็ต้องไปต่อได้ ไม่ใช่ค้าง
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };

    image.src = url;
  });
}

function encode(image: HTMLImageElement, edge: number, quality: number): string | null {
  try {
    const scale = Math.min(1, edge / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    // เบราว์เซอร์บล็อก canvas — ยอมบันทึกโดยไม่มีรูป ดีกว่าบันทึกไม่ได้เลย
    return null;
  }
}
