import {
  SIDE_FLOOR_M,
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
  it('รวมความคลาดสองหลังแบบ hypot ไม่ใช่บวกตรง ๆ (เป็นความคลาดของผลต่าง)', () => {
    // √(3² + 4²) = 5
    expect(sideFloorFor(3, 4)).toBeCloseTo(5, 6);
  });

  it('บ้านที่พิกัดกระจายมาก ต้องใช้เกณฑ์กว้างกว่าบ้านที่พิกัดนิ่ง', () => {
    expect(sideFloorFor(10, 10)).toBeGreaterThan(sideFloorFor(2, 2));
  });

  it('คู่ที่พิกัดนิ่งมาก ไม่ลดต่ำกว่าพื้นเสียงรบกวนของ GPS', () => {
    // √(0.5² + 0.5²) ≈ 0.7 ซึ่งต่ำกว่า SIDE_FLOOR_M — ต้องถูกดันขึ้นมา
    expect(sideFloorFor(0.5, 0.5)).toBe(SIDE_FLOOR_M);
  });

  /**
   * ไม่มี spread = ประวัติยังไม่ถึง 3 ครั้ง เหลือแต่หมุดตอนลงทะเบียนซึ่งคลาดได้ถึง 20 ม.
   * ต้องเป็นเกณฑ์ที่กว้างที่สุด ไม่ใช่แคบที่สุด — บ้านที่รู้น้อยที่สุดห้ามได้เกณฑ์หลวมที่สุด
   */
  it('บ้านที่ยังไม่มีประวัติพอ ใช้เพดานความคลาดตอนลงทะเบียนแทน', () => {
    const both = sideFloorFor(null, null);

    expect(both).toBeCloseTo(Math.hypot(UNMEASURED_SPREAD_M, UNMEASURED_SPREAD_M), 6);
    expect(both).toBeGreaterThan(sideFloorFor(5, 5));
  });

  it('รู้ข้างเดียวก็ยังต้องเผื่อข้างที่ไม่รู้เต็มเพดาน', () => {
    expect(sideFloorFor(2, null)).toBeCloseTo(Math.hypot(2, UNMEASURED_SPREAD_M), 6);
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
