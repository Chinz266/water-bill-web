import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { UnassignedQueueComponent } from './unassigned-queue';

/**
 * ใบที่เข้าคิวเพราะ "ด่านตีกลับ" — ต่างจากใบกำพร้าตรงที่รู้บ้านแล้ว
 *
 * คนตรวจต้องเห็นสองอย่างก่อนตัดสิน: **ติดอะไร** กับ **คนหน้างานเลือกบ้านไหนไว้**
 * ขาดอย่างใดอย่างหนึ่งแล้วหน้านี้จะกลายเป็นปุ่มอนุมัติที่ไม่มีใครรู้ว่ากำลังอนุมัติอะไร
 */

const reviewRow = (over: any = {}) => ({
  id: 55,
  villages_id: 1,
  members_id: 7,
  blocked_code: 'HIGH_USAGE',
  blocked_reason: 'หน่วยน้ำที่คำนวณได้ (420 หน่วย) สูงกว่าที่บ้านหลังนี้ใช้ตามปกติมาก',
  meter_unit: 1670,
  meter_digits: 4,
  read_confidence: 0.93,
  evidence_photo: 'uploads/meters/x.jpg',
  latitude: null,
  longitude: null,
  gps_accuracy_m: null,
  captured_at: null,
  status: 'Pending',
  note: null,
  create_date: '2026-08-14T10:00:00',
  ...over
});

const suggested = {
  members_id: 7,
  house_no: '206/2',
  name: 'สมชาย ใจดี',
  previous_unit: 1250,
  usage_unit: 420,
  cluster_group_id: 'WALL-206',
  sequence_index: 2
};

describe('UnassignedQueueComponent — ใบที่รอการตรวจสอบ', () => {
  let component: UnassignedQueueComponent;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UnassignedQueueComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();

    const fixture = TestBed.createComponent(UnassignedQueueComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    http.expectOne(r => r.url.includes('/readings/unassigned')).flush([reviewRow()]);
  });

  afterEach(() => http.verify());

  it('ป้ายบนรายการบอกว่าระบบระงับไว้ด้วยเรื่องอะไร — คนตรวจจะได้รู้ว่าต้องใช้เวลาแบบไหนก่อนเปิด', () => {
    expect(component.blockedLabel('HIGH_USAGE')).toBe('ปริมาณการใช้น้ำสูงผิดปกติ');
    expect(component.blockedLabel('CLUSTER_SEQUENCE_MISMATCH')).toBe('อาจบันทึกสลับตัวในกลุ่มมิเตอร์');
    // รหัสที่ยังไม่รู้จักต้องไม่หายไปเงียบ ๆ — ยังต้องบอกว่าใบนี้ถูกระงับอยู่
    expect(component.blockedLabel('SOMETHING_NEW')).toBe('ระบบระงับไว้ กรุณาเปิดดูรายละเอียด');
    // ใบกำพร้าไม่มีป้ายอะไรเลย
    expect(component.blockedLabel(null)).toBeNull();
  });

  /**
   * รหัสพวกนี้หลังบ้านตีกลับจริงแต่ป้ายเคยตกหล่น คนตรวจเลยเห็นข้อความกลาง ๆ
   * ทั้งที่ระบบรู้สาเหตุอยู่แล้ว — ล็อกไว้กันหล่นอีกรอบตอนเพิ่มรหัสใหม่
   */
  it('รหัสที่หลังบ้านตีกลับต้องมีป้ายของตัวเองครบทุกตัว', () => {
    const codes = [
      'BILL_EXISTS',
      'BILL_PAID',
      'LATER_BILL_EXISTS',
      'FUTURE_TIMESTAMP',
      'BURST_PHOTO',
      'PHOTO_REUSED',
      'MANUAL_PHOTO_REQUIRED',
      'STALE_PHOTO',
      'DIGIT_CHANGE',
      'LOW_CONFIDENCE',
      'METER_ROLLBACK',
    ];

    for (const code of codes) {
      expect(component.blockedLabel(code)).not.toBe('ระบบระงับไว้ กรุณาเปิดดูรายละเอียด');
      expect(component.blockedLabel(code)).toBeTruthy();
    }
  });

  it('เปิดใบที่ติดด่าน → ได้บ้านที่คนหน้างานเลือกไว้ พร้อมตำแหน่งในกลุ่มมิเตอร์', () => {
    component.open(component.rows()[0]);
    http
      .expectOne(r => r.url.includes('/readings/unassigned/55'))
      .flush({ ...reviewRow(), candidates: [], suggested });

    expect(component.suggested()).toMatchObject({
      house_no: '206/2',
      previous_unit: 1250,
      usage_unit: 420,
      cluster_group_id: 'WALL-206'
    });
  });

  it('ไม่ติ๊กบ้านให้เอง — หนึ่งในเหตุผลที่ใบนี้มาอยู่ตรงนี้คือ "อาจจดสลับบ้าน"', () => {
    component.open(component.rows()[0]);
    http
      .expectOne(r => r.url.includes('/readings/unassigned/55'))
      .flush({ ...reviewRow(), candidates: [], suggested });

    expect(component.selectedMemberId).toBeNull();
    expect(component.canAssign()).toBe(false);

    // กดปุ่ม "ใช้บ้านหลังนี้" เองแล้วจึงออกบิลได้
    component.useSuggested();
    expect(component.selectedMemberId).toBe(7);
    expect(component.canAssign()).toBe(true);
  });

  it('ใบกำพร้าแท้ ๆ ไม่มีบ้านที่เสนอไว้ — ต้องเลือกจาก candidates ตามเดิม', () => {
    component.open(component.rows()[0]);
    http
      .expectOne(r => r.url.includes('/readings/unassigned/55'))
      .flush({ ...reviewRow({ members_id: null, blocked_code: null }), candidates: [], suggested: null });

    expect(component.suggested()).toBeNull();
    component.useSuggested();
    expect(component.selectedMemberId).toBeNull();
  });
});
