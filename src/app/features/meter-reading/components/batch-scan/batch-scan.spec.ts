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
  photoData: null,
  memberId: null,
  matchedBy: 'none',
  matchedByCoords: false,
  matchConfidence: null,
  matchReason: null,
  candidates: [],
  warnings: [],
  unit: null,
  confidence: null,
  confirmHighUsage: false,
  status: 'pending',
  error: null,
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

    it('ย่อรูปยังไม่เสร็จ → ออกบิลไปโดยไม่มีรูป ดีกว่าค้างคิวไว้', () => {
      component.rows = [row({ seq: 1, memberId: 1, unit: 1250, photoData: null })] as any;

      component.saveAll();
      http.expectOne(r => r.url.endsWith('/water-rates/active')).flush({ id: 5 });
      answerPrevious(1200);

      const req = http.expectOne(r => r.url.endsWith('/bills/scan'));
      expect(req.request.body.meter_photo).toBeUndefined();
      req.flush({ id: 901 });

      expect(component.savedCount).toBe(1);
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

    it('ติดด่านหน่วยผิดปกติ → ยืนยันในหน้านี้ได้ แล้วรอบถัดไปส่งธงยืนยันไปด้วย', () => {
      component.rows = [row({ seq: 1, memberId: 1, unit: 900 })] as any;

      component.saveAll();
      http.expectOne(r => r.url.endsWith('/water-rates/active')).flush({ id: 5 });
      answerPrevious();
      http.expectOne(r => r.url.endsWith('/bills/scan')).flush(
        { message: 'เดือนนี้ใช้น้ำ 800 หน่วย สูงผิดปกติ' },
        { status: 409, statusText: 'Conflict' }
      );

      expect(component.needsHighUsageConfirm(component.rows[0])).toBe(true);
      component.confirmHighUsage(component.rows[0]);

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
   * พิกัดในรูปยืนยันบ้านได้แล้วก็ไม่ต้องให้คนมานั่งเลือกบ้านซ้ำ ระบบออกบิลต่อให้เลย
   * ระยะ 25 ม. คือเส้นแบ่ง — สั้นกว่าระยะที่ใช้ "เดา" บ้านครึ่งหนึ่ง เพราะไม่มีคนตรวจซ้ำแล้ว
   */
  describe('ออกบิลอัตโนมัติเมื่อพิกัดตรงกับบ้าน', () => {
    /** บ้าน 99/1 มีพิกัด ส่วนรูปถ่ายห่างจากมิเตอร์ตามที่กำหนด (0.0001 องศา ≈ 11 ม.) */
    const setup = (over: any = {}) => {
      component.members = [{ ...house(1, '99/1'), latitude: 13.75, longitude: 100.5 }];
      component.rows = [
        row({ seq: 1, memberId: 1, matchedBy: 'system', unit: 1250, confidence: 95, latitude: 13.75, longitude: 100.5, status: 'ready', ...over })
      ] as any;
      return component.rows[0];
    };

    it('พิกัดตรงกับบ้าน → ออกบิลให้เองโดยไม่ต้องเลือกบ้านเพิ่ม', () => {
      expect(component.autoSavable(setup())).toBe(true);
    });

    it('ถ่ายห่างจากมิเตอร์ของบ้านนั้นเกิน 25 ม. → ต้องให้คนตรวจ', () => {
      // 0.0005 องศาละติจูด ≈ 55 ม.
      expect(component.autoSavable(setup({ latitude: 13.7505 }))).toBe(false);
    });

    it('รูปไม่มีพิกัด → ยืนยันบ้านไม่ได้ ต้องให้คนตรวจ', () => {
      expect(component.autoSavable(setup({ latitude: null, longitude: null }))).toBe(false);
    });

    it('บ้านที่จับคู่ได้ยังไม่มีพิกัดเก็บไว้ → เทียบไม่ได้ ต้องให้คนตรวจ', () => {
      const target = setup();
      component.members = [house(1, '99/1')];

      expect(component.autoSavable(target)).toBe(false);
    });

    it('อ่านเลขมาไม่ชัดแต่พิกัดตรง → ยังออกให้ (ด่านหน่วยน้ำ/จำนวนหลักของหลังบ้านยังกันอยู่)', () => {
      expect(component.autoSavable(setup({ confidence: 60 }))).toBe(true);
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
      component.rows = [row({ seq: 1, latitude: 13.75, longitude: 100.5 })] as any;

      component.analyze();
      http.expectOne(r => r.url.endsWith('/bills/scan-batch')).flush({
        results: [result({ photo_taken: null })] // พิกัดใช้ของที่อ่านเองจากไฟล์
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
      http.expectOne(r => r.url.endsWith('/bills/scan-batch')).flush({ results: [result()] });

      http.expectNone(r => r.url.endsWith('/water-rates/active'));
      expect(component.isSaving).toBe(false);
    });

    it('ด่านเลขน้อยกว่าเลขตั้งต้นยังทำงาน แม้เป็นใบที่ออกให้เอง', () => {
      component.members = [{ ...house(1, '99/1'), latitude: 13.75, longitude: 100.5 }];
      component.rows = [row({ seq: 1, latitude: 13.75, longitude: 100.5 })] as any;

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
   * บ้านที่ลงทะเบียนตอนระบบยังยอมรับพิกัดที่เครื่องเดาจากเน็ต จะมีพิกัดอยู่คนละอำเภอ
   * รูปที่ถ่ายหน้ามิเตอร์จึงไม่มีทางตรงกับมันได้เลย — ต้องซ่อมค่านั้นให้ ไม่ใช่ปล่อยไว้
   */
  describe('ซ่อมพิกัดบ้านที่เสีย', () => {
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

    it('พิกัดของบ้านอยู่ไกลหมู่บ้านคนละเรื่อง → ทับด้วยพิกัดในรูปหลังออกบิลสำเร็จ', () => {
      const broken = { ...house(4, '99/4'), latitude: 14.98335, longitude: 100.0 }; // ค่าที่เครื่องเดาจาก IP
      component.members = [...village(), broken];
      component.rows = [
        row({ seq: 1, memberId: 4, matchedBy: 'system', unit: 120, latitude: 13.7503, longitude: 100.5003 })
      ] as any;

      expect(component.needsCoordsRepair(component.rows[0])).toBe(true);
      saveOneRow();

      const update = http.expectOne(r => r.url.endsWith('/member/update'));
      expect(update.request.body.latitude).toBe(13.7503);
      expect(update.request.body.longitude).toBe(100.5003);
      update.flush({});
    });

    it('บ้านที่ยังไม่มีพิกัดเลย → เก็บพิกัดจากรูปให้ด้วย', () => {
      component.members = [...village(), house(4, '99/4')];
      component.rows = [
        row({ seq: 1, memberId: 4, matchedBy: 'system', unit: 120, latitude: 13.7503, longitude: 100.5003 })
      ] as any;

      saveOneRow();

      http.expectOne(r => r.url.endsWith('/member/update')).flush({});
    });

    it('พิกัดเดิมใช้ได้อยู่แล้ว → ห้ามทับ (GPS มือถือแกว่งเป็นสิบเมตรทุกครั้งที่ถ่าย)', () => {
      component.members = village();
      component.rows = [
        row({ seq: 1, memberId: 1, matchedBy: 'system', unit: 120, latitude: 13.7501, longitude: 100.5001 })
      ] as any;

      expect(component.needsCoordsRepair(component.rows[0])).toBe(false);
      saveOneRow();

      http.expectNone(r => r.url.endsWith('/member/update'));
    });

    it('บ้านที่ได้มาจากพิกัดในรูปเอง → ห้ามเอาพิกัดไปทับพิกัด (งูกินหาง)', () => {
      component.members = [...village(), { ...house(4, '99/4'), latitude: 14.98335, longitude: 100.0 }];
      component.rows = [
        row({ seq: 1, memberId: 4, matchedBy: 'system', matchedByCoords: true, unit: 120, latitude: 13.7503, longitude: 100.5003 })
      ] as any;

      expect(component.needsCoordsRepair(component.rows[0])).toBe(false);
    });

    it('ยังมีบ้านที่มีพิกัดไม่ถึง 3 หลัง → ยังตัดสินไม่ได้ ห้ามทับของใคร', () => {
      component.members = [
        { ...house(1, '99/1'), latitude: 13.75, longitude: 100.5 },
        { ...house(4, '99/4'), latitude: 14.98335, longitude: 100.0 }
      ];
      component.rows = [
        row({ seq: 1, memberId: 4, matchedBy: 'system', unit: 120, latitude: 13.7503, longitude: 100.5003 })
      ] as any;

      expect(component.needsCoordsRepair(component.rows[0])).toBe(false);
    });

    it('ซ่อมพิกัดไม่สำเร็จ ต้องไม่ทำให้บิลที่ออกไปแล้วดูเหมือนล้มเหลว', () => {
      component.members = [...village(), house(4, '99/4')];
      component.rows = [
        row({ seq: 1, memberId: 4, matchedBy: 'system', unit: 120, latitude: 13.7503, longitude: 100.5003 })
      ] as any;

      saveOneRow();
      http.expectOne(r => r.url.endsWith('/member/update')).flush({ message: 'ล่ม' }, { status: 500, statusText: 'Server Error' });

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
