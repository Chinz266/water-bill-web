import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { BatchScanComponent } from './batch-scan';

/**
 * ครอปเฉพาะช่องตัวเลขแล้วอ่านใหม่ทีละรูป
 *
 * โหมดกองส่งรูปเต็มใบไปให้ AI หาหน้าปัดเอง จึงอ่านพลาดง่ายกว่าโหมดทีละหลัง
 * ทางแก้คือครอปเฉพาะใบที่มีปัญหาแล้วส่งกลับไปอ่านใหม่ จุดที่พังแล้วเจ็บมี 2 อย่าง:
 *   1. อ่านใหม่แล้วบ้านยังผูกกับเลขตัวเก่า → เลขถูกแต่บิลไปออกผิดบ้าน
 *   2. รูปครอปไม่มี EXIF → วันถ่าย/พิกัดที่ได้มาตอนแรกถูกล้างทิ้งเงียบ ๆ
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
  memberId: null,
  matchedBy: 'none',
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
  croppedRead: false,
  ocrUnit: null,
  meterDigits: null,
  ocrConfidence: null,
  status: 'pending',
  error: null,
  errorCode: null,
  billId: null,
  ...over
});

/** ผลอ่าน 1 ใบตามรูปแบบที่ ScanBatchService คืนมา */
const result = (over: any = {}) => ({
  index: 0,
  filename: 'meter-1.jpg',
  reading: { success: true, meter_unit: 1250, confidence: 0.96 },
  photo_taken: { captured_at: null, latitude: null, longitude: null },
  confidence: 'high',
  reason: 'บ้าน 99/2 ใช้ไป 28 หน่วย',
  warnings: [],
  suggestion: { members_id: 2, house_no: '99/2' },
  candidates: [{ members_id: 2, house_no: '99/2', name: 'สมชาย ใจดี', usage_unit: 28 }],
  ...over
});

describe('BatchScanComponent — ครอปแล้วอ่านใหม่', () => {
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

  /** เปิดกล่องครอปของแถวแรกแล้วสมมติว่าคนลากกรอบเสร็จแล้ว */
  const cropAndReread = (target = component.rows[0]) => {
    component.openCrop(target as any);
    component.onCropped({ blob: new Blob(['กรอบที่ครอป'], { type: 'image/jpeg' }) });
    component.rereadCropped();
    return http.expectOne(r => r.url.endsWith('/bills/scan-batch'));
  };

  it('ส่งกรอบที่ครอปไปใบเดียว พร้อมรอบบิลและหมู่บ้านเดิม', () => {
    component.rows = [row({ seq: 1, unit: 125, confidence: 40, status: 'ready' })] as any;

    const req = cropAndReread();
    const body = req.request.body as FormData;
    expect(body.getAll('files').length).toBe(1);
    expect(body.get('billing_month')).toBe(component.selectedBilling.month);
    expect(body.get('villages_id')).toBe('7');

    req.flush({ results: [result()] });
    expect(component.rows[0].unit).toBe(1250);
    expect(component.rows[0].croppedRead).toBe(true);
    expect(component.cropRow).toBeNull();
  });

  it('อ่านใหม่แล้วต้องจับคู่บ้านใหม่ตามเลขที่ได้ ไม่ค้างอยู่กับบ้านของเลขตัวเก่า', () => {
    component.rows = [
      row({ seq: 1, unit: 125, memberId: 1, matchedBy: 'system', status: 'ready' })
    ] as any;

    cropAndReread().flush({ results: [result()] });

    expect(component.rows[0].memberId).toBe(2);
    expect(component.rows[0].matchedBy).toBe('system');
  });

  it('คนเลือกบ้านเองไว้แล้ว การอ่านใหม่ต้องไม่ไปทับ', () => {
    component.rows = [row({ seq: 1, memberId: 1, matchedBy: 'manual', status: 'read_failed' })] as any;

    cropAndReread().flush({ results: [result()] });

    expect(component.rows[0].memberId).toBe(1);
    expect(component.rows[0].unit).toBe(1250);
  });

  it('รูปครอปไม่มี EXIF → วันถ่ายกับพิกัดที่ได้มาตอนอ่านรูปเต็มใบต้องอยู่ครบ', () => {
    const takenAt = new Date(2026, 6, 20);
    component.rows = [
      row({ seq: 1, unit: 125, capturedAt: takenAt, latitude: 13.75, longitude: 100.5, status: 'ready' })
    ] as any;

    cropAndReread().flush({ results: [result()] });

    expect(component.rows[0].capturedAt).toEqual(takenAt);
    expect(component.rows[0].latitude).toBe(13.75);
    expect(component.rows[0].longitude).toBe(100.5);
  });

  it('หลังบ้านส่งพิกัดเป็น null → ต้องไม่กลายเป็น 0,0 (กลางมหาสมุทร)', () => {
    component.rows = [row({ seq: 1 })] as any;
    component.analyze();

    http.expectOne(r => r.url.endsWith('/bills/scan-batch')).flush({
      results: [result({ photo_taken: { captured_at: null, latitude: null, longitude: null } })]
    });

    expect(component.rows[0].latitude).toBeNull();
    expect(component.rows[0].longitude).toBeNull();
  });

  it('อ่านใหม่แล้วยังไม่ออก → ผลเดิมต้องอยู่ครบ และเปิดกล่องค้างไว้ให้ลากกรอบใหม่', () => {
    component.rows = [
      row({ seq: 1, unit: 125, memberId: 2, matchedBy: 'system', candidates: [{ members_id: 2 }], status: 'ready' })
    ] as any;

    cropAndReread().flush({
      results: [result({ reading: { success: false, meter_unit: null, confidence: 0 }, suggestion: null, candidates: [] })]
    });

    expect(component.rows[0].unit).toBe(125);
    expect(component.rows[0].memberId).toBe(2);
    expect(component.rows[0].candidates.length).toBe(1);
    expect(component.cropRow).not.toBeNull();
    expect(component.isRereading).toBe(false);
  });

  it('เลขเปลี่ยนแล้ว คำยืนยันหน่วยสูงผิดปกติของเลขตัวเก่าต้องไม่ติดไปด้วย', () => {
    component.rows = [
      row({ seq: 1, unit: 9125, confirmHighUsage: true, status: 'ready' })
    ] as any;

    cropAndReread().flush({ results: [result()] });

    expect(component.rows[0].unit).toBe(1250);
    expect(component.rows[0].confirmHighUsage).toBe(false);
  });

  it('ยิงไม่ผ่าน → แถวไม่เปลี่ยน และกดใหม่ได้ทันที', () => {
    component.rows = [row({ seq: 1, unit: 125, status: 'ready' })] as any;

    cropAndReread().flush({ message: 'ล่ม' }, { status: 500, statusText: 'Server Error' });

    expect(component.rows[0].unit).toBe(125);
    expect(component.isRereading).toBe(false);
    expect(component.isBusy).toBe(false);
  });

  it('แถวที่กู้มาจากคิวเก่า (ไม่มีรูป) ครอปไม่ได้', () => {
    component.rows = [row({ seq: 1, file: null, unit: 125, status: 'ready' })] as any;

    component.openCrop(component.rows[0]);

    expect(component.cropRow).toBeNull();
    expect(component.shouldReread(component.rows[0])).toBe(false);
  });

  it('ชวนให้ครอปใหม่เฉพาะใบที่อ่านไม่ออกหรืออ่านมาไม่มั่นใจ', () => {
    expect(component.shouldReread(row({ status: 'read_failed' }) as any)).toBe(true);
    expect(component.shouldReread(row({ status: 'ready', confidence: 60 }) as any)).toBe(true);
    expect(component.shouldReread(row({ status: 'ready', confidence: 96 }) as any)).toBe(false);
    expect(component.shouldReread(row({ status: 'saved', confidence: 10 }) as any)).toBe(false);
  });
});
