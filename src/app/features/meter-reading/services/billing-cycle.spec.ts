import {
  anchorDayOf,
  buildCycleIndex,
  daysBetween,
  latestReadingBefore,
  memberReadingDates,
  suggestBillingMonth,
  toLocalDate
} from './billing-cycle';

/** บิลหนึ่งใบแบบที่ /bills คืนมา (วันจดซ้อนอยู่ใน meter_reading) */
const bill = (id: number, memberId: number, readingDate: string) => ({
  id,
  member: { id: memberId },
  meter_reading: { reading_date: readingDate }
});

describe('toLocalDate — วันที่จากหลังบ้าน', () => {
  it("'2026-08-05' ต้องได้วันที่ 5 ไม่ใช่ 4 (new Date() อ่านเป็นเที่ยงคืน UTC)", () => {
    const date = toLocalDate('2026-08-05');

    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(7);
    expect(date?.getDate()).toBe(5);
  });

  it('มีเวลาต่อท้ายก็ตัดให้เหลือแต่วัน', () => {
    expect(toLocalDate('2026-08-05T18:30:00Z')?.getDate()).toBe(5);
  });

  it('วันที่ไม่มีจริง (31 ก.พ.) ต้องไม่ถูกเลื่อนเป็นเดือนถัดไปเงียบ ๆ', () => {
    expect(toLocalDate('2026-02-31')).toBeNull();
  });

  it('ค่าว่าง / อ่านไม่ออก → null', () => {
    expect(toLocalDate(null)).toBeNull();
    expect(toLocalDate(undefined)).toBeNull();
    expect(toLocalDate('ไม่ทราบวันที่')).toBeNull();
  });
});

describe('daysBetween — จำนวนวันในรอบ', () => {
  it('5 ก.ค. → 4 ส.ค. = 30 วัน', () => {
    expect(daysBetween(new Date(2026, 6, 5), new Date(2026, 7, 4))).toBe(30);
  });

  it('ข้ามปีก็นับถูก', () => {
    expect(daysBetween(new Date(2025, 11, 28), new Date(2026, 0, 27))).toBe(30);
  });
});

describe('buildCycleIndex — รอบบิลของแต่ละใบ', () => {
  it('รอบ = วันจดใบก่อนของบ้านหลังเดียวกัน → วันจดใบนี้', () => {
    const index = buildCycleIndex([
      bill(1, 7, '2026-07-05'),
      bill(2, 7, '2026-08-04')
    ]);

    expect(index.get(2)).toEqual({
      start: new Date(2026, 6, 5),
      end: new Date(2026, 7, 4),
      days: 30
    });
  });

  it('ใบแรกของบ้านไม่มีรอบ (เลขตั้งต้นมาจากตอนลงทะเบียน ไม่ใช่จากบิล)', () => {
    const index = buildCycleIndex([bill(1, 7, '2026-07-05')]);

    expect(index.has(1)).toBe(false);
  });

  it('ห้ามข้ามไปหยิบวันจดของบ้านหลังอื่นมาเป็นจุดเริ่มรอบ', () => {
    const index = buildCycleIndex([
      bill(1, 7, '2026-07-05'),
      bill(2, 9, '2026-07-20'), // บ้านคนละหลัง ต้องไม่ถูกนับ
      bill(3, 7, '2026-08-04')
    ]);

    expect(index.get(3)?.start).toEqual(new Date(2026, 6, 5));
    expect(index.has(2)).toBe(false);
  });

  it('บิลมาสลับลำดับก็ต้องเรียงให้เองก่อนคิด', () => {
    const index = buildCycleIndex([
      bill(3, 7, '2026-09-03'),
      bill(1, 7, '2026-07-05'),
      bill(2, 7, '2026-08-04')
    ]);

    expect(index.get(3)?.days).toBe(30);
  });

  it('เดือนที่ไม่ได้ออกบิล → รอบยาวข้ามเดือน ไม่ใช่ 30 วันปลอม ๆ', () => {
    const index = buildCycleIndex([
      bill(1, 7, '2026-07-05'),
      bill(2, 7, '2026-09-05') // ส.ค. ไม่ได้จด
    ]);

    expect(index.get(2)?.days).toBe(62);
  });

  it('สองใบลงวันจดเดียวกัน (ออกบิลทับ) ไม่นับเป็นรอบ', () => {
    const index = buildCycleIndex([
      bill(1, 7, '2026-08-04'),
      bill(2, 7, '2026-08-04')
    ]);

    expect(index.size).toBe(0);
  });

  it('บิลที่ไม่มีวันจดติดมาต้องข้ามไป ไม่ทำให้ทั้งกองพัง', () => {
    const index = buildCycleIndex([
      { id: 1, member: { id: 7 } },
      bill(2, 7, '2026-07-05'),
      bill(3, 7, '2026-08-04')
    ]);

    expect(index.get(3)?.days).toBe(30);
  });

  it('วันจดที่แบนมากับบิล (/me/bills) ก็อ่านได้', () => {
    const index = buildCycleIndex([
      { id: 1, members_id: 7, reading_date: '2026-07-05' },
      { id: 2, members_id: 7, reading_date: '2026-08-04' }
    ]);

    expect(index.get(2)?.days).toBe(30);
  });
});

describe('anchorDayOf — วันจดประจำของบ้าน', () => {
  it('ใช้ค่ากลาง เดือนที่จดช้าผิดปกติจึงไม่ดึงค่าไปทั้งชุด', () => {
    const dates = [new Date(2026, 5, 5), new Date(2026, 6, 6), new Date(2026, 7, 25)];

    expect(anchorDayOf(dates)).toBe(6);
  });

  it('ยังไม่เคยจด → null (ไม่มีอะไรให้เดา)', () => {
    expect(anchorDayOf([])).toBeNull();
  });
});

describe('latestReadingBefore — จุดเริ่มของรอบที่กำลังจะออก', () => {
  const dates = [new Date(2026, 5, 5), new Date(2026, 6, 5), new Date(2026, 7, 4)];

  it('หยิบวันจดล่าสุดที่เกิดก่อนวันถ่ายรูป', () => {
    expect(latestReadingBefore(dates, new Date(2026, 8, 3))).toEqual(new Date(2026, 7, 4));
  });

  it('ถ่ายก่อนที่จะเคยจด → null', () => {
    expect(latestReadingBefore(dates, new Date(2026, 4, 1))).toBeNull();
  });

  it('วันเดียวกับที่จดไว้แล้วไม่นับ (รอบต้องมีความยาวมากกว่า 0 วัน)', () => {
    expect(latestReadingBefore(dates, new Date(2026, 7, 4))).toEqual(new Date(2026, 6, 5));
  });
});

describe('suggestBillingMonth — รูปใบนี้ควรลงรอบเดือนไหน', () => {
  it('บ้านที่จดปลายเดือน แล้วไปจดวันที่ 2 ของเดือนถัดไป → ยังเป็นรอบเดือนก่อน', () => {
    expect(suggestBillingMonth(new Date(2026, 8, 2), 28).key).toBe('2026-08');
  });

  it('บ้านที่จดต้นเดือน ถ่ายวันที่ 6 → รอบเดือนของรูปเอง', () => {
    expect(suggestBillingMonth(new Date(2026, 8, 6), 5).key).toBe('2026-09');
  });

  it('จดเร็วกว่ารอบประจำนิดหน่อย ก็ยังเป็นเดือนของรูปเอง', () => {
    expect(suggestBillingMonth(new Date(2026, 8, 2), 5).key).toBe('2026-09');
  });

  it('ถ่ายต้นเดือน ม.ค. ของบ้านที่จดปลายเดือน → ถอยไปเป็นรอบ ธ.ค. ปีก่อน', () => {
    expect(suggestBillingMonth(new Date(2026, 0, 2), 28).key).toBe('2025-12');
  });

  it('บ้านใหม่ที่ยังไม่มีรอบประจำ → ใช้เดือนของรูปตามเดิม', () => {
    expect(suggestBillingMonth(new Date(2026, 8, 2), null).key).toBe('2026-09');
  });

  it('รอบประจำวันที่ 31 ในเดือนที่มี 30 วัน ต้องไม่ล้นไปเดือนถัดไป', () => {
    expect(suggestBillingMonth(new Date(2026, 8, 30), 31).key).toBe('2026-09');
  });

  it('ไม่เสนอเดือนที่ยังมาไม่ถึง แม้วันจดประจำจะอยู่ต้นเดือนหน้า', () => {
    // จดประจำวันที่ 1 ถ่ายวันที่ 30 ก.ย. — 1 ต.ค. ใกล้กว่าก็จริง แต่ยังไม่ถึงรอบนั้น
    expect(suggestBillingMonth(new Date(2026, 8, 30), 1).key).toBe('2026-09');
  });
});

describe('memberReadingDates — วันจดที่ติดมากับข้อมูลบ้าน', () => {
  it('อ่านจาก meter_readings ที่ซ้อนมา', () => {
    const dates = memberReadingDates({ meter_readings: [{ reading_date: '2026-08-04' }] });

    expect(dates).toEqual([new Date(2026, 7, 4)]);
  });

  it('อ่านจากบิลที่ซ้อนมาได้ด้วย', () => {
    const dates = memberReadingDates({ bills: [{ meter_reading: { reading_date: '2026-08-04' } }] });

    expect(dates).toEqual([new Date(2026, 7, 4)]);
  });

  it('หลังบ้านไม่ได้ส่งอะไรซ้อนมา → ว่าง ไม่ใช่พัง', () => {
    expect(memberReadingDates({ id: 7, house_no: '99/1' })).toEqual([]);
    expect(memberReadingDates(null)).toEqual([]);
  });
});
