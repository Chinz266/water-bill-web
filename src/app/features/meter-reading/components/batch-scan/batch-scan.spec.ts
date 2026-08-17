import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { BatchScanComponent } from './batch-scan';

/**
 * หน้าสแกนหลายรูป — งานจับคู่บ้านอยู่ที่ POST /bills/scan-batch ของหลังบ้าน
 * หน้านี้มีหน้าที่ส่งรูปให้ถูกรูปแบบ แสดงผลให้คนตรวจ แล้วออกบิลทีละใบ
 * จุดที่พังแล้วเจ็บคือ "ส่งไม่ตรง contract" กับ "รูปหลายใบชนกันเอง"
 */

const house = (id: number, houseNo: string) => ({
  id,
  house_no: houseNo,
  fname: 'สมชาย',
  lname: 'ใจดี'
});

const row = (over: any = {}) => ({
  seq: over.seq ?? 1,
  file: new File(['รูปจำลอง'], `meter-${over.seq ?? 1}.jpg`, { type: 'image/jpeg' }),
  fileKey: `meter-${over.seq ?? 1}.jpg|1|1`,
  fileName: `meter-${over.seq ?? 1}.jpg`,
  previewUrl: 'blob:preview',
  brokenImage: false,
  capturedAt: null,
  latitude: null,
  longitude: null,
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
  unit: null,
  confidence: null,
  confirmHighUsage: false,
  confirmDigitChange: false,
  confirmLowConfidence: false,
  confirmDuplicateLocation: false,
  confirmStalePhoto: false,
  ocrUnit: null,
  meterDigits: null,
  ocrConfidence: null,
  status: 'pending',
  error: null,
  errorCode: null,
  billId: null,
  ...over
});

/** ผลวิเคราะห์ 1 ใบตามรูปแบบที่ ScanBatchService คืนมา */
const result = (over: any = {}) => ({
  index: 0,
  filename: 'meter-1.jpg',
  reading: { success: true, meter_unit: 1250, confidence: 0.95 },
  photo_taken: { captured_at: '2026-08-14T01:30:00.000Z', latitude: 13.75, longitude: 100.5 },
  confidence: 'high',
  reason: 'บ้าน 99/1 ใช้ไป 30 หน่วย ใกล้เคียงกับที่เคยใช้',
  warnings: [],
  suggestion: { members_id: 1, house_no: '99/1', usage_unit: 30 },
  candidates: [{ members_id: 1, house_no: '99/1', name: 'สมชาย ใจดี', usage_unit: 30 }],
  ...over
});

describe('BatchScanComponent', () => {
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

    http.expectOne(r => r.url.endsWith('/member/all')).flush([house(1, '99/1'), house(2, '99/2')]);
    http.expectOne(r => r.url.endsWith('/villages')).flush([{ id: 7, village_name: 'โนนกราด' }]);
  });

  afterEach(() => localStorage.clear());

  describe('ส่งรูปให้หลังบ้านวิเคราะห์', () => {
    it('ส่งไฟล์ในชื่อ files พร้อมรอบบิลและหมู่บ้าน ตามที่หลังบ้านรับ', () => {
      component.rows = [row({ seq: 1 }), row({ seq: 2 })] as any;
      component.billingKey = component.billingMonths[0].key;
      component.analyze();

      const req = http.expectOne(r => r.url.endsWith('/bills/scan-batch'));
      const body = req.request.body as FormData;
      expect(body.getAll('files').length).toBe(2);
      expect(body.get('billing_month')).toBe(component.billingMonths[0].month);
      expect(body.get('billing_year')).toBe(component.billingMonths[0].year);
      // มีหมู่บ้านเดียวต้องเลือกให้เอง ลดโอกาสจับคู่ผิดกับบ้านต่างหมู่บ้าน
      expect(body.get('villages_id')).toBe('7');
      req.flush({ results: [], summary: { high: 0, medium: 0, ambiguous: 0, none: 0 } });
    });

    it('เอาผลมาใส่ให้ตรงแถวตาม index ที่หลังบ้านคืนมา', () => {
      component.rows = [row({ seq: 1 }), row({ seq: 2 })] as any;
      component.analyze();

      http.expectOne(r => r.url.endsWith('/bills/scan-batch')).flush({
        results: [
          result({ index: 1, reading: { success: true, meter_unit: 880, confidence: 0.9 } }),
          result({ index: 0 })
        ]
      });

      expect(component.rows[0].unit).toBe(1250);
      expect(component.rows[1].unit).toBe(880);
      expect(component.rows[0].memberId).toBe(1);
      expect(component.rows[0].matchedBy).toBe('system');
      expect(component.rows[0].capturedAt).not.toBeNull();
    });

    it('แยกไม่ออก (suggestion เป็น null) → ไม่เลือกบ้านให้ ต้องให้คนเลือกเอง', () => {
      component.rows = [row({ seq: 1 })] as any;
      component.analyze();

      http.expectOne(r => r.url.endsWith('/bills/scan-batch')).flush({
        results: [result({ confidence: 'ambiguous', suggestion: null, reason: 'เข้าได้ทั้งสองบ้าน' })]
      });

      expect(component.rows[0].memberId).toBeNull();
      expect(component.blockingIssue(component.rows[0])).toContain('บ้านหลังไหน');
      expect(component.rows[0].matchReason).toContain('เข้าได้ทั้งสองบ้าน');
    });

    it('อ่านเลขไม่ได้ → ทำเครื่องหมายให้กรอกเอง พร้อมเหตุผลจากหลังบ้าน', () => {
      component.rows = [row({ seq: 1 })] as any;
      component.analyze();

      http.expectOne(r => r.url.endsWith('/bills/scan-batch')).flush({
        results: [result({ reading: { success: false, meter_unit: null, confidence: 0 }, suggestion: null, reason: 'อ่านเลขไม่ได้' })]
      });

      expect(component.rows[0].status).toBe('read_failed');
      expect(component.rows[0].error).toContain('อ่านเลขไม่ได้');
    });

    it('คนเลือกบ้านเองไว้แล้ว ผลจากหลังบ้านต้องไม่ทับ', () => {
      component.rows = [row({ seq: 1, memberId: 2, matchedBy: 'manual' })] as any;
      component.analyze();

      http.expectOne(r => r.url.endsWith('/bills/scan-batch')).flush({ results: [result()] });

      expect(component.rows[0].memberId).toBe(2);
    });

    it('ยิงพลาดทั้งชุด → ทุกแถวต้องถูกทำเครื่องหมาย ไม่ค้างเป็น pending เงียบ ๆ', () => {
      component.rows = [row({ seq: 1 }), row({ seq: 2 })] as any;
      component.analyze();

      http.expectOne(r => r.url.endsWith('/bills/scan-batch')).flush(
        { message: 'ล่ม' },
        { status: 500, statusText: 'Server Error' }
      );

      expect(component.rows.every(r => r.status === 'read_failed')).toBe(true);
      expect(component.isAnalyzing).toBe(false);
    });

    it('แถวที่กู้มาจากคิวเก่า (ไม่มีไฟล์) ต้องไม่ถูกส่งไปอ่าน', () => {
      component.rows = [row({ seq: 1, file: null, status: 'ready', unit: 100, memberId: 1 })] as any;

      component.analyze();

      http.expectNone(r => r.url.endsWith('/bills/scan-batch'));
    });
  });

  /**
   * พิกัดในรูปเป็นตัวสำรองของการจับคู่ด้วยเลขมิเตอร์ — เดิมหน้านี้ไม่ได้ใช้เลย
   * พอหลังบ้านจับคู่ไม่ได้ ทุกแถวเลยค้างที่ "ยังไม่รู้ว่าบ้านไหน" ทั้งที่รูปบอกตำแหน่งไว้แล้ว
   */
  describe('จับคู่บ้านจากพิกัดในรูป', () => {
    const houseAt = (id: number, houseNo: string, lat: number, lng: number) => ({
      ...house(id, houseNo),
      latitude: lat,
      longitude: lng
    });

    it('หลังบ้านจับคู่ไม่ได้ → ใช้พิกัดในรูปจับให้แทน แต่ตั้งเป็น "ควรตรวจก่อน"', () => {
      // สองหลังห่างกันราว 55 ม. — ไกลพอที่ GPS จะแยกออก
      component.members = [houseAt(1, '99/1', 13.75, 100.5), houseAt(2, '99/2', 13.7505, 100.5)];
      component.rows = [row({ seq: 1, latitude: 13.75, longitude: 100.5 })] as any;
      component.analyze();

      http.expectOne(r => r.url.endsWith('/bills/scan-batch')).flush({
        results: [result({ suggestion: null, confidence: 'ambiguous', photo_taken: null })]
      });

      expect(component.rows[0].memberId).toBe(1);
      expect(component.rows[0].matchedBy).toBe('system');
      // GPS แยกบ้านติดกันไม่ได้จริง จึงห้ามขึ้นว่ามั่นใจสูงเด็ดขาด
      expect(component.rows[0].matchConfidence).toBe('medium');
      expect(component.rows[0].matchReason).toContain('พิกัดในรูป');
    });

    it('บ้านสองหลังใกล้กันพอ ๆ กัน → ไม่เดามั่ว ปล่อยให้คนเลือก', () => {
      // ห่างกันราว 11 ม. ซึ่งน้อยกว่าความคลาดเคลื่อนของ GPS เอง
      component.members = [houseAt(1, '99/1', 13.75, 100.5), houseAt(2, '99/2', 13.7501, 100.5)];
      component.rows = [row({ seq: 1, latitude: 13.75, longitude: 100.5 })] as any;
      component.analyze();

      http.expectOne(r => r.url.endsWith('/bills/scan-batch')).flush({
        results: [result({ suggestion: null, confidence: 'ambiguous', photo_taken: null })]
      });

      expect(component.rows[0].memberId).toBeNull();
    });

    /**
     * "ไม่มีบ้านอยู่ใกล้เลย" กับ "มีสองหลังใกล้พอ ๆ กัน" ต้องขึ้นคนละข้อความ
     * เพราะคนต้องทำคนละอย่าง — อย่างแรกไปหาเองใน dropdown อย่างหลังดูรูปแล้วเลือกจากสองหลังนี้
     */
    it('สองหลังก้ำกึ่ง → บอกด้วยว่าลังเลระหว่างบ้านหลังไหน ห่างกันเท่าไร', () => {
      component.members = [houseAt(1, '99/1', 13.75, 100.5), houseAt(2, '99/2', 13.7501, 100.5)];
      component.rows = [row({ seq: 1, latitude: 13.75, longitude: 100.5 })] as any;
      component.analyze();

      http.expectOne(r => r.url.endsWith('/bills/scan-batch')).flush({
        results: [result({ suggestion: null, confidence: 'high', photo_taken: null })]
      });

      expect(component.rows[0].matchConfidence).toBe('ambiguous');
      expect(component.rows[0].matchReason).toContain('99/1');
      expect(component.rows[0].matchReason).toContain('99/2');
      expect(component.rows[0].matchReason).toContain('ต่างกันแค่');
    });

    it('ไม่มีบ้านหลังไหนอยู่ใกล้เลย → ไม่ต้องขึ้นว่าก้ำกึ่ง', () => {
      // ห่างไปราว 1.1 กม. เกินเพดานที่ยอมให้จับคู่
      component.members = [houseAt(1, '99/1', 13.76, 100.5)];
      component.rows = [row({ seq: 1, latitude: 13.75, longitude: 100.5 })] as any;
      component.analyze();

      http.expectOne(r => r.url.endsWith('/bills/scan-batch')).flush({
        results: [result({ suggestion: null, confidence: 'none', reason: null, photo_taken: null })]
      });

      expect(component.rows[0].memberId).toBeNull();
      expect(component.rows[0].matchConfidence).toBe('none');
      expect(component.rows[0].matchReason).toBeNull();
    });

    /**
     * เปิดหน้าแล้วกดเลือกรูปทันทีเป็นเรื่องปกติ ตอนนั้น /member/all ยังไม่กลับมา
     * matchByCoords เลยไม่มีบ้านให้เทียบ — ถ้าไม่ไล่ซ้ำตอนรายชื่อมาถึง ทั้งกอง
     * จะค้างที่ "ยังไม่รู้ว่าบ้านไหน" ทั้งที่พิกัดครบ และไม่มีอะไรมาเรียกให้อีกแล้ว
     */
    it('รายชื่อบ้านมาถึงหลังเลือกรูป → ไล่จับคู่จากพิกัดให้ใหม่', () => {
      component.members = [];
      component.rows = [row({ seq: 1, latitude: 13.75, longitude: 100.5 })] as any;

      component.loadMembers();
      http.expectOne(r => r.url.endsWith('/member/all')).flush([
        houseAt(1, '99/1', 13.75, 100.5),
        houseAt(2, '99/2', 13.7505, 100.5)
      ]);

      expect(component.rows[0].memberId).toBe(1);
      expect(component.rows[0].matchedByCoords).toBe(true);
    });

    it('หลังบ้านเสนอบ้านมาแล้ว (จับจากเลขมิเตอร์ซึ่งแม่นกว่า) → พิกัดต้องไม่ไปทับ', () => {
      component.members = [houseAt(1, '99/1', 13.75, 100.5), houseAt(2, '99/2', 13.7505, 100.5)];
      component.rows = [row({ seq: 1, latitude: 13.7505, longitude: 100.5 })] as any;
      component.analyze();

      http.expectOne(r => r.url.endsWith('/bills/scan-batch')).flush({
        results: [result({ suggestion: { members_id: 1, house_no: '99/1' } })]
      });

      expect(component.rows[0].memberId).toBe(1);
    });
  });

  describe('ตรวจความพร้อมก่อนออกบิล', () => {
    it('ไม่รู้บ้าน / ไม่มีเลข / เลขติดลบ ต้องบล็อกไว้', () => {
      expect(component.blockingIssue(row({ memberId: null, unit: 120 }) as any)).toContain('บ้านหลังไหน');
      expect(component.blockingIssue(row({ memberId: 1, unit: null }) as any)).toContain('เลขมิเตอร์');
      expect(component.blockingIssue(row({ memberId: 1, unit: -5 }) as any)).toContain('ติดลบ');
    });

    it('เลข 0 ออกบิลได้ (มิเตอร์เพิ่งติดใหม่)', () => {
      expect(component.blockingIssue(row({ memberId: 1, unit: 0 }) as any)).toBeNull();
    });

    it('สองรูปชี้บ้านเดียวกัน → บล็อกทั้งคู่ ไม่ปล่อยให้ทับกันเงียบ ๆ', () => {
      component.rows = [
        row({ seq: 1, memberId: 1, unit: 120 }),
        row({ seq: 2, memberId: 1, unit: 130 })
      ] as any;

      expect(component.savableRows.length).toBe(0);
      expect(component.blockingIssue(component.rows[0])).toContain('ซ้ำ');
    });
  });

  describe('ออกบิลทีละใบ', () => {
    const answerPrevious = (previousUnit: number | null = 0) =>
      http.expectOne(r => r.url.includes('/previous')).flush({ previous_unit: previousUnit, source: 'bill' });

    it('ดึงเรทค่าน้ำครั้งเดียว แล้วส่งพิกัด/เวลาถ่ายไปเก็บด้วย', () => {
      component.rows = [
        row({ seq: 1, memberId: 1, unit: 1250, capturedAt: new Date(2026, 6, 20), latitude: 13.75, longitude: 100.5 })
      ] as any;
      component.billingKey = component.billingMonths[0].key;

      component.saveAll();
      http.expectOne(r => r.url.endsWith('/water-rates/active')).flush({ id: 5 });
      answerPrevious(1200);

      const req = http.expectOne(r => r.url.endsWith('/bills/scan'));
      expect(req.request.body.members_id).toBe(1);
      expect(req.request.body.reading_date).toBe('2026-07-20');
      expect(req.request.body.latitude).toBe(13.75);
      expect(req.request.body.captured_at).toBeTruthy();
      expect(req.request.body.confirm_high_usage).toBe(false);
      req.flush({ id: 901 });

      expect(component.savedCount).toBe(1);
    });

    it('แนบรูปหน้าปัดไปกับบิลด้วย — ไม่งั้นบิลจากโหมดกองจะไม่มีหลักฐานให้เปิดดูย้อนหลัง', () => {
      component.rows = [
        row({ seq: 1, memberId: 1, unit: 1250, photoData: 'data:image/jpeg;base64,xxx' })
      ] as any;

      component.saveAll();
      http.expectOne(r => r.url.endsWith('/water-rates/active')).flush({ id: 5 });
      answerPrevious(1200);

      const req = http.expectOne(r => r.url.endsWith('/bills/scan'));
      expect(req.request.body.meter_photo).toBe('data:image/jpeg;base64,xxx');
      req.flush({ id: 901 });
    });

    it('ย่อรูปยังไม่เสร็จ แต่เลขมาจาก AI → ออกบิลไปโดยไม่มีรูป ดีกว่าค้างคิวไว้', () => {
      // ocrUnit เท่ากับ unit = เลขยังเป็นค่าที่ AI อ่านมาเป๊ะ ๆ ซึ่งตรวจย้อนหลังได้จาก
      // ค่า confidence/จำนวนหลักที่บันทึกไว้ รูปจึงไม่ใช่หลักฐานชิ้นเดียวที่เหลือ
      component.rows = [row({ seq: 1, memberId: 1, unit: 1250, ocrUnit: 1250, photoData: null })] as any;

      component.saveAll();
      http.expectOne(r => r.url.endsWith('/water-rates/active')).flush({ id: 5 });
      answerPrevious(1200);

      const req = http.expectOne(r => r.url.endsWith('/bills/scan'));
      expect(req.request.body.meter_photo).toBeUndefined();
      req.flush({ id: 901 });

      expect(component.savedCount).toBe(1);
    });

    it('กรอกเลขเองแล้วไม่มีรูป → บล็อกไว้ ไม่ยิงไปให้หลังบ้านตีกลับ', () => {
      // เลขที่คนพิมพ์เองโดยไม่มีรูปหน้าปัด = ไม่เหลืออะไรให้ตรวจย้อนหลังเลย
      // หลังบ้านบล็อกตาย (ไม่มีปุ่มยืนยัน) จึงต้องกันตั้งแต่ก่อนเข้าคิว
      const manual = row({ seq: 1, memberId: 1, unit: 1250, ocrUnit: null, photoData: null }) as any;
      component.rows = [manual];

      expect(component.blockingIssue(manual)).toContain('ต้องมีรูปหน้าปัด');

      component.saveAll();
      http.expectNone(r => r.url.endsWith('/bills/scan'));
    });

    it('เลขน้อยกว่าเลขตั้งต้น → ไม่ยิงออกบิลเลย (มักแปลว่าเลือกบ้านผิด)', () => {
      component.rows = [row({ seq: 1, memberId: 1, unit: 80 })] as any;

      component.saveAll();
      http.expectOne(r => r.url.endsWith('/water-rates/active')).flush({ id: 5 });
      answerPrevious(500);

      http.expectNone(r => r.url.endsWith('/bills/scan'));
      expect(component.rows[0].status).toBe('save_failed');
      expect(component.rows[0].error).toContain('เลือกบ้านถูกไหม');
    });

    it('ใบที่ออกบิลไม่ผ่าน ต้องคาไว้ให้แก้ แล้วใบอื่นไปต่อ', () => {
      component.rows = [
        row({ seq: 1, memberId: 1, unit: 120 }),
        row({ seq: 2, memberId: 2, unit: 130 })
      ] as any;

      component.saveAll();
      http.expectOne(r => r.url.endsWith('/water-rates/active')).flush({ id: 5 });

      answerPrevious();
      http.expectOne(r => r.url.endsWith('/bills/scan')).flush(
        { message: 'บ้านหลังนี้มีบิลของเดือนนี้แล้ว' },
        { status: 409, statusText: 'Conflict' }
      );

      answerPrevious();
      http.expectOne(r => r.url.endsWith('/bills/scan')).flush({ id: 902 });

      expect(component.rows[0].status).toBe('save_failed');
      expect(component.savedCount).toBe(1);
    });

    /**
     * กอง 30 ใบที่เขียวไปครึ่งกอง ใบที่ต้องแก้จะจมอยู่กลางกอง คนเลื่อนหาไม่เจอแล้วปิดหน้าไป
     * ทั้งที่ยังมีใบค้าง — เลข #seq ยังเป็นลำดับรูปเดิม ย้อนดูได้ว่ารูปไหนอยู่ตรงไหน
     */
    it('ใบที่ออกบิลแล้วจมลงล่าง ใบที่ยังค้างลอยขึ้นบน', () => {
      component.rows = [
        row({ seq: 1, memberId: 1, unit: 120 }),
        row({ seq: 2, memberId: 2, unit: 130 })
      ] as any;

      component.saveAll();
      http.expectOne(r => r.url.endsWith('/water-rates/active')).flush({ id: 5 });

      answerPrevious();
      http.expectOne(r => r.url.endsWith('/bills/scan')).flush({ id: 901 });

      answerPrevious();
      http.expectOne(r => r.url.endsWith('/bills/scan')).flush(
        { message: 'บ้านหลังนี้มีบิลของเดือนนี้แล้ว' },
        { status: 409, statusText: 'Conflict' }
      );

      expect(component.rows.map(r => r.seq)).toEqual([2, 1]);
      expect(component.rows[0].status).toBe('save_failed');
      expect(component.rows[1].status).toBe('saved');
    });

    it('ติดด่านหน่วยผิดปกติ → ยืนยันในหน้านี้ได้ แล้วรอบถัดไปส่งธงยืนยันไปด้วย', () => {
      component.rows = [row({ seq: 1, memberId: 1, unit: 900 })] as any;

      component.saveAll();
      http.expectOne(r => r.url.endsWith('/water-rates/active')).flush({ id: 5 });
      answerPrevious();
      http.expectOne(r => r.url.endsWith('/bills/scan')).flush(
        { message: 'เดือนนี้ใช้น้ำ 800 หน่วย สูงผิดปกติ', code: 'HIGH_USAGE' },
        { status: 409, statusText: 'Conflict' }
      );

      const step = component.pendingConfirm(component.rows[0] as any)!;
      expect(step.flag).toBe('confirmHighUsage');
      component.confirmStep(component.rows[0] as any, step);

      component.saveAll();
      http.expectOne(r => r.url.endsWith('/water-rates/active')).flush({ id: 5 });
      answerPrevious();

      const retry = http.expectOne(r => r.url.endsWith('/bills/scan'));
      expect(retry.request.body.confirm_high_usage).toBe(true);
      retry.flush({ id: 901 });
    });

    it('ยังไม่มีเรทค่าน้ำ → ไม่ยิงออกบิลสักใบ', () => {
      component.rows = [row({ seq: 1, memberId: 1, unit: 120 })] as any;

      component.saveAll();
      http.expectOne(r => r.url.endsWith('/water-rates/active')).flush(null);

      http.expectNone(r => r.url.endsWith('/bills/scan'));
      expect(component.isSaving).toBe(false);
    });
  });

  /**
   * ใบที่ยืนยันบ้านได้แล้วไม่ต้องให้คนมานั่งกดซ้ำ ระบบออกบิลต่อให้เลย
   *
   * ยืนยันได้ 2 ทาง: พิกัดในรูปห่างมิเตอร์ไม่เกิน 25 ม. (สั้นกว่าระยะที่ใช้ "เดา" บ้าน
   * ครึ่งหนึ่ง) หรือหลังบ้านชี้บ้านจากเลขมิเตอร์แบบมั่นใจสูงโดยพิกัดไม่ค้าน
   *
   * แต่ยืนยันบ้านได้อย่างเดียวไม่พอ — เลขต้องชัด วันถ่ายต้องมีและอยู่ในรอบที่กำลังออก
   * ไม่งั้นได้บ้านถูกแต่ยอดผิดหรือลงผิดเดือน ซึ่งไม่มีใครมาตรวจให้แล้ว
   */
  describe('ออกบิลอัตโนมัติเมื่อยืนยันบ้านได้', () => {
    /** ใบที่ผ่านทุกด่าน — บ้าน 99/1 มีพิกัด รูปถ่ายตรงจุดนั้น เลขชัด วันถ่ายอยู่ในรอบ */
    const setup = (over: any = {}) => {
      component.members = [{ ...house(1, '99/1'), latitude: 13.75, longitude: 100.5 }];
      component.rows = [
        row({
          seq: 1,
          memberId: 1,
          matchedBy: 'system',
          matchConfidence: 'high',
          unit: 1250,
          confidence: 95,
          latitude: 13.75,
          longitude: 100.5,
          capturedAt: new Date(),
          status: 'ready',
          ...over
        })
      ] as any;
      return component.rows[0];
    };

    it('พิกัดตรงกับบ้าน → ออกบิลให้เองโดยไม่ต้องเลือกบ้านเพิ่ม', () => {
      expect(component.autoSavable(setup())).toBe(true);
    });

    it('รูปไม่มีพิกัด แต่เลขมิเตอร์ชี้บ้านแบบมั่นใจสูง → ออกให้ (เลขมิเตอร์แม่นกว่า GPS)', () => {
      expect(component.autoSavable(setup({ latitude: null, longitude: null }))).toBe(true);
    });

    it('บ้านยังไม่เคยเก็บพิกัด แต่เลขมิเตอร์ชี้ได้ → ออกให้ (เทียบพิกัดไม่ได้ ≠ ขัดแย้ง)', () => {
      const target = setup();
      component.members = [house(1, '99/1')];

      expect(component.autoSavable(target)).toBe(true);
    });

    it('เลขมิเตอร์ชี้มั่นใจสูงแต่พิกัดค้านกันเกิน 50 ม. → ต้องให้คนตรวจ', () => {
      // 0.0005 องศาละติจูด ≈ 55 ม. ไกลเกินกว่าที่ GPS จะเพี้ยนได้ = คนละบ้าน
      expect(component.autoSavable(setup({ latitude: 13.7505 }))).toBe(false);
    });

    it('เลขมิเตอร์ชี้ได้ไม่มั่นใจ และพิกัดก็ยืนยันไม่ได้ → ต้องให้คนตรวจ', () => {
      expect(
        component.autoSavable(setup({ latitude: null, longitude: null, matchConfidence: 'medium' }))
      ).toBe(false);
    });

    it('บ้านที่ได้มาจากพิกัดในรูปเอง → ไม่นับเป็นการยืนยันด้วยเลขมิเตอร์ (งูกินหาง)', () => {
      expect(
        component.autoSavable(setup({ latitude: null, longitude: null, matchedByCoords: true }))
      ).toBe(false);
    });

    it('คนเลือกบ้านเอง → ไม่ต้องออกให้ คนอยู่หน้าจออยู่แล้ว', () => {
      expect(
        component.autoSavable(setup({ latitude: null, longitude: null, matchedBy: 'manual' }))
      ).toBe(false);
    });

    /**
     * เลขที่อ่านมาไม่ชัดคือยอดที่ลูกบ้านต้องจ่ายไม่ชัด — ด่านของหลังบ้าน (หน่วยน้ำสูงผิดปกติ
     * กับจำนวนหลักเปลี่ยน) จับได้แค่ที่เพี้ยนแรง ๆ ส่วนอ่าน 1250 เป็น 1258 ลอดไปได้สบาย
     */
    it('อ่านเลขมาไม่ชัด → ไม่ออกให้เอง แม้พิกัดจะตรง', () => {
      expect(component.autoSavable(setup({ confidence: 60 }))).toBe(false);
    });

    it('ไม่รู้ว่าอ่านมาชัดแค่ไหน → ไม่ออกให้เอง', () => {
      expect(component.autoSavable(setup({ confidence: null }))).toBe(false);
    });

    /** ไม่มีวันถ่าย = บิลไปลงวันที่กดอัปโหลด ซึ่งลากจำนวนวันของรอบถัดไปเพี้ยนตามไปด้วย */
    it('รูปไม่มีวันถ่าย → ไม่ออกให้เอง', () => {
      expect(component.autoSavable(setup({ capturedAt: null }))).toBe(false);
    });

    it('วันถ่ายคนละเดือนกับรอบบิลที่เลือก → ไม่ออกให้เอง (มักคือหยิบรูปเก่ามาผิดใบ)', () => {
      const old = new Date();
      old.setMonth(old.getMonth() - 2);

      expect(component.autoSavable(setup({ capturedAt: old }))).toBe(false);
    });

    it('หลังบ้านแนบคำเตือนมา → ไม่ออกให้เอง', () => {
      expect(component.autoSavable(setup({ warnings: ['เลขกระโดดจากเดือนก่อนเยอะ'] }))).toBe(false);
    });

    it('หน่วยน้ำพุ่งเกินที่บ้านหลังนี้เคยใช้มาก → ไม่ออกให้เอง', () => {
      const target = setup({
        candidates: [{ members_id: 1, house_no: '99/1', name: 'สมชาย ใจดี', usage_unit: 400, average_usage: 25 }]
      });

      expect(component.abnormalUsage(target)).toEqual({ usage: 400, average: 25 });
      expect(component.autoSavable(target)).toBe(false);
    });

    it('บ้านหลังนี้มีบิลของรอบนี้แล้ว → บล็อกไว้ก่อน ไม่ยิงไปให้หลังบ้านตีกลับ', () => {
      const target = setup({
        candidates: [{ members_id: 1, house_no: '99/1', name: 'สมชาย ใจดี', usage_unit: 30, already_billed: true }]
      });

      expect(component.blockingIssue(target)).toContain('มีบิลของรอบนี้อยู่แล้ว');
      expect(component.autoSavable(target)).toBe(false);

      // สั่งให้ทับแล้วก็เดินต่อได้ (คนติ๊กเอง = รู้ตัวว่าใบเดิมจะถูกลบ)
      component.replaceExisting = true;
      expect(component.blockingIssue(target)).toBeNull();
    });

    it('ติดด่านปกติ (เช่นยังไม่มีเลข) → ไม่ถูกข้ามให้', () => {
      expect(component.autoSavable(setup({ unit: null }))).toBe(false);
    });

    it('สองรูปชี้บ้านเดียวกัน → ไม่ออกให้เอง แม้พิกัดจะตรงทั้งคู่', () => {
      component.members = [{ ...house(1, '99/1'), latitude: 13.75, longitude: 100.5 }];
      component.rows = [
        row({ seq: 1, memberId: 1, unit: 1250, latitude: 13.75, longitude: 100.5 }),
        row({ seq: 2, memberId: 1, unit: 1260, latitude: 13.75, longitude: 100.5 })
      ] as any;

      expect(component.autoSavableRows.length).toBe(0);
    });

    it('อ่านเลขเสร็จแล้วยิงออกบิลต่อให้ทันที ไม่ต้องกดปุ่ม', () => {
      component.members = [{ ...house(1, '99/1'), latitude: 13.75, longitude: 100.5 }];
      component.rows = [
        row({ seq: 1, latitude: 13.75, longitude: 100.5, capturedAt: new Date() })
      ] as any;

      component.analyze();
      http.expectOne(r => r.url.endsWith('/bills/scan-batch')).flush({
        results: [result({ photo_taken: null })] // พิกัด/วันถ่ายใช้ของที่อ่านเองจากไฟล์
      });

      http.expectOne(r => r.url.endsWith('/water-rates/active')).flush({ id: 5 });
      http.expectOne(r => r.url.includes('/previous')).flush({ previous_unit: 1200, source: 'bill' });
      http.expectOne(r => r.url.endsWith('/bills/scan')).flush({ id: 901 });

      expect(component.savedCount).toBe(1);
    });

    it('ไม่มีใบไหนเข้าเงื่อนไข → ไม่ยิงอะไรเลยหลังอ่านเสร็จ', () => {
      component.members = [house(1, '99/1')]; // บ้านไม่มีพิกัด เทียบไม่ได้
      component.rows = [row({ seq: 1, latitude: 13.75, longitude: 100.5 })] as any;

      component.analyze();
      // อ่านเลขไม่ชัด + รูปไม่มีวันถ่าย = ตกด่านทั้งสองข้อ ต่อให้จับคู่บ้านได้ก็ตาม
      http.expectOne(r => r.url.endsWith('/bills/scan-batch')).flush({
        results: [result({ reading: { success: true, meter_unit: 1250, confidence: 0.4 }, photo_taken: null })]
      });

      http.expectNone(r => r.url.endsWith('/water-rates/active'));
      expect(component.isSaving).toBe(false);
    });

    it('ด่านเลขน้อยกว่าเลขตั้งต้นยังทำงาน แม้เป็นใบที่ออกให้เอง', () => {
      component.members = [{ ...house(1, '99/1'), latitude: 13.75, longitude: 100.5 }];
      component.rows = [
        row({ seq: 1, latitude: 13.75, longitude: 100.5, capturedAt: new Date() })
      ] as any;

      component.analyze();
      http.expectOne(r => r.url.endsWith('/bills/scan-batch')).flush({ results: [result({ photo_taken: null })] });

      http.expectOne(r => r.url.endsWith('/water-rates/active')).flush({ id: 5 });
      http.expectOne(r => r.url.includes('/previous')).flush({ previous_unit: 9999, source: 'bill' });

      http.expectNone(r => r.url.endsWith('/bills/scan'));
      expect(component.rows[0].status).toBe('save_failed');
      expect(component.rows[0].error).toContain('เลือกบ้านถูกไหม');
    });
  });

  /**
   * เลือกรูปเสร็จต้องได้ไปตรวจผลเลย ไม่ใช่มานั่งกดปุ่ม "อ่านเลข" อีกที
   * จุดที่พลาดง่ายคือยิงสองรอบตอนคนเลือกรูปเพิ่ม แล้วชุดหลังไปต่อคิวชุดแรกไม่ได้
   */
  describe('อ่านเลขเองตั้งแต่เลือกรูป', () => {
    const image = (name: string) => new File(['รูปจำลอง'], name, { type: 'image/jpeg' });

    const pick = async (files: File[]) => {
      const input = { files, value: '' } as unknown as HTMLInputElement;
      await component.onFilesPicked({ target: input } as unknown as Event);
    };

    beforeEach(() => {
      vi.useFakeTimers();
      // ย่อรูปต้องใช้ canvas ซึ่ง jsdom ไม่มี และไม่เกี่ยวกับเส้นทางที่กำลังทดสอบ
      vi.spyOn(component as any, 'photoDataUrl').mockResolvedValue(null);
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('เลือกรูปแล้วยิงอ่านให้เอง ไม่ต้องกดปุ่ม', async () => {
      await pick([image('meter-1.jpg')]);
      http.expectNone(r => r.url.endsWith('/bills/scan-batch')); // ยังไม่ถึงเวลา

      vi.advanceTimersByTime(2000);

      const req = http.expectOne(r => r.url.endsWith('/bills/scan-batch'));
      expect((req.request.body as FormData).getAll('files').length).toBe(1);
      req.flush({ results: [] });
    });

    it('เลือกเพิ่มอีกชุดตามหลัง → รวมเป็นรอบเดียว ไม่ยิงสองครั้ง', async () => {
      await pick([image('meter-1.jpg')]);
      vi.advanceTimersByTime(500);
      await pick([image('meter-2.jpg')]);
      vi.advanceTimersByTime(2000);

      const req = http.expectOne(r => r.url.endsWith('/bills/scan-batch'));
      expect((req.request.body as FormData).getAll('files').length).toBe(2);
      req.flush({ results: [] });
    });

    it('กดปุ่มเองทันก่อน → ไม่ยิงซ้ำตอนครบเวลา', async () => {
      await pick([image('meter-1.jpg')]);
      component.analyze();
      http.expectOne(r => r.url.endsWith('/bills/scan-batch')).flush({ results: [] });

      vi.advanceTimersByTime(2000);

      http.expectNone(r => r.url.endsWith('/bills/scan-batch'));
    });
  });

  /**
   * ค่าตั้งต้นของรอบบิลคือ "เดือนนี้" ซึ่งผิดทันทีที่ไปจดสิ้นเดือนแล้วมาอัปวันที่ 1–2
   * ของเดือนถัดไป (เกิดประจำ) — บิลทั้งกองจะไปลงเดือนใหม่ เดือนที่ใช้น้ำจริงไม่มีบิล
   */
  describe('ตั้งรอบบิลตามวันถ่ายในรูป', () => {
    /** ย้อนไป N เดือนจากวันนี้ แล้วคืนคีย์รอบบิลแบบเดียวกับ monthOptions */
    const monthsAgo = (n: number) => {
      const date = new Date();
      date.setDate(1);
      date.setMonth(date.getMonth() - n);
      return { date, key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` };
    };

    it('รูปส่วนใหญ่ถ่ายเดือนก่อน → ตั้งรอบบิลเป็นเดือนนั้นให้เอง', () => {
      const last = monthsAgo(1);
      component.rows = [
        row({ seq: 1, capturedAt: last.date }),
        row({ seq: 2, capturedAt: last.date }),
        row({ seq: 3, capturedAt: new Date() })
      ] as any;

      (component as any).syncBillingToPhotos();

      expect(component.billingKey).toBe(last.key);
      // ใบที่หลงกองมาจากเดือนอื่นต้องถูกทักรายแถว ไม่ใช่ลากทั้งกองตาม
      expect(component.isOutsideBillingMonth(component.rows[2])).toBe(true);
      expect(component.notes(component.rows[2]).join(' ')).toContain('คนละเดือนกับรอบบิล');
    });

    it('ออกบิลไปแล้วบางใบ → ไม่เปลี่ยนรอบให้ (จะเหลือกองที่คนละรอบกัน)', () => {
      const before = component.billingKey;
      component.rows = [
        row({ seq: 1, capturedAt: monthsAgo(1).date }),
        row({ seq: 2, capturedAt: monthsAgo(1).date, status: 'saved' })
      ] as any;

      (component as any).syncBillingToPhotos();

      expect(component.billingKey).toBe(before);
    });

    it('รูปเก่ากว่าเดือนที่เลือกได้ → ปล่อยให้คนเลือกเอง ไม่ตั้งมั่ว', () => {
      const before = component.billingKey;
      component.rows = [row({ seq: 1, capturedAt: monthsAgo(11).date })] as any;

      (component as any).syncBillingToPhotos();

      expect(component.billingKey).toBe(before);
    });
  });

  /**
   * บ้านที่ลงทะเบียนตอนระบบยังยอมรับพิกัดที่เครื่องเดาจากเน็ต จะมีพิกัดอยู่คนละอำเภอ
   * รูปที่ถ่ายหน้ามิเตอร์จึงไม่มีทางตรงกับมันได้เลย — หน้านี้มีหน้าที่ "บอกว่าหลังไหน"
   * เท่านั้น ห้ามยิงแก้ทะเบียนเอง (ทับผิดหลังทีเดียวคือพิกัดที่ถูกหายโดยไม่มีร่องรอย)
   */
  describe('รายงานพิกัดบ้านที่เสีย', () => {
    /** บรรทัดรายงานออก terminal — เก็บไว้ตรวจว่าบอกบ้านหลังที่ถูกต้อง */
    let warned: string[];

    beforeEach(() => {
      warned = [];
      vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        warned.push(args.join(' '));
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** หมู่บ้านอยู่แถว 13.75, 100.5 — ต้องมีอย่างน้อย 3 หลังถึงจะรู้ว่าใจกลางอยู่ไหน */
    const village = () => [
      { ...house(1, '99/1'), latitude: 13.75, longitude: 100.5 },
      { ...house(2, '99/2'), latitude: 13.7502, longitude: 100.5002 },
      { ...house(3, '99/3'), latitude: 13.7504, longitude: 100.5004 }
    ];

    const saveOneRow = () => {
      component.saveAll();
      http.expectOne(r => r.url.endsWith('/water-rates/active')).flush({ id: 5 });
      http.expectOne(r => r.url.includes('/previous')).flush({ previous_unit: 0, source: 'bill' });
      http.expectOne(r => r.url.endsWith('/bills/scan')).flush({ id: 901 });
    };

    it('พิกัดของบ้านอยู่ไกลหมู่บ้านคนละเรื่อง → รายงานออก terminal ไม่แก้ทะเบียนให้เอง', () => {
      const broken = { ...house(4, '99/4'), latitude: 14.98335, longitude: 102.12286 }; // ค้างมาจากหมู่บ้านคนละจังหวัด
      component.members = [...village(), broken];
      component.rows = [
        row({ seq: 1, memberId: 4, matchedBy: 'system', unit: 120, latitude: 13.7503, longitude: 100.5003 })
      ] as any;

      expect(component.needsCoordsRepair(component.rows[0])).toBe(true);
      saveOneRow();

      http.expectNone(r => r.url.endsWith('/member/update'));
      expect(warned).toHaveLength(1);
      expect(warned[0]).toContain('99/4');
      expect(warned[0]).toContain('13.750300,100.500300');
      // พิกัดเดิมต้องยังอยู่ครบ ไม่ถูกแตะจากในหน้านี้
      expect(broken.latitude).toBe(14.98335);
    });

    it('บ้านที่ยังไม่มีพิกัดเลย → รายงานเหมือนกัน (จับคู่รูปอัตโนมัติไม่ได้เท่ากัน)', () => {
      component.members = [...village(), house(4, '99/4')];
      component.rows = [
        row({ seq: 1, memberId: 4, matchedBy: 'system', unit: 120, latitude: 13.7503, longitude: 100.5003 })
      ] as any;

      saveOneRow();

      http.expectNone(r => r.url.endsWith('/member/update'));
      expect(warned[0]).toContain('ยังไม่มี');
    });

    it('พิกัดเดิมใช้ได้อยู่แล้ว → เงียบไว้ (GPS มือถือแกว่งเป็นสิบเมตรทุกครั้งที่ถ่าย)', () => {
      component.members = village();
      component.rows = [
        row({ seq: 1, memberId: 1, matchedBy: 'system', unit: 120, latitude: 13.7501, longitude: 100.5001 })
      ] as any;

      expect(component.needsCoordsRepair(component.rows[0])).toBe(false);
      saveOneRow();

      http.expectNone(r => r.url.endsWith('/member/update'));
      expect(warned).toHaveLength(0);
    });

    it('บ้านที่ได้มาจากพิกัดในรูปเอง → ไม่รายงาน (เอาพิกัดไปตัดสินพิกัดตัวเอง งูกินหาง)', () => {
      component.members = [...village(), { ...house(4, '99/4'), latitude: 14.98335, longitude: 102.12286 }];
      component.rows = [
        row({ seq: 1, memberId: 4, matchedBy: 'system', matchedByCoords: true, unit: 120, latitude: 13.7503, longitude: 100.5003 })
      ] as any;

      expect(component.needsCoordsRepair(component.rows[0])).toBe(false);
    });

    it('ยังมีบ้านที่มีพิกัดไม่ถึง 3 หลัง → ยังตัดสินไม่ได้ ห้ามกล่าวหาใคร', () => {
      component.members = [
        { ...house(1, '99/1'), latitude: 13.75, longitude: 100.5 },
        { ...house(4, '99/4'), latitude: 14.98335, longitude: 102.12286 }
      ];
      component.rows = [
        row({ seq: 1, memberId: 4, matchedBy: 'system', unit: 120, latitude: 13.7503, longitude: 100.5003 })
      ] as any;

      expect(component.needsCoordsRepair(component.rows[0])).toBe(false);
    });

    it('รายงานแล้วบิลที่ออกไปต้องยังนับว่าสำเร็จ (เป็นแค่ข้อสังเกต ไม่ใช่ความล้มเหลว)', () => {
      component.members = [...village(), house(4, '99/4')];
      component.rows = [
        row({ seq: 1, memberId: 4, matchedBy: 'system', unit: 120, latitude: 13.7503, longitude: 100.5003 })
      ] as any;

      saveOneRow();

      expect(component.rows[0].status).toBe('saved');
      expect(component.savedCount).toBe(1);
    });
  });

  describe('กู้คิวที่ค้างไว้', () => {
    const storedRow = (over: any = {}) => ({
      seq: 1,
      fileName: 'meter-1.jpg',
      capturedAt: null,
      latitude: null,
      longitude: null,
      memberId: 1,
      matchedBy: 'manual',
      matchMeters: null,
      billingKey: '2026-08',
      billingFromPhoto: false,
      unit: 120,
      confidence: null,
      confirmHighUsage: false,
      status: 'ready',
      error: null,
      billId: null,
      ...over
    });

    const remount = (rows: any[]) => {
      localStorage.setItem('water-bill.batch-queue', JSON.stringify({ savedAt: Date.now(), adminId: null, rows }));
      const fixture = TestBed.createComponent(BatchScanComponent);
      fixture.detectChanges();
      http.expectOne(r => r.url.endsWith('/member/all')).flush([house(1, '99/1')]);
      http.expectOne(r => r.url.endsWith('/villages')).flush([]);
      return fixture.componentInstance;
    };

    it('เปิดหน้ามาแล้วมีคิวค้าง → ถามก่อน ไม่ยัดกลับมาเอง', () => {
      const fresh = remount([storedRow(), storedRow({ seq: 2, status: 'saved' })]);

      expect(fresh.rows.length).toBe(0);
      expect(fresh.pendingRestoreLeft).toBe(1);
    });

    it('กดทำต่อ → ได้เฉพาะใบที่ยังไม่ออกบิล และไม่มีรูปให้แล้ว', () => {
      const fresh = remount([storedRow(), storedRow({ seq: 2, status: 'saved' })]);

      fresh.resumeQueue();

      expect(fresh.rows.length).toBe(1);
      expect(fresh.rows[0].file).toBeNull();
      expect(fresh.notes(fresh.rows[0])).toContain('แถวที่กู้มาจากคิวเก่า ไม่มีรูปให้เทียบแล้ว');
    });

    it('แถวที่ค้างตอนกำลังออกบิล → ไม่แน่ใจ แต่ยังกดออกบิลซ้ำได้', () => {
      const fresh = remount([storedRow({ status: 'saving' })]);

      fresh.resumeQueue();

      expect(fresh.rows[0].status).toBe('unknown');
      expect(fresh.blockingIssue(fresh.rows[0])).toBeNull();
    });

    it('ออกบิลครบทุกใบแล้วต้องล้างคิวทิ้ง ไม่ค้างไว้หลอกคนใช้', () => {
      component.rows = [row({ seq: 1, memberId: 1, unit: 120, status: 'saved' })] as any;
      component.onRowEdited();

      expect(localStorage.getItem('water-bill.batch-queue')).toBeNull();
    });
  });
});
