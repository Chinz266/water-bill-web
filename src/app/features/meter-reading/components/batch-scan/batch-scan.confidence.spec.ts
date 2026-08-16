import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { BatchScanComponent } from './batch-scan';

/**
 * ด่านความชัดของการอ่าน (read_confidence) + การเลือกปุ่มยืนยันจากรหัสที่หลังบ้านส่งมา
 *
 * ด่านนี้จับเคสที่เลขคลาดไปหลักเดียว (1250 → 1258) ซึ่งลอดด่านหน่วยน้ำกับด่านจำนวนหลัก
 * ไปได้ทั้งคู่เพราะยอดยังดูปกติทุกทาง — ไม่ส่งค่าขึ้นไป = ด่านไม่ทำงานเลย
 *
 * กติกาที่ห้ามพลาด:
 *   · ส่งค่าดิบ 0–1 ตามที่หลังบ้านใช้ ไม่ใช่เปอร์เซ็นต์ที่แสดงบนจอ (95 จะผ่านทุกใบ)
 *   · คนแก้เลขเองเมื่อไหร่ต้องไม่ส่ง เงื่อนไขเดียวกับ meter_digits
 *   · ด่านที่ห้ามข้าม (รูปถูกใช้ไปแล้ว ฯลฯ) ต้องไม่มีปุ่มยืนยันโผล่มาเด็ดขาด
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
  photoData: null,
  memberId: 1,
  matchedBy: 'system',
  matchedByCoords: false,
  matchConfidence: 'high',
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
  ocrConfidence: 0.952,
  status: 'ready',
  error: null,
  errorCode: null,
  billId: null,
  ...over
});

describe('BatchScanComponent — ด่านความชัดของการอ่าน', () => {
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

  /** ตีกลับ 1 ใบด้วยรหัสด่านที่กำหนด แล้วคืนแถวที่ติดด่าน */
  const blockWith = (body: any, status = 409) => {
    component.rows = [row()] as any;
    runToScan().flush(body, { status, statusText: status === 409 ? 'Conflict' : 'Bad Request' });
    return component.rows[0] as any;
  };

  describe('ค่าที่ส่งขึ้นไป', () => {
    it('เก็บค่าดิบ 0–1 จากผลอ่าน แล้วส่งไปกับตอนออกบิล (ไม่ใช่เปอร์เซ็นต์บนจอ)', () => {
      component.rows = [row({ unit: null, ocrUnit: null, ocrConfidence: null, status: 'pending' })] as any;
      component.analyze();
      http.expectOne(r => r.url.endsWith('/bills/scan-batch')).flush({
        results: [{
          index: 0,
          reading: { success: true, meter_unit: 1250, confidence: 0.873, meter_digits: 4 },
          photo_taken: {},
          confidence: 'high',
          suggestion: { members_id: 1 },
          candidates: []
        }]
      });

      // บนจอปัดเป็น 87% ได้ แต่ที่ส่งขึ้นไปต้องเป็นค่าเดิมทุกทศนิยม
      expect(component.rows[0].confidence).toBe(87);
      expect(component.rows[0].ocrConfidence).toBe(0.873);
      expect(runToScan().request.body.read_confidence).toBe(0.873);
    });

    it('คนแก้เลขเอง → ต้องไม่ส่งคะแนนของเลขที่ AI อ่านไปให้ด่านตรวจ', () => {
      component.rows = [row({ unit: 1259, ocrUnit: 1250 })] as any;

      const req = runToScan();
      expect(req.request.body.current_unit).toBe(1259);
      expect(req.request.body.read_confidence).toBeUndefined();
    });

    it('แถวที่กรอกเลขเองทั้งแถว (ไม่ได้ผ่าน AI) ก็ไม่ส่ง', () => {
      component.rows = [row({ ocrUnit: null, ocrConfidence: null })] as any;

      expect(runToScan().request.body.read_confidence).toBeUndefined();
    });
  });

  describe('ปุ่มยืนยันตามรหัสด่าน', () => {
    it('LOW_CONFIDENCE → ขึ้นปุ่มยืนยัน แล้วรอบถัดไปส่งธงไปด้วย', () => {
      const blocked = blockWith({ message: 'ระบบอ่านเลขมิเตอร์ได้ไม่ชัดเจน', code: 'LOW_CONFIDENCE' });

      const step = component.pendingConfirm(blocked)!;
      expect(step.flag).toBe('confirmLowConfidence');

      component.confirmStep(blocked, step);
      expect(runToScan().request.body.confirm_low_confidence).toBe(true);
    });

    it('DUPLICATE_LOCATION → ขึ้นปุ่มยืนยันว่าถ่ายใหม่จริง', () => {
      const blocked = blockWith({ message: 'พิกัดตรงกับรูปเดิมเป๊ะทุกทศนิยม', code: 'DUPLICATE_LOCATION' });

      const step = component.pendingConfirm(blocked)!;
      expect(step.flag).toBe('confirmDuplicateLocation');

      component.confirmStep(blocked, step);
      expect(runToScan().request.body.confirm_duplicate_location).toBe(true);
    });

    it('STALE_PHOTO → ขึ้นปุ่มยืนยันว่าใช้รูปถูกใบ', () => {
      const blocked = blockWith({ message: 'เลขบนหน้าปัดในรูปอาจไม่ใช่เลขของรอบนี้', code: 'STALE_PHOTO' });

      const step = component.pendingConfirm(blocked)!;
      expect(step.flag).toBe('confirmStalePhoto');

      component.confirmStep(blocked, step);
      expect(runToScan().request.body.confirm_stale_photo).toBe(true);
    });

    /**
     * ด่านนี้แปลว่ารูปใบนี้ถูกใช้ออกบิลไปแล้ว ต้องไปถ่ายใหม่อย่างเดียว
     * ถ้ามีปุ่มให้กดข้าม จะได้บิลจากรูปเดิมซ้ำอีกใบโดยไม่มีใครรู้
     */
    it('PHOTO_REUSED → ห้ามมีปุ่มยืนยันให้กดข้าม', () => {
      const blocked = blockWith({ message: 'รูปนี้ถูกใช้ออกบิลไปแล้ว', code: 'PHOTO_REUSED' });

      expect(blocked.status).toBe('save_failed');
      expect(component.pendingConfirm(blocked)).toBeNull();
    });

    /**
     * มีรหัสติดมาแล้วต้องตัดสินจากรหัสอย่างเดียว ห้ามถอยไปหาคำในข้อความต่อ
     * ไม่งั้นคำว่า "หลัก" ที่บังเอิญอยู่ในข้อความของด่านอื่นจะไปเปิดปุ่มข้ามให้
     */
    it('รหัสที่ไม่มีปุ่ม + ข้อความมีคำของด่านอื่น → ยังต้องไม่มีปุ่ม', () => {
      const blocked = blockWith({
        message: 'บ้านหลังนี้มีบิลของรอบถัดไปแล้ว (อ่านได้ 5 หลัก)',
        code: 'LATER_BILL_EXISTS'
      });

      expect(component.pendingConfirm(blocked)).toBeNull();
    });

    /** ด่านมิเตอร์เดินถอยหลังเป็น 400 ไม่ใช่ 409 — การเลือกปุ่มต้องไม่ผูกกับ status */
    it('รหัสที่มาพร้อม 400 ก็ต้องอ่านได้เหมือนกัน', () => {
      const blocked = blockWith(
        { message: 'เดือนนี้ใช้น้ำสูงผิดปกติ', code: 'HIGH_USAGE' },
        400
      );

      expect(component.pendingConfirm(blocked)?.flag).toBe('confirmHighUsage');
    });

    it('กดยืนยันไปแล้วแต่ยังติดด่านเดิม → ปุ่มต้องไม่ค้างให้กดวนอีก', () => {
      component.rows = [row({ confirmLowConfidence: true })] as any;
      runToScan().flush(
        { message: 'ระบบอ่านเลขมิเตอร์ได้ไม่ชัดเจน', code: 'LOW_CONFIDENCE' },
        { status: 409, statusText: 'Conflict' }
      );

      expect(component.pendingConfirm(component.rows[0] as any)).toBeNull();
    });

    it('ครอปอ่านใหม่แล้วได้เลขใหม่ → คำยืนยันของเลขเก่าต้องหลุดไปทั้งหมด', () => {
      component.rows = [row({
        confirmLowConfidence: true,
        confirmDuplicateLocation: true,
        confirmStalePhoto: true
      })] as any;

      component.openCrop(component.rows[0] as any);
      component.onCropped({ blob: new Blob(['กรอบ'], { type: 'image/jpeg' }) });
      component.rereadCropped();
      http.expectOne(r => r.url.endsWith('/bills/scan-batch')).flush({
        results: [{
          index: 0,
          reading: { success: true, meter_unit: 1258, confidence: 0.99, meter_digits: 4 },
          photo_taken: {},
          confidence: 'high',
          suggestion: { members_id: 1 },
          candidates: []
        }]
      });

      expect(component.rows[0].unit).toBe(1258);
      expect(component.rows[0].confirmLowConfidence).toBe(false);
      expect(component.rows[0].confirmDuplicateLocation).toBe(false);
      expect(component.rows[0].confirmStalePhoto).toBe(false);
    });
  });
});
