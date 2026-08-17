import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { BatchScanComponent } from './batch-scan';

/**
 * มิเตอร์ที่ติดกันเป็นแถว (ตึกแถว/บ้านแฝด) — GPS มือถือเพี้ยน 5–20 ม. ซึ่งกว้างกว่า
 * ระยะระหว่างบ้าน ระบบจึงห้ามชี้ขาดเอง ต้องยกบ้านที่ใกล้ที่สุดมาให้คนกดเลือก
 * และห้ามออกบิลให้เองด้วย เพราะใบที่ระบบออกเองไม่มีใครตรวจซ้ำ
 */

/** 0.0001 องศา ≈ 11 เมตร */
const house = (id: number, houseNo: string, lat: number | null) => ({
  id,
  house_no: houseNo,
  fname: 'สมชาย',
  lname: 'ใจดี',
  latitude: lat,
  longitude: lat === null ? null : 100.5
});

const row = (over: any = {}) => ({
  seq: 1,
  file: new File(['รูปจำลอง'], 'meter-1.jpg', { type: 'image/jpeg' }),
  fileKey: 'meter-1.jpg|1|1',
  fileName: 'meter-1.jpg',
  previewUrl: 'blob:preview',
  brokenImage: false,
  capturedAt: new Date(),
  latitude: 13.75,
  longitude: 100.5,
  // แถวจริงมีรูปย่อเสมอ (preparePhotos ทำให้ทุกไฟล์ที่เลือก) — ต้องมีในฟิกซ์เจอร์ด้วย
  // ไม่งั้นแถวที่คนแก้เลขเองจะติดด่าน "กรอกเองต้องมีรูป" ตั้งแต่ยังไม่ได้ทดสอบอะไร
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

describe('BatchScanComponent — มิเตอร์ที่อยู่ใกล้กัน', () => {
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

  /** วางบ้านตามพิกัดที่กำหนด แล้วให้แถวคิดบ้านใกล้เคียงใหม่ */
  const setup = (houses: any[], over: any = {}) => {
    component.members = houses;
    component.rows = [row(over)] as any;
    component.refreshAllNearby();
    return component.rows[0];
  };

  it('มีอีกหลังใกล้พอ ๆ กัน → พิกัดยืนยันบ้านไม่ได้ ระบบต้องไม่ออกบิลให้เอง', () => {
    // 99/1 ห่างจากจุดถ่ายราว 1 ม. · 99/2 ห่างราว 10 ม. — ต่างกันน้อยกว่า 15 ม.
    const target = setup([house(1, '99/1', 13.75001), house(2, '99/2', 13.75009)], {
      memberId: 1,
      matchedBy: 'system'
    });

    expect(component.hasCloseRival(target)).toBe(true);
    expect(component.isConfirmedByCoords(target)).toBe(false);
    expect(component.autoSavable(target)).toBe(false);
    expect(component.showNearbyChoices(target)).toBe(true);
  });

  it('หลังรองอยู่ห่างออกไปชัดเจน → ยืนยันได้ตามเดิม ไม่ต้องรกด้วยปุ่มให้เลือก', () => {
    // 99/2 ห่างราว 33 ม. จากจุดถ่าย ทิ้งห่างหลังแรกเกิน 15 ม.
    const target = setup([house(1, '99/1', 13.75001), house(2, '99/2', 13.7503)], {
      memberId: 1,
      matchedBy: 'system'
    });

    expect(component.hasCloseRival(target)).toBe(false);
    expect(component.isConfirmedByCoords(target)).toBe(true);
    expect(component.showNearbyChoices(target)).toBe(false);
  });

  it('ยังไม่รู้ว่าบ้านไหน → ยกบ้านที่ใกล้ที่สุดมาให้กดเลือก เรียงจากใกล้ไปไกล', () => {
    const target = setup([
      house(3, '99/3', 13.7504),
      house(1, '99/1', 13.75001),
      house(2, '99/2', 13.75009)
    ]);

    expect(component.showNearbyChoices(target)).toBe(true);
    expect(target.nearby.map(n => n.member.house_no)).toEqual(['99/1', '99/2', '99/3']);
  });

  it('บ้านที่ไม่มีพิกัด และบ้านที่อยู่ไกลเกิน 60 ม. ต้องไม่โผล่มาเป็นตัวเลือก', () => {
    const target = setup([
      house(1, '99/1', 13.75001),
      house(2, '99/2', null),
      house(3, '99/3', 13.7510) // ห่างราว 111 ม.
    ]);

    expect(target.nearby.map(n => n.member.house_no)).toEqual(['99/1']);
  });

  it('รูปไม่มีพิกัด → ไม่มีอะไรให้เทียบ ไม่ต้องโชว์ปุ่มเลือก', () => {
    const target = setup([house(1, '99/1', 13.75001)], { latitude: null, longitude: null });

    expect(target.nearby).toEqual([]);
    expect(component.showNearbyChoices(target)).toBe(false);
  });

  it('กดเลือกจากปุ่ม → ถือเป็นคนเลือกเอง ผลจากหลังบ้านจะไม่มาทับทีหลัง', () => {
    const target = setup([house(1, '99/1', 13.75001), house(2, '99/2', 13.75009)]);

    component.pickNearby(target, target.nearby[1].member);

    expect(target.memberId).toBe(2);
    expect(target.matchedBy).toBe('manual');
  });

  /**
   * บ้านหนึ่งหลังมีบิลได้รอบละใบเดียว ตัวเลือกที่รูปใบอื่นจองไปแล้วจึงกดไปก็ติด "ซ้ำในกอง"
   * อยู่ดี — ตัดออกจากตัวเลือกที่กดได้ แต่ห้ามเติมหลังที่เหลือให้เอง เพราะถ้ารูปที่ไปจอง
   * ไว้เลือกผิด แถวนี้จะผิดตามเป็นลูกโซ่โดยไม่มีใครทัก
   */
  describe('บ้านที่รูปใบอื่นในกองจองไปแล้ว', () => {
    /** สองแถวที่ถ่ายจากจุดเดียวกัน มีบ้านให้เลือกคู่เดียวกัน */
    const twoRows = (over: any = {}) => {
      component.members = [house(1, '99/1', 13.75001), house(2, '99/2', 13.75009)];
      component.rows = [row({ seq: 1, fileKey: 'a', ...over }), row({ seq: 2, fileKey: 'b', memberId: 2, matchedBy: 'manual' })] as any;
      component.refreshAllNearby();
      return component.rows[0];
    };

    it('ตัวเลือกที่ถูกจองแล้วต้องบอกว่ารูปใบไหนจอง และเหลือหลังว่างหลังเดียว', () => {
      const target = twoRows();

      expect(target.nearby.map((n: any) => n.takenBySeq)).toEqual([null, 2]);
      expect(component.freeNearbyCount(target)).toBe(1);
    });

    it('เหลือทางเดียวก็ยังไม่เติมบ้านให้เอง และยังไม่ออกบิลให้เอง', () => {
      const target = twoRows();

      expect(target.memberId).toBeNull();
      expect(component.autoSavable(target)).toBe(false);
      expect(component.showNearbyChoices(target)).toBe(true);
    });

    it('แถวอื่นปล่อยบ้านที่จองไว้ → ตัวเลือกกลับมากดได้เอง ไม่ต้องเลือกรูปใหม่', () => {
      const target = twoRows();

      component.rows[1].memberId = null;
      component.onMemberChanged(component.rows[1] as any);

      expect(target.nearby.every((n: any) => n.takenBySeq === null)).toBe(true);
      expect(component.freeNearbyCount(target)).toBe(2);
    });
  });
});
