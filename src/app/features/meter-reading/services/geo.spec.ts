import { distanceMeters, medianCoords, toCoords } from './geo';

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
