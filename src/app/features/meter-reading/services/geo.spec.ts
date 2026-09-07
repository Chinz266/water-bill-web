import {
  SIDE_FLOOR_M,
  SIDE_TRUST_M,
  UNMEASURED_SPREAD_M,
  distanceMeters,
  medianCoords,
  sideFloorFor,
  sideOf,
  toCoords
} from './geo';

describe('toCoords — กรองพิกัดที่ใช้ไม่ได้ทิ้ง', () => {
  it('ตัวเลขปกติใช้ได้', () => {
    expect(toCoords(13.7563, 100.5018)).toEqual({ lat: 13.7563, lng: 100.5018 });
  });

  it('หลังบ้านคืนเป็นสตริง (คอลัมน์ decimal) ก็ใช้ได้', () => {
    expect(toCoords('13.7563', '100.5018')).toEqual({ lat: 13.7563, lng: 100.5018 });
  });

  it('ค่าว่าง / ไม่ใช่ตัวเลข → null', () => {
    expect(toCoords(null, null)).toBeNull();
    expect(toCoords(undefined, undefined)).toBeNull();
    expect(toCoords("13°45'", '100.5')).toBeNull();
  });

  it('0,0 คือค่าว่างที่ถูกแปลงเป็นเลข ไม่ใช่พิกัดจริง', () => {
    expect(toCoords(0, 0)).toBeNull();
  });

  it('ค่าหลุดขอบเขตโลก → null', () => {
    expect(toCoords(91, 100)).toBeNull();
    expect(toCoords(13, 181)).toBeNull();
  });
});

describe('medianCoords — ใจกลางหมู่บ้าน', () => {
  it('บ้านหลังที่พิกัดเพี้ยนไปไกลต้องไม่ลากจุดกึ่งกลางตามไปด้วย', () => {
    const center = medianCoords([
      { lat: 14.9799, lng: 102.0977 },
      { lat: 14.98, lng: 102.0978 },
      { lat: 14.9801, lng: 102.0979 },
      { lat: 13.7563, lng: 100.5018 } // ค่าที่เครื่องเดาจาก IP แล้วได้ใจกลางกรุงเทพ ห่างไปสองร้อยกิโล
    ]);

    expect(center?.lng).toBeGreaterThan(102);
  });

  it('ไม่มีพิกัดเลย → null', () => {
    expect(medianCoords([])).toBeNull();
  });
});

describe('distanceMeters — ระยะห่างระหว่างบ้าน', () => {
  const home = { lat: 13.75, lng: 100.5 };

  it('จุดเดียวกันได้ 0 ไม่ใช่ NaN (ปัดเศษแล้ว asin ต้องไม่เกิน 1)', () => {
    expect(distanceMeters(home, { ...home })).toBe(0);
  });

  it('ห่างกัน 0.0001 องศาละติจูด ≈ 11 เมตร — ระยะระดับบ้านติดกัน', () => {
    const next = { lat: home.lat + 0.0001, lng: home.lng };

    expect(distanceMeters(home, next)).toBeGreaterThan(10);
    expect(distanceMeters(home, next)).toBeLessThan(12);
  });

  it('ห่างกัน 0.01 องศาละติจูด ≈ 1.1 กิโลเมตร — คนละมุมหมู่บ้าน', () => {
    const far = { lat: home.lat + 0.01, lng: home.lng };

    expect(distanceMeters(home, far)).toBeGreaterThan(1100);
    expect(distanceMeters(home, far)).toBeLessThan(1120);
  });

  it('วัดกลับทางได้ระยะเท่ากัน', () => {
    const other = { lat: 13.76, lng: 100.51 };

    expect(distanceMeters(home, other)).toBeCloseTo(distanceMeters(other, home), 6);
  });
});

/**
 * ทิศระหว่าง "หมุดสองหมุดที่จดไว้" ไม่ใช่ทิศของคนถ่าย — ตอบได้ก็ต่อเมื่อสองหมุด
 * ห่างกันพอที่ความคลาดเคลื่อนตอนลงทะเบียนจะไม่กลบ ไม่งั้นต้องตอบว่าไม่รู้
 */
describe('sideOf — บ้านไหนอยู่ทางไหนของบ้านไหน', () => {
  const home = { lat: 13.75, lng: 100.5 };

  it('ไปทางตะวันออก = ขวา · ตะวันตก = ซ้าย', () => {
    expect(sideOf(home, { lat: home.lat, lng: home.lng + 0.001 })).toBe('ขวา');
    expect(sideOf(home, { lat: home.lat, lng: home.lng - 0.001 })).toBe('ซ้าย');
  });

  it('ไปทางเหนือ = บน · ใต้ = ล่าง', () => {
    expect(sideOf(home, { lat: home.lat + 0.001, lng: home.lng })).toBe('บน');
    expect(sideOf(home, { lat: home.lat - 0.001, lng: home.lng })).toBe('ล่าง');
  });

  /**
   * เคสสำคัญของฟังก์ชันนี้ — มิเตอร์บนกำแพงเดียวกันห่างกันราว 30 ซม.
   * ทิศที่คำนวณได้จึงเป็นผลของความเพี้ยนตอนจดหมุด ไม่ใช่ตำแหน่งจริง ต้องตอบว่าไม่รู้
   */
  it('ใกล้กันกว่าพื้นเสียงรบกวน → null ไม่ใช่เดาทิศให้', () => {
    // 0.000002 องศา ≈ 0.2 เมตร
    expect(sideOf(home, { lat: home.lat, lng: home.lng + 0.000002 })).toBeNull();
  });

  it('ตรงพื้นเสียงรบกวนพอดีให้ตอบได้ ต่ำกว่านั้นไม่ตอบ', () => {
    const justOver = { lat: home.lat + SIDE_FLOOR_M / 111_320 + 0.0000005, lng: home.lng };
    const justUnder = { lat: home.lat + SIDE_FLOOR_M / 111_320 - 0.0000005, lng: home.lng };

    expect(sideOf(home, justOver)).toBe('บน');
    expect(sideOf(home, justUnder)).toBeNull();
  });

  it('จุดเดียวกันเป๊ะ → null (ไม่มีทิศให้พูดถึง)', () => {
    expect(sideOf(home, { ...home })).toBeNull();
  });

  it('กลับทางแล้วต้องได้ทิศตรงข้าม ไม่ใช่ทิศเดิม', () => {
    const east = { lat: home.lat, lng: home.lng + 0.001 };

    expect(sideOf(home, east)).toBe('ขวา');
    expect(sideOf(east, home)).toBe('ซ้าย');
  });
});

/**
 * ความแม่นของพิกัดต่างกันหลายเท่าตามสภาพหน้างาน (กลางทุ่งโล่งกระจายไม่ถึง 5 ม.
 * ใต้ชายคาได้ถึง 40 ม.) เกณฑ์ตายตัวค่าเดียวจึงหลวมเกินไปสำหรับบ้านหนึ่ง
 * และคับเกินไปสำหรับอีกบ้านเสมอ — ต้องคิดจากความแม่นของคู่นั้น ๆ เอง
 */
describe('sideFloorFor — เกณฑ์เชื่อทิศของบ้านแต่ละคู่', () => {
  /**
   * ⚠️ SIDE_FLOOR_M กับ SIDE_TRUST_M เท่ากันที่ 15 ม. เกณฑ์จึงเป็น 15 เสมอในตอนนี้
   * และการปรับตามความแม่นของแต่ละคู่ถูกปิดผลโดยตั้งใจ (ดู geo.ts) เทสต์ชุดนี้จึงล็อกว่า
   * "เขตที่ GPS บอกซ้าย/ขวาไม่ได้" กว้าง 15 ม. เท่ากันทุกคู่ ไม่ใช่ล็อกสูตรเดิม
   */
  it('คู่ที่พิกัดนิ่งมาก ก็ยังไม่ต่ำกว่าเขต 15 ม. ที่ GPS บอกไม่ได้', () => {
    expect(sideFloorFor(0.5, 0.5)).toBe(SIDE_FLOOR_M);
    expect(sideFloorFor(3, 4)).toBe(SIDE_FLOOR_M);
  });

  it('พิกัดกระจายมากหรือน้อย ตอนนี้ได้เกณฑ์เท่ากันหมด', () => {
    expect(sideFloorFor(10, 10)).toBe(sideFloorFor(2, 2));
    expect(sideFloorFor(2, 2)).toBe(SIDE_TRUST_M);
  });

  /**
   * ไม่มี spread = ประวัติยังไม่ถึง 3 ครั้ง เหลือแต่หมุดตอนลงทะเบียนซึ่งคลาดได้ถึง 20 ม.
   * เกณฑ์ดิบจึงเป็น √(20²+20²) ≈ 28.3 ม. ซึ่งกว้างกว่าระยะห่างจริงระหว่างบ้านส่วนใหญ่
   * จนป้ายไม่เคยขึ้นเลย — SIDE_TRUST_M ครอบไว้ที่ 15 ม. ตามที่เจ้าของระบบเลือก
   */
  it('บ้านที่ยังไม่มีประวัติพอ ถูกเพดาน SIDE_TRUST_M ครอบไว้', () => {
    const both = sideFloorFor(null, null);

    expect(both).toBe(SIDE_TRUST_M);
    expect(both).toBeLessThan(Math.hypot(UNMEASURED_SPREAD_M, UNMEASURED_SPREAD_M));
    expect(both).toBe(sideFloorFor(5, 5));
  });

  it('รู้ข้างเดียวก็ยังชนเพดานเดียวกัน ไม่ทะลุไปตามความคลาดของข้างที่ไม่รู้', () => {
    expect(sideFloorFor(2, null)).toBe(SIDE_TRUST_M);
  });

  it('เกณฑ์ไม่มีทางเกิน SIDE_TRUST_M ไม่ว่าความคลาดจะสูงแค่ไหน', () => {
    expect(sideFloorFor(100, 100)).toBe(SIDE_TRUST_M);
  });
});

describe('sideOf — เกณฑ์ที่ส่งเข้าไปต้องมีผลจริง', () => {
  const home = { lat: 13.75, lng: 100.5 };
  // ห่างไปทางเหนือราว 11 ม.
  const north = { lat: home.lat + 0.0001, lng: home.lng };

  it('ห่างชนะเกณฑ์ → ตอบทิศ', () => {
    expect(sideOf(home, north, 5)).toBe('บน');
  });

  it('เกณฑ์กว้างกว่าระยะจริง → ไม่ตอบ แม้จะห่างเกินพื้นเสียงรบกวนก็ตาม', () => {
    expect(sideOf(home, north, 28)).toBeNull();
  });
});
