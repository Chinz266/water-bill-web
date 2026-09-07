import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { BatchScanComponent } from './batch-scan';

/**
 * แถวที่กู้คิวกลับมาแล้วไม่มีรูปเหลือ — จุดที่หน้าจอเคยพูดขัดกันเอง
 *
 * คิวที่เก็บลงเครื่องไม่ได้เก็บตัวรูปไว้ (ก้อนใหญ่เกินโควตา localStorage) แถวที่กู้มา
 * จึงไม่มีอะไรให้คนเทียบหน้าปัดอีกเลย สิ่งที่ห้ามเกิดคือ:
 *   - โชว์เปอร์เซ็นต์ที่ AI เคยอ่านได้ ทั้งที่รูปที่อ่านมานั้นหายไปแล้ว
 *   - ชวนให้ "เทียบรูปแล้วเลือกหลังที่ถ่ายจริง" ทั้งที่ไม่มีรูปให้เทียบ
 * และสิ่งที่ต้องมีแทนคือทางแนบรูปใหม่ กับเลขเดือนที่แล้วของแต่ละหลังไว้ตัดสินว่าบ้านไหน
 */

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
  clientUuid: 'uuid-1',
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

/** แถวแบบที่กู้มาจากคิวเก่า: ไม่มีทั้งไฟล์และรูปย่อ และเลขในช่องคือเลขที่กรอกเอง */
const recovered = (over: any = {}) =>
  row({
    file: null,
    previewUrl: null,
    photoData: null,
    ocrUnit: null,
    ocrConfidence: null,
    meterDigits: null,
    ...over
  });

describe('BatchScanComponent — แถวที่กู้มาแล้วไม่มีรูป', () => {
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

  const setup = (over: any = {}, houses: any[] = []) => {
    component.members = houses;
    component.rows = [over] as any;
    component.refreshAllNearby();
    return component.rows[0];
  };

  it('ไม่มีรูปแล้ว → ห้ามโชว์เปอร์เซ็นต์ที่ AI เคยอ่านได้ ทั้งป้ายและบรรทัดหมายเหตุ', () => {
    const target = setup(recovered({ confidence: 95 }));

    expect(component.hasPhoto(target)).toBe(false);
    expect(component.showConfidence(target)).toBe(false);
    expect(component.notes(target).join(' ')).not.toContain('%');
  });

  it('ยังมีรูปอยู่ → ป้ายเปอร์เซ็นต์ทำงานเหมือนเดิม', () => {
    const target = setup(row({ confidence: 87 }));

    expect(component.showConfidence(target)).toBe(true);
  });

  it('AI อ่านได้ต่ำกว่า 50% และเลขยังเป็นของ AI → บล็อกไว้ (ด่าน 80%)', () => {
    const target = setup(row({ confidence: 40 }));

    expect(component.lowConfidenceWarning(target)).toBe(true);
    expect(component.blockingIssue(target)).toContain('80%');
    expect(component.savableRows.length).toBe(0);
  });

  it('AI อ่านได้ต่ำกว่า 50% แต่คนพิมพ์เลขเองทับแล้ว → ออกบิลได้ตามเดิม', () => {
    const target = setup(row({ confidence: 40, unit: 1258 }));

    expect(component.lowConfidenceWarning(target)).toBe(true);
    // เลขในช่องมาจากตาคน ไม่ใช่คะแนนของโมเดล — ด่านความชัดจึงไม่เกี่ยวแล้ว
    expect(component.blockingIssue(target)).toBeNull();
    expect(component.savableRows.length).toBe(1);
  });

  it('เลขกรอกเองแล้วไม่มีรูป → บล็อกไว้จนกว่าจะแนบรูปใหม่ และต้องมีปุ่มให้ถ่ายใหม่', () => {
    const target = setup(recovered());

    expect(component.needsRetake(target)).toBe(true);
    expect(component.blockingIssue(target)).toContain('กรุณาถ่ายใหม่');
    expect(component.savableRows.length).toBe(0);
  });

  it('แนบรูปใหม่ → ด่านหลุด ปุ่มถ่ายใหม่หายไป และเลขที่กรอกไว้ต้องไม่ถูกล้าง', async () => {
    const target = setup(recovered({ unit: 1250 }));
    // jsdom ย่อรูปจริงไม่ได้ — แทนที่ตัวห่อไว้เหมือนที่เทสต์ชุดอื่นทำ
    (component as any).photoDataUrl = () => Promise.resolve('data:image/jpeg;base64,ใหม่');

    const file = new File(['รูปใหม่'], 'meter-retake.jpg', { type: 'image/jpeg' });
    await component.onRetakePicked({ target: { files: [file], value: '' } } as any, target);

    expect(component.hasPhoto(target)).toBe(true);
    expect(target.unit).toBe(1250);
    expect(component.needsRetake(target)).toBe(false);
    expect(component.blockingIssue(target)).toBeNull();
  });

  it('ไฟล์ที่เลือกไม่ใช่รูป → ไม่แตะแถวเลย', async () => {
    const target = setup(recovered());
    const file = new File(['ข้อความ'], 'note.txt', { type: 'text/plain' });

    await component.onRetakePicked({ target: { files: [file], value: '' } } as any, target);

    expect(target.file).toBeNull();
    expect(component.needsRetake(target)).toBe(true);
  });

  it('ไม่มีรูปให้เทียบ → ยกเลขเดือนที่แล้วของบ้านใกล้เคียงมาโชว์ที่ปุ่มเลือกบ้าน', () => {
    const target = setup(recovered({ memberId: null, matchedBy: 'none' }), [
      house(1, '206/1', 13.75001),
      house(2, '206/2', 13.75002)
    ]);

    const billing = component.selectedBilling;
    for (const id of [1, 2]) {
      // service ต่อ query เข้าไปในสตริง url เอง จึงเทียบด้วย includes ไม่ใช่ endsWith
      const request = http.expectOne(
        r => r.url.includes(`/bills/member/${id}/previous`) && r.url.includes(`month=${billing.month}`)
      );
      request.flush({ previous_unit: id === 1 ? 30 : 50, source: 'bill', bill: null });
    }

    expect(target.nearby.map((near: any) => [near.member.house_no, near.previousUnit])).toEqual([
      ['206/1', 30],
      ['206/2', 50]
    ]);
  });

  it('ยังมีรูปอยู่ → ไม่ต้องยิงถามเลขเดือนที่แล้วของทุกหลัง (รูปเทียบได้อยู่แล้ว)', () => {
    setup(row({ memberId: null, matchedBy: 'none' }), [house(1, '206/1', 13.75001), house(2, '206/2', 13.75002)]);

    http.expectNone(r => r.url.includes('/previous'));
  });

  it('หลังบ้านไม่มีเลขเดือนที่แล้วให้ → ต้องเป็น null ไม่ใช่ 0 (บ้านที่เพิ่งลงทะเบียนมี 0 จริงได้)', () => {
    const target = setup(recovered({ memberId: null, matchedBy: 'none' }), [house(1, '206/1', 13.75001)]);

    http.expectOne(r => r.url.includes('/bills/member/1/previous')).flush({ previous_unit: null, source: null });

    expect(target.nearby[0].previousUnit).toBeNull();
  });
});
