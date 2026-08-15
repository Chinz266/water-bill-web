import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MemberListComponent } from './member-list';

/**
 * ลงทะเบียนบ้านต้องยิง /member/register-onsite ให้ตรงกับ RegisterMemberOnsiteDto
 * ของหลังบ้าน — พิกัดกับเลขตั้งต้นเป็นของบังคับ ถ้าขาดไปแล้วปล่อยผ่าน
 * จะได้บ้านที่จับคู่รูปไม่ได้ตลอดไป และบิลใบแรกคิดจาก 0
 */

describe('MemberListComponent — ลงทะเบียนบ้านแบบยืนหน้ามิเตอร์', () => {
  let component: MemberListComponent;
  let http: HttpTestingController;

  const fillForm = (over: any = {}) => {
    component.newMember = {
      house_no: '99/9',
      fname: 'สมชาย',
      lname: 'ใจดี',
      phone: '0812345678',
      villages_id: 1,
      initial_meter_unit: 1250,
      latitude: 14.9799,
      longitude: 102.097771,
      gps_accuracy_m: 12,
      meter_photo: null,
      ...over
    };
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MemberListComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();

    const fixture = TestBed.createComponent(MemberListComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    // รายชื่อบ้าน (ผ่าน async pipe) และรายชื่อหมู่บ้านที่โหลดตอนเปิดหน้า
    http.match(r => r.url.endsWith('/member/all')).forEach(r => r.flush([]));
    http.match(r => r.url.endsWith('/villages')).forEach(r => r.flush([]));
  });

  it('ส่งฟิลด์ครบตาม DTO ของหลังบ้าน', () => {
    fillForm();
    component.saveMember();

    const req = http.expectOne(r => r.url.endsWith('/member/register-onsite'));
    expect(req.request.body).toMatchObject({
      house_no: '99/9',
      fname: 'สมชาย',
      villages_id: 1,
      latitude: 14.9799,
      longitude: 102.097771,
      gps_accuracy_m: 12,
      initial_meter_unit: 1250
    });
    req.flush({ member: { id: 9 }, initial_reading: { id: 3 } });

    expect(component.showAddModal).toBe(false);
  });

  it('ไม่มีพิกัด → ไม่ยิงเลย', () => {
    fillForm({ latitude: null, longitude: null });
    component.saveMember();

    http.expectNone(r => r.url.endsWith('/member/register-onsite'));
  });

  it('ไม่กรอกเลขมิเตอร์ตั้งต้น → ไม่ยิงเลย (บิลใบแรกจะคิดจาก 0)', () => {
    fillForm({ initial_meter_unit: null });
    component.saveMember();

    http.expectNone(r => r.url.endsWith('/member/register-onsite'));
  });

  it('เลขตั้งต้นติดลบ → ไม่ยิงเลย', () => {
    fillForm({ initial_meter_unit: -5 });
    component.saveMember();

    http.expectNone(r => r.url.endsWith('/member/register-onsite'));
  });

  it('เลขตั้งต้น 0 ส่งได้ (มิเตอร์เพิ่งติดใหม่)', () => {
    fillForm({ initial_meter_unit: 0 });
    component.saveMember();

    const req = http.expectOne(r => r.url.endsWith('/member/register-onsite'));
    expect(req.request.body.initial_meter_unit).toBe(0);
    req.flush({ member: { id: 9 } });
  });

  it('GPS คลาดเคลื่อนเกิน 50 ม. → ไม่ยิง (หลังบ้านปฏิเสธอยู่แล้ว)', () => {
    fillForm({ gps_accuracy_m: 80 });
    component.saveMember();

    http.expectNone(r => r.url.endsWith('/member/register-onsite'));
  });

  it('กดบันทึกรัว ๆ ต้องยิงครั้งเดียว', () => {
    fillForm();
    component.saveMember();
    component.saveMember();

    expect(http.match(r => r.url.endsWith('/member/register-onsite')).length).toBe(1);
  });

  it('เอารูปออกแล้ว พิกัดที่ได้จากรูปต้องหายไปด้วย', () => {
    fillForm();
    component.coordsSource = 'photo';
    component.photoPreview = 'data:image/jpeg;base64,xxx';

    component.removePhoto();

    expect(component.hasCoords).toBe(false);
    expect(component.newMember.meter_photo).toBeNull();
  });

  it('พิกัดที่วัดเองไว้แล้ว ต้องไม่ถูกลบตอนเอารูปออก', () => {
    fillForm();
    component.coordsSource = 'gps';
    component.photoPreview = 'data:image/jpeg;base64,xxx';

    component.removePhoto();

    expect(component.hasCoords).toBe(true);
  });
});
