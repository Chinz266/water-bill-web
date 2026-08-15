import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { BatchScanComponent } from './batch-scan';

/**
 * ด่านกัน AI อ่านหลักหาย/หลักเกิน (meter_digits)
 *
 * มิเตอร์ตัวเดิมมีจำนวนหลักคงที่ตลอดอายุ หลังบ้านจึงเทียบจำนวนหลักของรอบนี้กับที่บ้าน
 * หลังนั้นเคยอ่านได้ ความผิดพลาดแบบหลักหายทำให้ยอดคลาดสิบเท่า (1250 → 125)
 * ซึ่งด่านหน่วยน้ำพุ่งจับไม่ได้ทุกเคส
 *
 * กติกาที่ห้ามพลาด: ส่ง meter_digits เฉพาะตอนเลขยังเป็นค่าที่ AI อ่านมาเป๊ะ ๆ
 * คนแก้เลขเองเมื่อไหร่ต้องไม่ส่ง ไม่งั้นด่านจะตรวจกับเลขที่ไม่ได้บันทึกจริง
 */

const house = (id: number, houseNo: string) => ({ id, house_no: houseNo, fname: 'สมชาย', lname: 'ใจดี' });

const row = (over: any = {}) => ({
  seq: over.seq ?? 1,
  file: new File(['รูป'], 'meter-1.jpg', { type: 'image/jpeg' }),
  fileKey: 'meter-1.jpg|1|1',
  fileName: 'meter-1.jpg',
  previewUrl: 'blob:preview',
  brokenImage: false,
  capturedAt: null,
  latitude: null,
  longitude: null,
  memberId: 1,
  matchedBy: 'system',
  matchConfidence: 'high',
  matchReason: null,
  candidates: [],
  warnings: [],
  unit: 1250,
  confidence: 95,
  confirmHighUsage: false,
  confirmDigitChange: false,
  croppedRead: false,
  ocrUnit: 1250,
  meterDigits: 4,
  status: 'ready',
  error: null,
  billId: null,
  ...over
});

describe('BatchScanComponent — ด่านจำนวนหลัก', () => {
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

    http.expectOne(r => r.url.endsWith('/member/all')).flush([house(1, '99/1')]);
    http.expectOne(r => r.url.endsWith('/villages')).flush([]);
  });

  afterEach(() => localStorage.clear());

  /** เดินคิวออกบิลจนถึง request /bills/scan ของใบแรก */
  const runToScan = () => {
    component.saveAll();
    http.expectOne(r => r.url.endsWith('/water-rates/active')).flush({ id: 5 });
    http.expectOne(r => r.url.includes('/previous')).flush({ previous_unit: 1200, source: 'bill' });
    return http.expectOne(r => r.url.endsWith('/bills/scan'));
  };

  it('เก็บจำนวนหลักจากผลอ่าน แล้วส่งไปกับตอนออกบิล', () => {
    component.rows = [row({ unit: null, ocrUnit: null, meterDigits: null, status: 'pending' })] as any;
    component.analyze();
    http.expectOne(r => r.url.endsWith('/bills/scan-batch')).flush({
      results: [{
        index: 0,
        reading: { success: true, meter_unit: 1250, confidence: 0.95, meter_digits: 4 },
        photo_taken: {},
        confidence: 'high',
        suggestion: { members_id: 1 },
        candidates: []
      }]
    });

    expect(component.rows[0].meterDigits).toBe(4);
    expect(component.rows[0].ocrUnit).toBe(1250);

    expect(runToScan().request.body.meter_digits).toBe(4);
  });

  it('คนแก้เลขเอง → ต้องไม่ส่งจำนวนหลักของ AI ไปให้ด่านตรวจ', () => {
    component.rows = [row({ unit: 1259, ocrUnit: 1250, meterDigits: 4 })] as any;

    const req = runToScan();
    expect(req.request.body.current_unit).toBe(1259);
    expect(req.request.body.meter_digits).toBeUndefined();
  });

  it('แถวที่กรอกเลขเองทั้งแถว (ไม่ได้ผ่าน AI) ก็ไม่ส่ง', () => {
    component.rows = [row({ ocrUnit: null, meterDigits: null })] as any;

    expect(runToScan().request.body.meter_digits).toBeUndefined();
  });

  it('โดนบล็อกเพราะจำนวนหลักไม่ตรง → ขึ้นปุ่มยืนยัน แล้วรอบถัดไปส่งธงไปด้วย', () => {
    component.rows = [row()] as any;

    runToScan().flush(
      { message: 'หน้าปัดมิเตอร์ของบ้านหลังนี้เคยอ่านได้ 5 หลัก แต่รอบนี้อ่านได้ 4 หลัก' },
      { status: 409, statusText: 'Conflict' }
    );

    expect(component.rows[0].status).toBe('save_failed');
    expect(component.needsDigitConfirm(component.rows[0])).toBe(true);
    // ด่านคนละตัวกัน ต้องไม่ขึ้นปุ่มยืนยันหน่วยน้ำสูงผิดปกติสลับกัน
    expect(component.needsHighUsageConfirm(component.rows[0])).toBe(false);

    component.confirmDigitChange(component.rows[0]);
    expect(component.rows[0].status).toBe('ready');

    expect(runToScan().request.body.confirm_digit_change).toBe(true);
  });

  it('ครอปอ่านใหม่แล้วได้เลขใหม่ → คำยืนยันจำนวนหลักของเลขเก่าต้องหลุดไปด้วย', () => {
    component.rows = [row({ confirmDigitChange: true })] as any;

    component.openCrop(component.rows[0] as any);
    component.onCropped({ blob: new Blob(['กรอบ'], { type: 'image/jpeg' }) });
    component.rereadCropped();
    http.expectOne(r => r.url.endsWith('/bills/scan-batch')).flush({
      results: [{
        index: 0,
        reading: { success: true, meter_unit: 12500, confidence: 0.9, meter_digits: 5 },
        photo_taken: {},
        confidence: 'high',
        suggestion: { members_id: 1 },
        candidates: []
      }]
    });

    expect(component.rows[0].unit).toBe(12500);
    expect(component.rows[0].meterDigits).toBe(5);
    expect(component.rows[0].confirmDigitChange).toBe(false);
  });
});
