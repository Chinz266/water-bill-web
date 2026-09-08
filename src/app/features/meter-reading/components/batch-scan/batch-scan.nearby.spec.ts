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
   * `notes()` คืนได้ทีละ 5-6 ข้อและมักซ้ำใจความกัน กองรวมกันแล้วบังหัวข้อที่ต้องลงมือทำจริง
   */
  describe('ยุบรายการข้อสังเกตไว้หลังปุ่มกด', () => {
    it('เริ่มต้นต้องปิดไว้ และกดสลับได้', () => {
      const target = setup([house(1, '99/1', 13.7498)]);

      expect(component.areNotesOpen(target)).toBe(false);

      component.toggleNotes(target);
      expect(component.areNotesOpen(target)).toBe(true);

      component.toggleNotes(target);
      expect(component.areNotesOpen(target)).toBe(false);
    });

    it('กางแถวหนึ่งต้องไม่กางแถวอื่นตามไปด้วย', () => {
      setup([house(1, '99/1', 13.7498)]);
      component.rows = [
        { ...component.rows[0], seq: 1 },
        { ...component.rows[0], seq: 2 }
      ] as any;

      component.toggleNotes(component.rows[0]);

      expect(component.areNotesOpen(component.rows[0])).toBe(true);
      expect(component.areNotesOpen(component.rows[1])).toBe(false);
    });
  });

  /**
   * คำถามที่คนโยนรูปเข้ามาถามจริง ๆ คือ "มิเตอร์ในรูปนี้คือตัวไหน" ไม่ใช่ "บ้าน B อยู่ทางไหน
   * ของบ้าน A" — ตัวนี้จึงเทียบพิกัดในรูปกับหมุดที่ลงทะเบียนไว้ ไม่ใช่หมุดเทียบหมุด
   */
  describe('ทิศของรูปเทียบกับหมุดบ้าน', () => {
    it('รูปถ่ายจากทางเหนือของหมุด → ตอบ "บน" พร้อมระยะ', () => {
      // รูปอยู่ที่ 13.75 ส่วนหมุดอยู่ใต้ลงไป → รูปอยู่ทางเหนือของหมุด
      const target = setup([house(1, '99/1', 13.7498)]);
      const side = component.photoSide(target, target.nearby[0].member);

      expect(side?.label).toBe('บน');
      expect(side?.meters).toBeGreaterThan(20);
      // ห่างเกิน SIDE_FLOOR_M → ยืนยันได้
      expect(side?.certain).toBe(true);
    });

    it('รูปถ่ายจากทางตะวันออกของหมุด → ตอบ "ขวา"', () => {
      const target = setup([{ ...house(1, '99/1', 13.75), longitude: 100.4997 }]);

      expect(component.photoSide(target, target.nearby[0].member)?.label).toBe('ขวา');
    });

    it('รูปกับหมุดใกล้กันกว่าเกณฑ์ → ตอบให้ แต่ยืนยันไม่ได้', () => {
      // ห่างราว 2 ม. — ต่ำกว่าความคลาดของ GPS ทิศที่ได้เป็นเสียงรบกวน
      const target = setup([house(1, '99/1', 13.749982)]);
      const side = component.photoSide(target, target.nearby[0].member);

      expect(side?.label).toBe('บน');
      expect(side?.certain).toBe(false);
    });

    it('รูปไม่มีพิกัด หรือบ้านยังไม่มีหมุด → ไม่มีอะไรให้เทียบ ต้องคืน null ไม่ใช่เดา', () => {
      const noPhoto = setup([house(1, '99/1', 13.7498)], { latitude: null, longitude: null });
      expect(component.photoSide(noPhoto, { latitude: 13.7498, longitude: 100.5 })).toBeNull();

      const withPhoto = setup([house(1, '99/1', 13.7498)]);
      expect(component.photoSide(withPhoto, { latitude: null, longitude: null })).toBeNull();
    });

    it('ยังไม่ได้เลือกบ้าน → ป้ายบนหัวแถวต้องไม่ขึ้น', () => {
      const target = setup([house(1, '99/1', 13.7498)]);

      expect(component.photoSideForRow(target)).toBeNull();

      target.memberId = 1;
      expect(component.photoSideForRow(target)?.label).toBe('บน');
    });
  });

  /**
   * เลขมิเตอร์เป็นยอดสะสมของแต่ละหลัง จึงเป็นหลักฐานที่แยกบ้านออกจากกันได้จริง ต่างจากระยะทาง
   * ที่ทุกหลังบนกำแพงเดียวกันได้เท่ากันหมด — หลังบ้านส่งเลขตั้งต้น/หน่วยเฉลี่ยของทุกหลัง
   * ที่เข้าเกณฑ์มาให้พร้อมผลอ่านเลขอยู่แล้ว (candidates) ปุ่มต้องเอามาโชว์ ไม่ใช่โชว์แต่ระยะ
   */
  describe('เลขมิเตอร์บนปุ่มเลือกบ้าน', () => {
    const candidate = (over: any = {}) => ({
      members_id: 1,
      house_no: '99/1',
      name: 'สมชาย ใจดี',
      previous_unit: 1200,
      usage_unit: 50,
      average_usage: 45,
      already_billed: false,
      score: 0.9,
      distance_m: null,
      ...over
    });

    it('เลขตั้งต้นกับหน่วยเฉลี่ยต้องมาจาก candidates ที่มีอยู่แล้ว ไม่ต้องยิงถามซ้ำทีละหลัง', () => {
      const target = setup([house(1, '99/1', 13.75001), house(2, '99/2', 13.75009)], {
        candidates: [
          candidate(),
          candidate({ members_id: 2, house_no: '99/2', previous_unit: 1000, average_usage: 200, score: 0.5 })
        ]
      });

      expect(target.nearby.map((n: any) => n.previousUnit)).toEqual([1200, 1000]);
      expect(target.nearby.map((n: any) => n.averageUsage)).toEqual([45, 200]);
      expect(target.nearby.every((n: any) => n.meterFits === true)).toBe(true);
    });

    it('หน่วยบนปุ่มคิดจากเลขในช่องตอนนี้ ไม่ใช่ค่าที่หลังบ้านคิดไว้ตอนจับคู่', () => {
      const target = setup([house(1, '99/1', 13.75001)], { candidates: [candidate()] });

      expect(component.nearbyUsage(target, target.nearby[0])).toBe(50);

      // คนแก้เลขในช่องเอง — ตัวเลขที่ใช้ตัดสินต้องขยับตาม ไม่ใช่ค้างที่ 50
      target.unit = 1300;
      expect(component.nearbyUsage(target, target.nearby[0])).toBe(100);
    });

    it('หลังที่เลขไม่เข้าต้องติดป้ายบอกเหตุผล แต่ยังกดได้ เผื่อเลขในช่องพิมพ์ผิด', () => {
      const target = setup([house(1, '99/1', 13.75001), house(2, '99/2', 13.75009)], {
        candidates: [candidate()]
      });

      const rejected = target.nearby.find((n: any) => Number(n.member.id) === 2)!;

      expect(rejected.meterFits).toBe(false);
      expect(component.nearbyMeterNote(target, rejected)).toBe('เลขที่อ่านได้ไม่เข้ากับหลังนี้');
      // ป้ายเตือนเท่านั้น ห้ามล็อกปุ่ม — ด่านจริงอยู่ตอนกดออกบิล
      expect(rejected.takenBySeq).toBeNull();
    });

    it('เลขในช่องน้อยกว่าเลขตั้งต้นของหลังนั้น → บอกว่ามิเตอร์ไม่เดินถอยหลัง', () => {
      const target = setup([house(1, '99/1', 13.75001)], { unit: 1100, candidates: [candidate()] });

      expect(component.nearbyMeterNote(target, target.nearby[0])).toContain('ไม่เดินถอยหลัง');
    });

    it('หลังที่เลขเข้าเค้าต้องมาก่อน ถึงจะอยู่ไกลกว่า — ปุ่มแรกคือปุ่มที่คนกดโดยไม่อ่าน', () => {
      const target = setup([house(1, '99/1', 13.75001), house(2, '99/2', 13.75009)], {
        candidates: [candidate({ members_id: 2, house_no: '99/2', previous_unit: 1000 })]
      });

      expect(target.nearby.map((n: any) => n.member.house_no)).toEqual(['99/2', '99/1']);
    });

    it('ยังไม่ได้อ่านเลข → ไม่มีอะไรมาค้าน ต้องไม่ติดป้ายมั่ว', () => {
      const target = setup([house(1, '99/1', 13.75001)]);

      expect(target.nearby[0].meterFits).toBeNull();
      expect(component.nearbyMeterNote(target, target.nearby[0])).toBeNull();
    });

    /**
     * ⚠️ เคสที่สำคัญที่สุดของชุดนี้ — เลขมิเตอร์มีสิทธิ์แค่ "จัดลำดับ" กับ "ติดป้าย"
     * ห้ามคัดหลังที่เลขไม่เข้าออกจาก row.nearby เพราะ hasCloseRival() อ่านจากลิสต์เดียวกัน
     * เป็นด่านกันระบบออกบิลเอง ถ้าคู่แข่งหายไป ด่านจะเงียบทั้งที่ GPS ยังชี้ไม่ขาดเหมือนเดิม
     */
    it('หลังที่เลขไม่เข้ายังนับเป็นคู่แข่ง — ด่านกันออกบิลเองต้องไม่ถูกลด', () => {
      const target = setup([house(1, '99/1', 13.75001), house(2, '99/2', 13.75009)], {
        memberId: 1,
        matchedBy: 'system',
        candidates: [candidate()]
      });

      expect(target.nearby.length).toBe(2);
      expect(component.hasCloseRival(target)).toBe(true);
      expect(component.isConfirmedByCoords(target)).toBe(false);
      expect(component.autoSavable(target)).toBe(false);
    });
  });

  /**
   * ป้ายซ้าย/ขวาเชื่อได้แค่ไหน ขึ้นกับว่าพิกัดของ **สองหลังนั้น** แม่นแค่ไหน
   * ไม่ใช่ค่ากลางของทั้งระบบ — มิเตอร์กลางทุ่งโล่งกับมิเตอร์ใต้ชายคาต่างกันหลายเท่า
   * หลังบ้านส่ง spread_m (MAD ของการจดที่ผ่านมา) มาให้ในทุก candidate อยู่แล้ว
   */
  describe('ป้ายซ้าย/ขวา ปรับเกณฑ์ตามความแม่นของแต่ละคู่', () => {
    const spreadCandidate = (id: number, houseNo: string, spread: number | null, score: number) => ({
      members_id: id,
      house_no: houseNo,
      name: 'สมชาย ใจดี',
      previous_unit: 1200,
      usage_unit: 50,
      average_usage: 45,
      already_billed: false,
      score,
      distance_m: null,
      spread_m: spread
    });

    /** สองหลังห่างกันราว 18 ม. — พ้นเขต 15 ม. ที่ GPS บอกซ้าย/ขวาไม่ได้ */
    const pair = (spreadA: number | null, spreadB: number | null) =>
      setup([house(1, '99/1', 13.75001), house(2, '99/2', 13.750175)], {
        candidates: [
          spreadCandidate(1, '99/1', spreadA, 0.9),
          spreadCandidate(2, '99/2', spreadB, 0.5)
        ]
      });

    it('พิกัดทั้งคู่นิ่ง → ห่าง 18 ม. พ้นเขต 15 ม. ป้ายขึ้นแบบยืนยันแล้ว', () => {
      const target = pair(2, 2);

      expect(target.nearby[1].sideLabel).toBe('บน');
      expect(target.nearby[1].sideCertain).toBe(true);
    });

    /**
     * ═══ เกณฑ์ถูกครอบด้วยเพดาน SIDE_TRUST_M (15 ม.) ═══
     *
     * ก่อนหน้านี้คู่ที่ความคลาดสูงจะได้เกณฑ์ 21-28 ม. ซึ่งกว้างกว่าระยะห่างจริงระหว่าง
     * บ้านข้างกัน ป้ายจึงเงียบเสมอสำหรับบ้านที่ยังไม่มีประวัติ — ซึ่งคือบ้านส่วนใหญ่
     * ในหมู่บ้านที่เพิ่งเริ่มใช้ระบบ ตอนนี้ทุกคู่ใช้เกณฑ์เดียวกันที่ 15 ม.
     *
     * ⚠️ 15 ม. มาจากการทดลองภาคสนาม (meter-bill.xlsx ตารางที่ 4.9) ส่วนการจำลองชี้ 20 ม.
     *    ป้ายที่ขึ้นมาเป็นของประกอบการตัดสินใจของคน ไม่ใช่ตัวชี้ขาดว่าเป็นบ้านไหน
     */
    it('พิกัดกระจายกว้าง → ห่าง 18 ม. ยังชนะเกณฑ์ 15 ม. ป้ายขึ้น', () => {
      const target = pair(15, 15);

      expect(target.nearby[1].sideLabel).toBe('บน');
      expect(target.nearby[1].sideRef).toBe('99/1');
    });

    it('บ้านที่ยังไม่มีประวัติพอ → เพดานครอบไว้ที่ 15 ม. ป้ายจึงขึ้นได้แล้ว', () => {
      expect(pair(null, null).nearby[1].sideLabel).toBe('บน');
    });

    it('รู้ความแม่นข้างเดียว → ชนเพดานเดียวกัน ป้ายขึ้นเหมือนกัน', () => {
      expect(pair(1, null).nearby[1].sideLabel).toBe('บน');
    });

    /**
     * จอ "ตอบเสมอ" ตามที่เจ้าของระบบเลือก — แต่คำตอบในเขต 15 ม. ต้องติดธง sideCertain
     * เป็น false เพื่อให้ template เขียนว่าเดา ไม่ใช่เขียนเหมือนป้ายที่ยืนยันแล้ว
     */
    it('ความคลาดสูง + หมุดห่างกันไม่ถึง 15 ม. → ตอบให้ แต่ยังยืนยันไม่ได้', () => {
      const close = setup([house(1, '99/1', 13.75001), house(2, '99/2', 13.750077)], {
        candidates: [
          spreadCandidate(1, '99/1', null, 0.9),
          spreadCandidate(2, '99/2', null, 0.5)
        ]
      });

      expect(close.nearby[1].sideLabel).toBe('บน');
      expect(close.nearby[1].sideRef).toBe('99/1');
      expect(close.nearby[1].sideCertain).toBe(false);
    });

    /**
     * เหตุผลที่มิเตอร์ห่างกัน 30 ซม. แยกไม่ออก ใช้ได้กับทุกระยะที่สั้นกว่าความคลาดของ
     * เครื่อง ไม่ใช่แค่ 30 ซม. — หมุดที่นิ่งแค่ไหนก็ไม่ช่วย เพราะสิ่งที่แกว่งคือพิกัดตอนถ่าย
     * ไม่ใช่หมุดที่จดไว้ เขต 15 ม. จึงยืนยันไม่ได้เท่ากันหมด ต่อให้หมุดนิ่งแค่ไหน
     */
    it('หมุดนิ่งมาก แต่ห่างกันไม่ถึง 15 ม. → ยังติดธงว่าเดา ไม่ใช่ยืนยัน', () => {
      const close = setup([house(1, '99/1', 13.75001), house(2, '99/2', 13.750077)], {
        candidates: [
          spreadCandidate(1, '99/1', 0.5, 0.9),
          spreadCandidate(2, '99/2', 0.5, 0.5)
        ]
      });

      expect(close.nearby[1].sideLabel).toBe('บน');
      expect(close.nearby[1].sideCertain).toBe(false);
    });

    it('ห่างกันมากพอ ป้ายขึ้นได้แม้ยังไม่มีประวัติเลย', () => {
      // 99/2 อยู่เหนือ 99/1 ราว 43 ม. ซึ่งพ้นเขต 15 ม. ไปไกล ไม่ว่าจะมีประวัติหรือไม่
      const target = setup([house(1, '99/1', 13.75001), house(2, '99/2', 13.7504)]);

      expect(target.nearby[1].sideLabel).toBe('บน');
      expect(target.nearby[1].sideRef).toBe('99/1');
    });
  });

  /**
   * เลขมิเตอร์กับพิกัดเป็นหลักฐานคนละชิ้นที่หามาได้อิสระจากกัน ตอบตรงกันคือยืนยันซึ่งกันและกัน
   * ตอบคนละหลังแปลว่าทางใดทางหนึ่งผิดแน่ ๆ — ใบแบบนั้นห้ามไหลออกไปเป็นบิลเองเด็ดขาด
   * แต่ก็ห้ามให้พิกัดไปเปลี่ยนบ้านที่เลขชี้มาด้วย เพราะพิกัดเป็นสัญญาณที่แย่กว่า
   */
  describe('เลขมิเตอร์กับพิกัดค้านกัน', () => {
    /** 13.75 + 0.0009 ≈ 100 ม. เหนือจุดถ่าย · 13.75001 ≈ 1 ม. */
    const clash = (over: any = {}) =>
      setup([house(1, '99/1', 13.7504), house(2, '99/2', 13.75001)], {
        memberId: 1,
        matchedBy: 'system',
        matchedByCoords: false,
        matchConfidence: 'high',
        ...over
      });

    it('บ้านที่เลขชี้อยู่ไกล แต่ยืนถ่ายที่หลังอื่น → ค้าน และห้ามออกบิลเอง', () => {
      const target = clash();

      const note = component.coordsContradictMeter(target)!;
      expect(note).toContain('99/1');
      expect(note).toContain('99/2');
      expect(component.autoSavable(target)).toBe(false);
    });

    it('ค้านแล้วต้องไม่เปลี่ยนบ้านให้เอง — พิกัดเป็นสัญญาณที่แย่กว่าเลขมิเตอร์', () => {
      const target = clash();

      expect(component.coordsContradictMeter(target)).not.toBeNull();
      expect(target.memberId).toBe(1);
      expect(target.matchedBy).toBe('system');
    });

    it('ป้ายบอกทิศของหลังที่ยืนอยู่ เทียบกับหลังที่เลขชี้มา', () => {
      // 99/2 อยู่ใต้ 99/1 ราว 43 ม. — ทิศมาจากหมุดสองอัน ไม่ใช่จากพิกัดในรูป
      expect(component.coordsContradictMeter(clash())).toContain('ทางล่าง');
    });

    it('ผลต่างระยะยังไม่ชนะความคลาดเคลื่อน → ไม่ใช่ข้อขัดแย้ง ต้องเงียบ', () => {
      // สองหลังห่างจากจุดถ่าย 11 ม. กับ 1 ม. — ต่างกัน 10 ม. ซึ่งน้อยกว่า 36 ม.
      const target = setup([house(1, '99/1', 13.7501), house(2, '99/2', 13.75001)], {
        memberId: 1,
        matchedBy: 'system',
        matchedByCoords: false
      });

      expect(component.coordsContradictMeter(target)).toBeNull();
    });

    it('คนเลือกบ้านเอง → ไม่มีสองทางให้ค้านกัน ต้องไม่ไปฟ้องสิ่งที่คนตัดสินแล้ว', () => {
      expect(component.coordsContradictMeter(clash({ matchedBy: 'manual' }))).toBeNull();
    });

    it('บ้านที่พิกัดเป็นคนชี้มาเอง → ค้านตัวเองไม่ได้', () => {
      expect(component.coordsContradictMeter(clash({ matchedByCoords: true }))).toBeNull();
    });

    /**
     * ⚠️ คงกฎเดิมของทั้งระบบ — ในกลุ่มมิเตอร์ที่ติดกัน ระยะทางเป็นเสียงรบกวนล้วน ๆ
     * ด่านที่สร้างจากระยะทางจะฟ้องมั่วทุกใบจนคนเลิกอ่านคำเตือน
     */
    it('กลุ่มมิเตอร์ที่ติดกันต้องไม่ถูกด่านนี้แตะเลย', () => {
      const wall = [
        { ...house(1, '99/1', 13.7504), cluster_group_id: 'w1', sequence_index: 1 },
        { ...house(2, '99/2', 13.75001), cluster_group_id: 'w1', sequence_index: 2 }
      ];
      const target = setup(wall, {
        memberId: 1,
        matchedBy: 'system',
        matchedByCoords: false
      });

      expect(component.coordsContradictMeter(target)).toBeNull();
      // ป้ายซ้าย/ขวาจากหมุดก็ต้องไม่ขึ้นในกลุ่มนี้ ตัวที่ตอบได้คือ sequence_index
      expect(target.nearby.every((n: any) => n.sideLabel === null)).toBe(true);
    });
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
