/**
 * อ่านข้อมูลที่กล้องฝังมากับไฟล์รูป (EXIF) — วันถ่ายและพิกัด
 *
 * ทำไมต้องอ่านเองที่หน้าเว็บ ไม่ปล่อยให้หลังบ้านอ่าน:
 * รูปที่ส่งขึ้นไปคือรูปที่ครอปแล้ว ซึ่ง ngx-image-cropper วาดใหม่ผ่าน <canvas>
 * canvas เก็บแต่พิกเซล EXIF ทั้งก้อนหายไปตั้งแต่ตอนครอป หลังบ้านจึงไม่มีทาง
 * เห็นวันถ่ายหรือพิกัดเลย ส่วนไฟล์ต้นฉบับอยู่ในมือเราตั้งแต่ตอนเลือกรูป
 *
 * ข้อมูลนี้เป็นแค่ของประกอบ พังตรงไหนต้องคืนค่าว่างเงียบ ๆ ห้ามทำให้การจดมิเตอร์สะดุด
 */

export interface PhotoMetadata {
  /** คงรูปแบบดิบของ EXIF ไว้ ('YYYY:MM:DD HH:mm:ss') ให้ฝั่ง component แปลงต่อที่เดียว */
  captureDate?: string;
  latitude?: number;
  longitude?: number;
}

/** EXIF อยู่ต้นไฟล์เสมอ อ่านแค่ช่วงหัวพอ ไม่ต้องโหลดรูปมือถือ 10MB เข้าหน่วยความจำทั้งก้อน */
const HEAD_BYTES = 256 * 1024;

/** ขนาดต่อ 1 ค่าของแต่ละชนิดข้อมูลใน EXIF (ชนิดที่ไม่รู้จัก = 0 จะถูกมองว่าอ่านไม่ได้) */
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

interface IfdEntry {
  type: number;
  count: number;
  /** ตำแหน่งจริงของค่าในไฟล์ (คิดจาก tiff แล้ว) */
  at: number;
}

export async function readPhotoMetadata(file: Blob): Promise<PhotoMetadata> {
  try {
    const head = await file.slice(0, HEAD_BYTES).arrayBuffer();
    return parseJpegExif(new DataView(head));
  } catch {
    return {};
  }
}

/**
 * แปลงวันถ่ายที่ติดมากับรูปให้เป็น Date ที่เชื่อถือได้ — เชื่อค่าดิบไม่ได้เลย:
 *   - EXIF มาตรฐานเป็น 'YYYY:MM:DD HH:mm:ss' แต่หลังบ้านอาจส่ง ISO มาแทน
 *   - อาจไม่ใช่สตริงด้วยซ้ำ (timestamp ตัวเลข)
 *   - รูปจากแกลเลอรีอาจเก่าข้ามปี หรือนาฬิกาเครื่องเพี้ยนจนได้วันในอนาคต
 * อ่านไม่ออกหรือดูไม่สมเหตุสมผล → null ให้ผู้เรียกถอยไปใช้วันที่วันนี้
 */
export function parseCaptureDate(raw: unknown): Date | null {
  if (raw instanceof Date) return acceptCaptureDate(raw);
  if (typeof raw === 'number') return acceptCaptureDate(new Date(raw));
  if (typeof raw !== 'string') return null;

  // รับทั้ง 'YYYY:MM:DD ...' (EXIF), 'YYYY-MM-DD...' (ISO) และ 'YYYY/MM/DD'
  const parts = /^(\d{4})[:\-/](\d{1,2})[:\-/](\d{1,2})/.exec(raw.trim());
  if (!parts) return null;

  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const date = new Date(year, month - 1, day);

  // เทียบย้อนกลับ เพราะ JS เลื่อนวันที่เกินจริงให้เงียบ ๆ ('2026-02-31' → 3 มี.ค.)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return acceptCaptureDate(date);
}

/** ตัดวันที่ที่เป็นไปไม่ได้ทิ้ง — อนาคต (นาฬิกาเครื่องเพี้ยน) หรือเก่าเกิน 2 ปี */
function acceptCaptureDate(date: Date): Date | null {
  if (isNaN(date.getTime())) return null;

  const latest = new Date();
  latest.setHours(23, 59, 59, 999);
  if (date.getTime() > latest.getTime()) return null;

  const earliest = new Date();
  earliest.setFullYear(earliest.getFullYear() - 2);
  if (date.getTime() < earliest.getTime()) return null;

  return date;
}

function parseJpegExif(view: DataView): PhotoMetadata {
  // ไม่ใช่ JPEG (PNG หรือ HEIC จากไอโฟนบางเครื่อง) — ไม่มี EXIF แบบนี้ให้อ่าน
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return {};

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    if ((marker & 0xff00) !== 0xff00) return {}; // โครงไฟล์เพี้ยน เดินต่อไม่ได้
    if (marker === 0xffda) return {}; // ถึงเนื้อรูปแล้ว แปลว่าไม่มี EXIF

    const size = view.getUint16(offset + 2);
    if (size < 2) return {}; // ขนาดเป็นไปไม่ได้ ถ้าเดินต่อจะวนไม่รู้จบ

    // APP1 มีได้หลายก้อน (XMP ก็ใช้ APP1) เอาเฉพาะก้อนที่ขึ้นต้นด้วย 'Exif'
    if (marker === 0xffe1 && offset + 10 <= view.byteLength && ascii(view, offset + 4, 4) === 'Exif') {
      return parseTiff(view, offset + 10);
    }

    offset += 2 + size;
  }

  return {};
}

function parseTiff(view: DataView, tiff: number): PhotoMetadata {
  if (tiff + 8 > view.byteLength) return {};

  // กล้องแต่ละยี่ห้อเรียงไบต์ไม่เหมือนกัน ('II' = little, 'MM' = big) ต้องอ่านตามที่ไฟล์บอก
  const order = view.getUint16(tiff);
  if (order !== 0x4949 && order !== 0x4d4d) return {};
  const little = order === 0x4949;
  if (view.getUint16(tiff + 2, little) !== 0x002a) return {};

  const ifd0 = readIfd(view, tiff, tiff + view.getUint32(tiff + 4, little), little);
  const meta: PhotoMetadata = {};

  // วันถ่ายจริงอยู่ใน sub-IFD ของ Exif ไม่ได้อยู่ใน IFD0
  const exifDir = uintOf(view, ifd0.get(0x8769), little);
  const exif = exifDir !== undefined ? readIfd(view, tiff, tiff + exifDir, little) : undefined;

  const captureDate =
    ascii0(view, exif?.get(0x9003)) ?? // DateTimeOriginal — ตอนลั่นชัตเตอร์ ตรงที่สุด
    ascii0(view, exif?.get(0x9004)) ?? // DateTimeDigitized — ตอนแปลงเป็นไฟล์ดิจิทัล
    ascii0(view, ifd0.get(0x0132)); // DateTime — วันที่ไฟล์ถูกแก้ล่าสุด ใช้เป็นทางสุดท้าย
  if (captureDate) meta.captureDate = captureDate;

  const gpsDir = uintOf(view, ifd0.get(0x8825), little);
  if (gpsDir !== undefined) {
    const gps = readIfd(view, tiff, tiff + gpsDir, little);
    const lat = degrees(rationals(view, gps.get(0x0002), little), ascii0(view, gps.get(0x0001)));
    const lng = degrees(rationals(view, gps.get(0x0004), little), ascii0(view, gps.get(0x0003)));
    // เอาเฉพาะตอนได้ครบคู่ พิกัดมาข้างเดียวใช้อะไรไม่ได้
    if (lat !== undefined && lng !== undefined) {
      meta.latitude = lat;
      meta.longitude = lng;
    }
  }

  return meta;
}

function readIfd(view: DataView, tiff: number, dir: number, little: boolean): Map<number, IfdEntry> {
  const entries = new Map<number, IfdEntry>();
  if (dir < 0 || dir + 2 > view.byteLength) return entries;

  const total = view.getUint16(dir, little);
  for (let i = 0; i < total; i++) {
    const entry = dir + 2 + i * 12;
    if (entry + 12 > view.byteLength) break; // ไฟล์ถูกตัดกลางคัน อ่านเท่าที่มี

    const tag = view.getUint16(entry, little);
    const type = view.getUint16(entry + 2, little);
    const count = view.getUint32(entry + 4, little);
    const bytes = count * (TYPE_SIZE[type] ?? 0);

    // ค่าที่ยาวไม่เกิน 4 ไบต์ถูกยัดไว้ในช่องเดียวกับตัวชี้ ถ้ายาวกว่านั้นช่องนี้คือตำแหน่งของค่าจริง
    const at = bytes > 4 ? tiff + view.getUint32(entry + 8, little) : entry + 8;
    entries.set(tag, { type, count, at });
  }

  return entries;
}

function ascii(view: DataView, at: number, length: number): string {
  let text = '';
  for (let i = 0; i < length && at + i < view.byteLength; i++) {
    text += String.fromCharCode(view.getUint8(at + i));
  }
  return text;
}

/** ค่า ASCII ของ EXIF ปิดท้ายด้วย \0 และมักมีช่องว่างเกินมา ต้องตัดทิ้งก่อนใช้ */
function ascii0(view: DataView, entry: IfdEntry | undefined): string | undefined {
  if (!entry || entry.type !== 2 || entry.count < 1) return undefined;

  const text = ascii(view, entry.at, entry.count).replace(/\0[\s\S]*$/, '').trim();
  return text || undefined;
}

function uintOf(view: DataView, entry: IfdEntry | undefined, little: boolean): number | undefined {
  if (!entry || entry.at + 2 > view.byteLength) return undefined;
  if (entry.type === 3) return view.getUint16(entry.at, little);
  if (entry.type === 4 && entry.at + 4 <= view.byteLength) return view.getUint32(entry.at, little);
  return undefined;
}

/**
 * RATIONAL = เศษ 4 ไบต์ / ส่วน 4 ไบต์ — พิกัดมาเป็นชุดละ 3 ค่า (องศา ลิปดา พิลิปดา)
 *
 * มาตรฐาน EXIF บอกให้พิกัดเป็น RATIONAL (ชนิด 5) แต่กล้องมือถือหลายรุ่นเขียนเป็น
 * SRATIONAL (ชนิด 10) มา ซึ่งหน้าตาเหมือนกันเป๊ะ ต่างแค่ตีความเป็นเลขมีเครื่องหมาย
 * ของเดิมรับแต่ชนิด 5 รูปจากเครื่องพวกนั้นจึงถูกทิ้งทั้งที่พิกัดใช้ได้ แล้วขึ้นหน้าเว็บ
 * ว่า "รูปนี้ไม่มีพิกัดติดมา" ซึ่งชี้ให้คนไปแก้ผิดจุด (ไปนั่งเปิด GPS ที่เปิดอยู่แล้ว)
 */
function rationals(view: DataView, entry: IfdEntry | undefined, little: boolean): number[] | undefined {
  if (!entry || (entry.type !== 5 && entry.type !== 10) || entry.count < 3) return undefined;
  if (entry.at + 24 > view.byteLength) return undefined;

  const signed = entry.type === 10;
  const at = (position: number) =>
    signed ? view.getInt32(position, little) : view.getUint32(position, little);

  const values: number[] = [];
  for (let i = 0; i < 3; i++) {
    const denominator = at(entry.at + i * 8 + 4);
    if (denominator === 0) return undefined; // กล้องบางรุ่นใส่ 0 มา หารต่อจะได้ Infinity
    values.push(at(entry.at + i * 8) / denominator);
  }
  return values;
}

function degrees(dms: number[] | undefined, ref: string | undefined): number | undefined {
  if (!dms) return undefined;

  const value = dms[0] + dms[1] / 60 + dms[2] / 3600;
  if (!Number.isFinite(value)) return undefined;

  // ตัวเลขชุดนี้เป็นขนาดล้วน ทิศมาจาก ref เท่านั้น — ค่าที่อ่านมาแบบ SRATIONAL
  // อาจติดลบมาแล้ว ถ้าไม่ตัดเครื่องหมายทิ้งก่อนจะกลายเป็นลบสองครั้งแล้วข้ามซีกโลก
  const magnitude = Math.abs(value);

  // ซีกใต้/ตะวันตกเป็นค่าติดลบ ไทยอยู่ N/E ทั้งประเทศ แต่กันไว้เผื่อรูปหลุดมาจากที่อื่น
  return ref === 'S' || ref === 'W' ? -magnitude : magnitude;
}
