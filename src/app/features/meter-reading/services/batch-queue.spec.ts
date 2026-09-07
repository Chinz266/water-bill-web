import { clearQueue, loadQueue, saveQueue, StoredQueue } from './batch-queue.store';

/**
 * คิวที่เก็บไว้ในเครื่องเป็นตัวช่วยกู้งานตอนไฟดับ — ข้อมูลใน localStorage
 * แก้ด้วยมือได้และหายได้ทุกเมื่อ จึงต้องพังแบบเงียบ ๆ เสมอ ห้ามลากหน้าจดมิเตอร์ล่มไปด้วย
 */

const queue = (over: Partial<StoredQueue> = {}): StoredQueue => ({
  savedAt: Date.now(),
  adminId: 7,
  rows: [
    {
      seq: 1,
      fileName: 'meter-1.jpg',
      capturedAt: '2026-08-14T01:30:00.000Z',
      latitude: 13.75,
      longitude: 100.5,
      memberId: 1,
      matchedBy: 'gps',
      matchMeters: 8,
      billingKey: '2026-08',
      billingFromPhoto: true,
      unit: 120,
      confidence: 95,
      confirmHighUsage: false,
      status: 'ready',
      error: null,
      billId: null
    }
  ],
  ...over
});

describe('batch-queue.store', () => {
  beforeEach(() => clearQueue());

  it('เก็บแล้วอ่านกลับมาได้ครบ', () => {
    saveQueue(queue());

    expect(loadQueue(7)?.rows[0].unit).toBe(120);
  });

  it('ไม่มีคิวค้าง → null', () => {
    expect(loadQueue(7)).toBeNull();
  });

  it('คิวของผู้ดูแลคนอื่นต้องไม่โผล่มา', () => {
    saveQueue(queue({ adminId: 99 }));

    expect(loadQueue(7)).toBeNull();
  });

  it('คิวค้างเกิน 3 วันถือว่าไม่เกี่ยวกับงานวันนี้', () => {
    saveQueue(queue({ savedAt: Date.now() - 4 * 24 * 60 * 60 * 1000 }));

    expect(loadQueue(7)).toBeNull();
  });

  it('ข้อมูลเสีย (ถูกแก้ด้วยมือ) → คืน null และล้างทิ้ง ไม่ใช่โยน error', () => {
    localStorage.setItem('water-bill.batch-queue', '{ไม่ใช่ json}');

    expect(loadQueue(7)).toBeNull();
    expect(localStorage.getItem('water-bill.batch-queue')).toBeNull();
  });

  it('แถวที่รูปร่างไม่ถูกต้องถูกคัดทิ้ง', () => {
    const broken = queue();
    (broken.rows as any).push({ seq: 'สอง' }, null);
    saveQueue(broken);

    expect(loadQueue(7)?.rows.length).toBe(1);
  });

  it('ทุกแถวเสียจนไม่เหลืออะไร → null', () => {
    saveQueue({ savedAt: Date.now(), adminId: 7, rows: [{ seq: 'หนึ่ง' } as any] });

    expect(loadQueue(7)).toBeNull();
  });

  it('เก็บไว้ตอนยังไม่รู้ว่าใคร ยังกู้ได้', () => {
    saveQueue(queue({ adminId: null }));

    expect(loadQueue(7)).not.toBeNull();
  });
});
