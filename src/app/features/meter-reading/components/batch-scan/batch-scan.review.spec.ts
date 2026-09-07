import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { BatchScanComponent } from './batch-scan';

/**
 * ทางเลือกที่สามของใบที่ติดด่าน — ฝากไว้ให้ผู้ดูแลตรวจ
 *
 * ═══ ทำไมต้องมี ═══
 *
 * ใบที่หลังบ้านตีกลับ (หน่วยพุ่ง / เลขต่ำกว่าเดือนก่อน / จดสลับตัวในกลุ่มมิเตอร์)
 * เคยมีทางออกแค่สองทาง: กดยืนยันข้ามด่านเอง หรือปล่อยค้างไว้ทั้งอย่างนั้น
 * คนที่ยืนกลางแดดกับมิเตอร์อีกหลายสิบตัวจะเลือกทางแรกเกือบทุกครั้ง
 * แล้วด่านทั้งหมดก็กลายเป็นพิธีกรรมที่ไม่ได้กันอะไรเลย
 *
 * เทสต์ชุดนี้ล็อกว่า: ปุ่มขึ้นเฉพาะใบที่ติดด่านจริง · บ้านกับเหตุผลเดินทางไปถึงคนตรวจ ·
 * และแถวต้องออกจากกองหลังส่งสำเร็จ (ค้างไว้ = มีทางกดออกบิลซ้ำอีกทาง)
 */

const house = (id: number, houseNo: string) => ({
  id,
  house_no: houseNo,
  fname: 'สมชาย',
  lname: 'ใจดี'
});

const row = (over: any = {}) => ({
  seq: over.seq ?? 1,
  file: new File(['รูปจำลอง'], 'meter-1.jpg', { type: 'image/jpeg' }),
  fileKey: 'meter-1.jpg|1|1',
  fileName: 'meter-1.jpg',
  previewUrl: null,
  brokenImage: false,
  capturedAt: new Date('2026-08-14T10:23:45'),
  latitude: 14.9799,
  longitude: 102.0977,
  photoData: 'data:image/jpeg;base64,xxx',
  memberId: 2,
  matchedBy: 'system',
  matchConfidence: 'high',
  matchReason: null,
  candidates: [],
  nearby: [],
  warnings: [],
  unit: 1670,
  confidence: 93,
  confirmHighUsage: false,
  confirmDigitChange: false,
  confirmLowConfidence: false,
  confirmDuplicateLocation: false,
  confirmMeterReset: false,
  oldMeterFinalUnit: null,
  confirmStalePhoto: false,
  croppedRead: false,
  ocrUnit: 1670,
  meterDigits: 4,
  ocrConfidence: 0.93,
  status: 'error',
  error: 'หน่วยน้ำที่คำนวณได้ (420 หน่วย) สูงกว่าที่บ้านหลังนี้ใช้ตามปกติมาก',
  errorCode: 'HIGH_USAGE',
  billId: null,
  ...over
});

describe('BatchScanComponent — ส่งให้ผู้ดูแลตรวจ', () => {
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
    component.villagesId = 7;
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('ขึ้นปุ่มเฉพาะใบที่หลังบ้านตีกลับ — ใบที่ยังไม่ได้ยิงต้องไม่มี', () => {
    // ปุ่มที่ขึ้นทุกใบจะกลายเป็นทางลัดโยนทั้งกองไปให้คนอื่น ทั้งที่ส่วนใหญ่กดออกบิลได้เลย
    expect(component.canSendToReview(row() as any)).toBe(true);
    expect(component.canSendToReview(row({ status: 'ready', error: null, errorCode: null }) as any)).toBe(false);
    expect(component.canSendToReview(row({ status: 'saved' }) as any)).toBe(false);
  });

  it('แถวที่กู้มาจากคิวเก่า (ไม่มีรูปย่อแล้ว) ส่งเข้าคิวไม่ได้ — คิวรับเฉพาะใบที่มีรูป', () => {
    expect(component.canSendToReview(row({ photoData: null, file: null }) as any)).toBe(false);
  });

  it('ส่งบ้านที่เลือกไว้ เหตุผลที่ถูกตีกลับ และเลขที่อ่านได้ ไปพร้อมรูป', () => {
    component.rows = [row()] as any;

    component.sendToReview(component.rows[0]);
    const req = http.expectOne(r => r.url.endsWith('/readings/unassigned'));

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({
      members_id: 2,
      blocked_code: 'HIGH_USAGE',
      blocked_reason: 'หน่วยน้ำที่คำนวณได้ (420 หน่วย) สูงกว่าที่บ้านหลังนี้ใช้ตามปกติมาก',
      meter_unit: 1670,
      meter_digits: 4,
      read_confidence: 0.93,
      villages_id: 7,
      meter_photo: 'data:image/jpeg;base64,xxx'
    });

    req.flush({ id: 55 });
  });

  it('ส่งสำเร็จแล้วแถวต้องหายไปจากกอง — ค้างไว้จะมีทางกดออกบิลซ้ำอีกทาง', () => {
    component.rows = [row({ seq: 1 }), row({ seq: 2, errorCode: null, error: null, status: 'ready' })] as any;

    component.sendToReview(component.rows[0]);
    http.expectOne(r => r.url.endsWith('/readings/unassigned')).flush({ id: 55 });

    expect(component.rows.map(r => r.seq)).toEqual([2]);
  });

  it('ส่งไม่สำเร็จ → แถวต้องอยู่ที่เดิม ให้ลองใหม่ได้', () => {
    component.rows = [row()] as any;

    component.sendToReview(component.rows[0]);
    http
      .expectOne(r => r.url.endsWith('/readings/unassigned'))
      .flush({ message: 'เน็ตหลุด' }, { status: 500, statusText: 'Server Error' });

    expect(component.rows).toHaveLength(1);
    expect(component.sendingReview).toBeNull();
  });

  it('กดซ้ำระหว่างที่ยังส่งไม่เสร็จ ต้องไม่ยิงซ้ำ — ไม่งั้นได้ของค้างในคิวสองใบ', () => {
    component.rows = [row()] as any;

    component.sendToReview(component.rows[0]);
    component.sendToReview(component.rows[0]);

    http.expectOne(r => r.url.endsWith('/readings/unassigned')).flush({ id: 55 });
  });
});
