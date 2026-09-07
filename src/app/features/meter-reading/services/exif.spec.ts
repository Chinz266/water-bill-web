import { readPhotoMetadata } from './exif';

/**
 * ประกอบไฟล์ JPEG จิ๋วที่มี EXIF จริง ๆ ขึ้นมาเทสต์ — ตัวอ่านทำงานระดับไบต์
 * ถ้าเทสต์ด้วยข้อมูลจำลองแบบ object ก็จะไม่ได้ทดสอบส่วนที่พังจริง
 */

const DATE = '2026:08:14 08:30:00';

/** ตำแหน่งต่าง ๆ ในก้อน TIFF (นับจากต้นก้อน) — วางไว้ตายตัวเพื่อให้อ่านโครงออก */
const IFD0 = 8;
const EXIF_IFD = 38;
const GPS_IFD = 56;
const DATE_AT = 110;
const LAT_AT = 130;
const LNG_AT = 154;
const TIFF_SIZE = 178;

interface ExifOptions {
  little?: boolean;
  /** ตัวส่วนของพิกัด — ใส่ 0 เพื่อจำลองกล้องที่เขียนค่าเสียมา */
  denominator?: number;
  withGps?: boolean;
  /** ชนิดของค่าพิกัด: 5 = RATIONAL ตามมาตรฐาน, 10 = SRATIONAL ที่มือถือหลายรุ่นใช้ */
  coordType?: number;
}

function buildTiff({
  little = true,
  denominator = 1,
  withGps = true,
  coordType = 5
}: ExifOptions): Uint8Array {
  const buffer = new ArrayBuffer(TIFF_SIZE);
  const view = new DataView(buffer);

  const u16 = (at: number, value: number) => view.setUint16(at, value, little);
  const u32 = (at: number, value: number) => view.setUint32(at, value, little);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
  };
  /** 1 ช่องใน IFD = tag, ชนิด, จำนวน, แล้วค่า (หรือตำแหน่งของค่า) */
  const entry = (at: number, tag: number, type: number, count: number, value: number) => {
    u16(at, tag);
    u16(at + 2, type);
    u32(at + 4, count);
    u32(at + 8, value);
  };

  view.setUint8(0, little ? 0x49 : 0x4d);
  view.setUint8(1, little ? 0x49 : 0x4d);
  u16(2, 0x002a);
  u32(4, IFD0);

  u16(IFD0, withGps ? 2 : 1);
  entry(IFD0 + 2, 0x8769, 4, 1, EXIF_IFD); // ตัวชี้ไป Exif IFD
  if (withGps) entry(IFD0 + 14, 0x8825, 4, 1, GPS_IFD); // ตัวชี้ไป GPS IFD

  u16(EXIF_IFD, 1);
  entry(EXIF_IFD + 2, 0x9003, 2, DATE.length + 1, DATE_AT); // DateTimeOriginal
  text(DATE_AT, DATE);

  if (withGps) {
    u16(GPS_IFD, 4);
    entry(GPS_IFD + 2, 0x0001, 2, 2, 0); // 'N' ยัดอยู่ในช่องค่าเลย (สั้นกว่า 4 ไบต์)
    view.setUint8(GPS_IFD + 2 + 8, 0x4e);
    entry(GPS_IFD + 14, 0x0002, coordType, 3, LAT_AT);
    entry(GPS_IFD + 26, 0x0003, 2, 2, 0); // 'E'
    view.setUint8(GPS_IFD + 26 + 8, 0x45);
    entry(GPS_IFD + 38, 0x0004, coordType, 3, LNG_AT);

    // องศา/ลิปดา/พิลิปดา เก็บเป็นเศษส่วน — 13° 45' 32" N = 13.758888…
    const dms = (at: number, values: [number, number, number]) => {
      values.forEach((value, i) => {
        u32(at + i * 8, value * denominator);
        u32(at + i * 8 + 4, denominator);
      });
    };
    dms(LAT_AT, [13, 45, 32]);
    dms(LNG_AT, [100, 30, 0]);
  }

  return new Uint8Array(buffer);
}

/** ห่อก้อน TIFF ด้วยโครง JPEG: SOI + APP1('Exif') */
function buildJpeg(options: ExifOptions = {}): Blob {
  const tiff = buildTiff(options);
  const bytes = new Uint8Array(2 + 2 + 2 + 6 + tiff.length);
  const view = new DataView(bytes.buffer);

  view.setUint16(0, 0xffd8); // SOI
  view.setUint16(2, 0xffe1); // APP1
  view.setUint16(4, 2 + 6 + tiff.length); // ขนาดของ APP1 เป็น big-endian เสมอ
  bytes.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 6); // 'Exif\0\0'
  bytes.set(tiff, 12);

  return new Blob([bytes]);
}

describe('readPhotoMetadata — อ่าน EXIF จากไฟล์ต้นฉบับ', () => {
  it('อ่านวันถ่ายและพิกัดจากรูปที่เรียงไบต์แบบ little-endian', async () => {
    const meta = await readPhotoMetadata(buildJpeg());

    expect(meta.captureDate).toBe(DATE);
    expect(meta.latitude).toBeCloseTo(13.7589, 4);
    expect(meta.longitude).toBeCloseTo(100.5, 4);
  });

  it('กล้องที่เรียงไบต์แบบ big-endian ก็อ่านได้', async () => {
    const meta = await readPhotoMetadata(buildJpeg({ little: false }));

    expect(meta.captureDate).toBe(DATE);
    expect(meta.latitude).toBeCloseTo(13.7589, 4);
  });

  /**
   * เคสจริงจากมือถือของเจ้าของโปรเจกต์ (IMG_20260816_140224) — เขียนพิกัดเป็น SRATIONAL
   * ของเดิมรับแต่ RATIONAL เลยทิ้งพิกัดที่ใช้ได้ แล้วขึ้นว่า "รูปนี้ไม่มีพิกัดติดมา"
   */
  it('กล้องที่เขียนพิกัดเป็น SRATIONAL (ชนิด 10) ต้องอ่านได้เหมือนกัน', async () => {
    const meta = await readPhotoMetadata(buildJpeg({ coordType: 10 }));

    expect(meta.latitude).toBeCloseTo(13.7589, 4);
    expect(meta.longitude).toBeCloseTo(100.5, 4);
  });

  it('พิกัดที่ตัวส่วนเป็น 0 ต้องทิ้ง ไม่ปล่อยให้เป็น Infinity', async () => {
    const meta = await readPhotoMetadata(buildJpeg({ denominator: 0 }));

    expect(meta.captureDate).toBe(DATE);
    expect(meta.latitude).toBeUndefined();
    expect(meta.longitude).toBeUndefined();
  });

  it('รูปที่ปิด GPS ไว้ ยังได้วันถ่ายตามปกติ', async () => {
    const meta = await readPhotoMetadata(buildJpeg({ withGps: false }));

    expect(meta.captureDate).toBe(DATE);
    expect(meta.latitude).toBeUndefined();
  });

  it('JPEG ที่ไม่มี EXIF → คืนค่าว่าง', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]);

    expect(await readPhotoMetadata(new Blob([bytes]))).toEqual({});
  });

  it('ไฟล์ที่ไม่ใช่ JPEG (เช่น PNG) → คืนค่าว่าง ไม่โยน error', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    expect(await readPhotoMetadata(new Blob([bytes]))).toEqual({});
  });

  it('ไฟล์ที่ถูกตัดกลางคัน → คืนค่าว่าง ไม่โยน error', async () => {
    const full = new Uint8Array(await buildJpeg().arrayBuffer());

    expect(await readPhotoMetadata(new Blob([full.slice(0, 30)]))).toEqual({});
  });
});
