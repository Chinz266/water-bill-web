import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { BatchScanComponent } from './batch-scan';

/**
 * มิเตอร์ที่ติดกันบนกำแพงเดียวกัน — หน้านี้ต้องพาไล่จดตามลำดับ ห้ามเดาจากพิกัด
 *
 * ตัวเลขที่ตัดสินเรื่องนี้: มิเตอร์ห่างกัน 0.3 ม. ส่วน GPS มือถือคลาดเคลื่อน 3-5 ม.
 * ในที่โล่ง และ 10-30 ม. ใต้ชายคา — "หลังที่ใกล้ที่สุด" จึงเป็นผลของเสียงรบกวน
 * ไม่ใช่ตำแหน่งจริง สิ่งเดียวที่ไม่แกว่งคือ sequence_index ที่กรอกไว้ล่วงหน้า
 */

/** 0.0001 องศา ≈ 11 เมตร — ตัวเลขนี้ใช้วางบ้านให้ห่างกันตามต้องการ */
const house = (
  id: number,
  house_no: string,
  lat: number | null,
  cluster?: { group: string; index: number }
) => ({
  id,
  house_no,
  fname: 'สมชาย',
  lname: 'ใจดี',
  latitude: lat,
  longitude: lat === null ? null : 100.5,
  cluster_group_id: cluster?.group ?? null,
  sequence_index: cluster?.index ?? null
});

/** กำแพงเดียวกัน 3 ตัว — พิกัดต่างกันระดับที่ GPS แยกไม่ออก (ราว 1 ม.) */
const WALL = [
  house(1, '206/1', 13.750011, { group: 'WALL-206', index: 1 }),
  house(2, '206/2', 13.750012, { group: 'WALL-206', index: 2 }),
  house(3, '206/3', 13.750013, { group: 'WALL-206', index: 3 })
];

const row = (over: any = {}) => ({
  seq: 1,
  clientUuid: 'uuid-1',
  file: new File(['รูปจำลอง'], 'meter-1.jpg', { type: 'image/jpeg' }),
  fileKey: 'meter-1.jpg|1|1',
  fileName: 'meter-1.jpg',
  previewUrl: 'blob:preview',
  brokenImage: false,
  capturedAt: new Date(),
  latitude: 13.75001,
  longitude: 100.5,
  photoData: 'data:image/jpeg;base64,xxx',
  memberId: null,
  matchedBy: 'none',
  matchedByCoords: false,
  matchConfidence: null,
  matchReason: null,
  candidates: [],
  nearby: [],
  warnings: [],
  unit: 1250,
  confidence: 95,
  confirmHighUsage: false,
  confirmDigitChange: false,
  confirmLowConfidence: false,
  confirmDuplicateLocation: false,
  confirmStalePhoto: false,
  confirmMeterReset: false,
  oldMeterFinalUnit: null,
  croppedRead: false,
  ocrUnit: 1250,
  meterDigits: 4,
  ocrConfidence: 0.95,
  status: 'ready',
  error: null,
  errorCode: null,
  billId: null,
  ...over
});

describe('BatchScanComponent — มิเตอร์ที่ติดกันเป็นกลุ่ม', () => {
  let component: BatchScanComponent;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BatchScanComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    }).compileComponents();

    const fixture = TestBed.createComponent(BatchScanComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    http.expectOne(r => r.url.endsWith('/member/all')).flush([]);
    http.expectOne(r => r.url.endsWith('/villages')).flush([]);
  });

  afterEach(() => localStorage.clear());

  const setup = (rows: any[] = [row()], members: any[] = WALL) => {
    component.members = members;
    component.rows = rows as any;
    component.refreshAllNearby();
    return component.rows[0];
  };

  describe('ป้ายตำแหน่ง', () => {
    it('ตัวแรก/ตัวกลาง/ตัวท้าย ต้องอ่านแล้วรู้ว่ายืนตรงไหนของกำแพง', () => {
      setup();

      expect(component.positionLabel(WALL[0])).toBe('ซ้ายสุด');
      expect(component.positionLabel(WALL[1])).toBe('ตรงกลาง');
      expect(component.positionLabel(WALL[2])).toBe('ขวาสุด');
    });

    it('บ้านเดี่ยวไม่มีป้ายตำแหน่ง (ไม่ได้อยู่ในกลุ่ม)', () => {
      const alone = house(9, '300', 13.7505);
      setup([row()], [...WALL, alone]);

      expect(component.positionLabel(alone)).toBeNull();
    });
  });

  describe('ล็อกให้จดตามลำดับ', () => {
    it('ยังไม่ได้จดตัวซ้ายสุด → กดตัวกลางไม่ได้ และข้อความต้องบอกว่าต้องจดหลังไหนก่อน', () => {
      setup();

      const locked = component.clusterLockMessage(WALL[1]);
      expect(locked).toContain('206/1');
      expect(locked).toContain('ซ้ายสุด');
    });

    it('ตัวซ้ายสุดกดได้เสมอ — เป็นจุดเริ่มของการไล่จด', () => {
      setup();

      expect(component.clusterLockMessage(WALL[0])).toBeNull();
    });

    it('จดตัวซ้ายสุดแล้ว → ตัวกลางปลดล็อก แต่ตัวขวาสุดยังล็อกอยู่', () => {
      setup([row({ memberId: 1, matchedBy: 'manual', unit: 1250 })]);

      expect(component.clusterLockMessage(WALL[1])).toBeNull();
      expect(component.clusterLockMessage(WALL[2])).toContain('206/2');
    });

    it('บ้านที่มีบิลของรอบนี้แล้วถือว่าจดแล้ว — ไม่ล็อกทั้งกลุ่มค้างไว้', () => {
      setup([
        row({
          memberId: null,
          candidates: [
            { members_id: 1, house_no: '206/1', already_billed: true, previous_unit: 1200, usage_unit: 50 }
          ]
        })
      ]);

      expect(component.clusterLockMessage(WALL[1])).toBeNull();
    });

    it('กดข้ามลำดับ → ไม่เลือกบ้านให้ (แถวต้องยังว่างอยู่)', () => {
      const target = setup();

      component.pickNearby(target, WALL[2]);

      expect(target.memberId).toBeNull();
    });

    it('ออกบิลข้ามลำดับไม่ได้ แม้จะตั้งบ้านมาจากคิวเก่า', () => {
      const target = setup([row({ memberId: 3, matchedBy: 'manual' })]);

      expect(component.blockingIssue(target)).toContain('206/1');
      expect(component.savableRows.length).toBe(0);
    });
  });

  describe('พิกัดต้องไม่เดาบ้านในกลุ่ม', () => {
    it('รูปที่ตกกลางกลุ่ม → ไม่เติมบ้านให้เอง แม้จะมีหลังที่ "ใกล้ที่สุด"', () => {
      // บ้านเดี่ยวอยู่ไกลออกไป 300 ม. เพื่อให้ pickNearest ได้ผู้ชนะในกลุ่มชัด ๆ
      const target = setup([row({ memberId: null, matchedBy: 'none' })], [
        ...WALL,
        house(9, '300', 13.7527)
      ]);

      component['matchByCoords'](target);

      expect(target.memberId).toBeNull();
      expect(target.matchConfidence).toBe('ambiguous');
      expect(target.matchReason).toContain('30 ซม.');
    });

    it('บ้านเดี่ยวยังจับคู่จากพิกัดได้เหมือนเดิม (ไม่ได้ปิดทั้งระบบ)', () => {
      const alone = house(9, '300', 13.75001);
      const target = setup([row({ memberId: null, matchedBy: 'none' })], [alone]);

      component['matchByCoords'](target);

      expect(target.memberId).toBe(9);
    });
  });

  describe('บอกตัวถัดไปที่ต้องจด', () => {
    it('เลือกตัวซ้ายสุดไว้แล้ว → ตัวถัดไปคือ 206/2', () => {
      const target = setup([row({ memberId: 1, matchedBy: 'manual', unit: 1250 })]);

      expect(component.nextInCluster(target)?.house_no).toBe('206/2');
    });

    it('บ้านเดี่ยวไม่ต้องมีลำดับให้ไล่', () => {
      const alone = house(9, '300', 13.75001);
      const target = setup([row({ memberId: 9, matchedBy: 'manual' })], [alone]);

      expect(component.nextInCluster(target)).toBeNull();
    });
  });
});
