import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { MemberListComponent } from './member-list';

/**
 * แก้เลขมิเตอร์ตั้งต้นจากหน้าทะเบียนลูกบ้าน
 *
 * ═══ สิ่งที่เทสต์ชุดนี้ล็อกไว้ ═══
 *
 * เลขตั้งต้นคือ "การจดครั้งแรก" ซึ่งหลังบ้านชี้ด้วย id น้อยที่สุด ไม่ใช่ตัวแรกในลิสต์
 * ที่ส่งมา (หลังบ้านเรียงใหม่สุดขึ้นก่อน) หยิบผิดตัวเมื่อไหร่คือไปแก้การจดรอบอื่นแทน
 *
 * และห้ามยิงคำขอเมื่อยังไม่ได้กรอกเหตุผล — หลังบ้านตีกลับอยู่แล้ว แต่ปล่อยให้ยิงไปก่อน
 * แล้วค่อยเด้งกลับ คนจะเห็นเป็น error ทั้งที่ยังกรอกไม่ครบ
 */
describe('MemberListComponent — เลขมิเตอร์ตั้งต้น', () => {
  let component: MemberListComponent;
  let http: HttpTestingController;

  const flushInitialLoads = () => {
    http.expectOne(r => r.url.endsWith('/member/all')).flush([]);
    const villages = http.match(r => r.url.includes('/villages'));
    villages.forEach(r => r.flush([]));
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MemberListComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    }).compileComponents();

    const fixture = TestBed.createComponent(MemberListComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    flushInitialLoads();
  });

  afterEach(() => localStorage.clear());

  /** เปิดหน้าต่างแก้ไขแล้วตอบประวัติการจดกลับไป */
  const openWith = (readings: any[]) => {
    component.openEditModal({ id: 12, house_no: '99/1', fname: 'สมชาย', lname: 'ใจดี' });
    http.expectOne(r => r.url.endsWith('/meter-readings/member/12')).flush(readings);
  };

  it('เลขตั้งต้นคือการจดที่ id น้อยที่สุด ไม่ใช่ตัวแรกในลิสต์ที่หลังบ้านส่งมา', () => {
    // หลังบ้านเรียงใหม่สุดขึ้นก่อน — ตัวแรกในลิสต์คือการจดล่าสุด ไม่ใช่เลขตั้งต้น
    openWith([
      { id: 508, meter_unit: 1390 },
      { id: 505, meter_unit: 1320 },
      { id: 501, meter_unit: 1250 }
    ]);

    expect(component.initialReading).toEqual({ id: 501, unit: 1250 });
    expect(component.initialUnitInput).toBe(1250);
  });

  it('บ้านที่ยังไม่เคยจดเลย → ไม่มีเลขตั้งต้นให้แก้', () => {
    openWith([]);

    expect(component.initialReading).toBeNull();
    expect(component.initialUnitInput).toBe('');
  });

  it('ยังไม่ได้แก้เลข → ปุ่มบันทึกต้องไม่ขึ้น', () => {
    openWith([{ id: 501, meter_unit: 1250 }]);

    expect(component.initialUnitChanged).toBe(false);

    component.initialUnitInput = 1250;
    expect(component.initialUnitChanged).toBe(false);

    component.initialUnitInput = 1200;
    expect(component.initialUnitChanged).toBe(true);
  });

  it('เลขติดลบหรือมีทศนิยม → ยังไม่นับว่าแก้ ปุ่มไม่ขึ้น', () => {
    openWith([{ id: 501, meter_unit: 1250 }]);

    component.initialUnitInput = -5;
    expect(component.initialUnitChanged).toBe(false);

    component.initialUnitInput = 12.5;
    expect(component.initialUnitChanged).toBe(false);
  });

  it('ไม่กรอกเหตุผล → ไม่ยิงคำขอ และบอกให้กรอกก่อน', () => {
    openWith([{ id: 501, meter_unit: 1250 }]);
    component.initialUnitInput = 1200;
    component.initialReasonInput = '   ';

    component.saveInitialUnit();

    http.expectNone(r => r.url.endsWith('/member/initial-reading'));
    expect(component.initialReadingError).toContain('เหตุผล');
  });

  it('กรอกครบ → ยิงไป /member/initial-reading พร้อมเหตุผล แล้วอัปเดตค่าที่แสดง', () => {
    openWith([{ id: 501, meter_unit: 12500 }]);
    component.initialUnitInput = 1250;
    component.initialReasonInput = 'พิมพ์เกินหนึ่งหลัก';

    component.saveInitialUnit();

    const req = http.expectOne(r => r.url.endsWith('/member/initial-reading'));
    expect(req.request.body).toEqual({
      id: 12,
      initial_meter_unit: 1250,
      reason: 'พิมพ์เกินหนึ่งหลัก'
    });

    req.flush({ members_id: 12, old_unit: 12500, new_unit: 1250 });

    expect(component.initialReading).toEqual({ id: 501, unit: 1250 });
    expect(component.initialReasonInput).toBe('');
    expect(component.isSavingInitialUnit).toBe(false);
  });

  /**
   * ข้อความจากหลังบ้านบอกเหตุผลจริง (เช่น มากกว่าการจดครั้งถัดไป) ต้องโชว์ตรง ๆ
   * ไม่ใช่กลบด้วยข้อความกลาง ๆ ที่ไม่บอกว่าต้องแก้ยังไง
   */
  it('หลังบ้านตีกลับ → โชว์ข้อความจากหลังบ้าน และค่าเดิมต้องไม่ถูกเปลี่ยน', () => {
    openWith([{ id: 501, meter_unit: 1200 }]);
    component.initialUnitInput = 1400;
    component.initialReasonInput = 'แก้ตามรูป';

    component.saveInitialUnit();
    http.expectOne(r => r.url.endsWith('/member/initial-reading')).flush(
      { message: 'เลขตั้งต้นต้องไม่มากกว่าการจดครั้งถัดไป (1300) ครับ — มิเตอร์ไม่เดินถอยหลัง' },
      { status: 422, statusText: 'Unprocessable Entity' }
    );

    expect(component.initialReadingError).toContain('มิเตอร์ไม่เดินถอยหลัง');
    expect(component.initialReading).toEqual({ id: 501, unit: 1200 });
    expect(component.isSavingInitialUnit).toBe(false);
  });

  it('เปิดหน้าต่างของบ้านหลังใหม่ → ล้างค่าของหลังก่อนหน้าทิ้งก่อนเสมอ', () => {
    openWith([{ id: 501, meter_unit: 1250 }]);
    component.initialUnitInput = 1200;
    component.initialReasonInput = 'ค้างไว้';
    component.initialReadingError = 'ค้างไว้';

    component.openEditModal({ id: 13, house_no: '99/2' });

    expect(component.initialReading).toBeNull();
    expect(component.initialUnitInput).toBe('');
    expect(component.initialReasonInput).toBe('');
    expect(component.initialReadingError).toBeNull();

    http.expectOne(r => r.url.endsWith('/meter-readings/member/13')).flush([]);
  });
});
