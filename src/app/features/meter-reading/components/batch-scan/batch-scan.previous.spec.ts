import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { BatchScanComponent } from './batch-scan';

/**
 * เทียบกับเลขเดือนที่แล้ว — ด่านที่ทำงานแทน GPS ตอนมิเตอร์ติดกันเป็นแถว
 *
 * มิเตอร์ทาวน์โฮมห่างกัน 30 ซม. ส่วน GPS มือถือเพี้ยน 5–20 ม. จะแยกบ้านด้วยพิกัดไม่ได้เลย
 * แต่เลขสะสมของแต่ละหลังต่างกันมาก — "เลขที่กรอกเทียบกับเลขเดือนที่แล้วของหลังที่เลือก"
 * จึงเป็นตัวจับว่าเจ้าหน้าที่ไปอ่านหน้าปัดของหลังข้าง ๆ มาหรือเปล่า
 *
 * ⚠️ ตัวเลขต้องคิดจากเลขที่กรอกอยู่ตอนนี้เสมอ ไม่ใช่ usage_unit ที่หลังบ้านคิดไว้ตอนจับคู่
 *    (ค่านั้นค้างอยู่ที่เลขที่ AI อ่านมาตอนแรก คนแก้เลขแล้วมันไม่ขยับตาม)
 */

const candidate = (over: any = {}) => ({
  members_id: 1,
  house_no: '99/1',
  name: 'สมชาย ใจดี',
  previous_unit: 1200,
  usage_unit: 50,
  average_usage: 20,
  already_billed: false,
  score: 1,
  distance_m: 1,
  ...over
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
  photoData: 'data:image/jpeg;base64,xxx',
  memberId: 1,
  matchedBy: 'system',
  matchedByCoords: false,
  matchConfidence: 'high',
  matchReason: null,
  candidates: [candidate()],
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

describe('BatchScanComponent — เทียบเลขกับเดือนที่แล้ว', () => {
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

  const setup = (over: any = {}) => {
    component.rows = [row(over)] as any;
    return component.rows[0];
  };

  it('โชว์เลขเดือนที่แล้วของบ้านที่เลือก พร้อมหน่วยที่คิดจากเลขที่กรอกอยู่', () => {
    const target = setup({ unit: 1250 });

    expect(component.previousUnit(target)).toBe(1200);
    expect(component.liveUsage(target)).toBe(50);
  });

  it('คนแก้เลขในช่อง → หน่วยขยับตามทันที ไม่ค้างที่ค่าที่หลังบ้านคิดไว้ตอนจับคู่', () => {
    const target = setup({ unit: 1250 });
    target.unit = 1230;

    // usage_unit ที่หลังบ้านส่งมายังเป็น 50 อยู่ แต่ของจริงตอนนี้คือ 30
    expect(target.candidates[0].usage_unit).toBe(50);
    expect(component.liveUsage(target)).toBe(30);
  });

  it('เลขน้อยกว่าเดือนที่แล้ว → ขึ้นแดงและบล็อกไว้เลย (มักคืออ่านหน้าปัดหลังข้าง ๆ มา)', () => {
    const target = setup({ unit: 1180 });

    expect(component.unitCheck(target)).toEqual({
      level: 'error',
      message: expect.stringContaining('น้อยกว่าเลขเดือนที่แล้ว')
    });
    expect(component.blockingIssue(target)).toContain('น้อยกว่าเลขเดือนที่แล้ว');
    expect(component.autoSavable(target)).toBe(false);
  });

  it('หน่วยพุ่งเกิน 1.5 เท่าของค่าเฉลี่ย → เตือนเหลือง แต่ยังบันทึกได้', () => {
    // เฉลี่ย 20 · รอบนี้ 40 หน่วย = 2 เท่า และต่างกัน 20 หน่วย
    const target = setup({ unit: 1240 });

    expect(component.unitCheck(target)?.level).toBe('warn');
    expect(component.blockingIssue(target)).toBeNull();
  });

  it('บ้านที่ใช้น้ำน้อยมาก ขยับนิดเดียวต้องไม่เตือน — ไม่งั้นคนเลิกอ่านคำเตือน', () => {
    // เฉลี่ย 4 · รอบนี้ 8 หน่วย = 2 เท่าก็จริง แต่ต่างกันแค่ 4 หน่วย
    const target = setup({
      unit: 1208,
      candidates: [candidate({ average_usage: 4 })]
    });

    expect(component.unitCheck(target)).toBeNull();
  });

  it('เกิน 3 เท่าปล่อยให้ abnormalUsage เตือนแทน จะได้ไม่ขึ้นสองข้อความซ้อนกัน', () => {
    // เฉลี่ย 20 · รอบนี้ 100 หน่วย
    const target = setup({ unit: 1300 });

    expect(component.unitCheck(target)).toBeNull();
    expect(component.abnormalUsage(target)).toEqual({ usage: 100, average: 20 });
    expect(component.autoSavable(target)).toBe(false);
  });

  it('หน่วยที่ด่านหน่วยพุ่งใช้ ต้องคิดจากเลขที่กรอกจริง ไม่ใช่ค่าที่ค้างจากตอนจับคู่', () => {
    // หลังบ้านคิดไว้ 50 หน่วย (ปกติ) แต่คนแก้เลขจนกลายเป็น 120 หน่วย
    const target = setup({ unit: 1320 });

    expect(component.abnormalUsage(target)?.usage).toBe(120);
  });

  it('เปลี่ยนมิเตอร์ใหม่: ยืนยันไม่ได้จนกว่าจะกรอกเลขปิดของตัวเก่าที่ไม่ต่ำกว่าเลขตั้งต้น', () => {
    const target = setup({ unit: 30 }); // มิเตอร์ตัวใหม่เริ่มนับจาก 0

    expect(component.meterResetPending(target)).toBe(true);
    expect(component.meterResetReady(target)).toBe(false);

    // เลขปิดต่ำกว่าเลขตั้งต้น = กรอกมั่ว/หยิบเลขผิดตัว หน่วยจะยังติดลบต่อไป
    target.oldMeterFinalUnit = 1100;
    expect(component.meterResetReady(target)).toBe(false);
    component.confirmMeterReset(target);
    expect(target.confirmMeterReset).toBe(false);

    target.oldMeterFinalUnit = 1240;
    expect(component.meterResetReady(target)).toBe(true);
  });

  it('ยืนยันเปลี่ยนมิเตอร์แล้ว → บันทึกได้ แต่ระบบต้องไม่ออกบิลให้เอง', () => {
    const target = setup({ unit: 30 });
    target.oldMeterFinalUnit = 1240;
    component.confirmMeterReset(target);

    expect(target.confirmMeterReset).toBe(true);
    expect(component.blockingIssue(target)).toBeNull();
    expect(component.meterResetPending(target)).toBe(false);
    // ยอดรอบนี้คิดจากเลขสองตัวคนละก้อน ผิดแล้วมองไม่ออกจากยอดบนบิล ต้องผ่านตาคนเสมอ
    expect(component.autoSavable(target)).toBe(false);
    expect(component.notes(target).some(n => n.includes('เปลี่ยนมิเตอร์ใหม่'))).toBe(true);
  });

  it('ยังไม่เลือกบ้าน หรือหลังบ้านไม่ได้ส่งเลขตั้งต้นมา → ไม่มีอะไรให้เทียบ ต้องไม่เดา', () => {
    expect(component.unitCheck(setup({ memberId: null }))).toBeNull();
    expect(component.previousUnit(setup({ candidates: [candidate({ previous_unit: null })] }))).toBeNull();
    expect(component.unitCheck(setup({ candidates: [candidate({ previous_unit: null })] }))).toBeNull();
  });
});
