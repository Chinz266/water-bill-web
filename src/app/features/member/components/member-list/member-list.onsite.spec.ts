import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
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
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
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

  /**
   * วันจดตั้งต้นคือจุดเริ่มรอบบิลใบแรกของบ้านหลังนี้ ถ้าลงเป็นวันที่นั่งกรอกย้อนหลัง
   * รอบแรกจะสั้น/ยาวกว่าความจริงไปเป็นสัปดาห์ แล้วเทียบกับเดือนอื่นไม่ได้ทั้งปี
   */
  it('ใช้วันที่ถ่ายรูปเป็นวันจดตั้งต้น ไม่ใช่วันที่กดบันทึก', () => {
    fillForm();
    component.photoCapturedAt = new Date(2026, 7, 5);
    component.saveMember();

    const req = http.expectOne(r => r.url.endsWith('/member/register-onsite'));
    expect(req.request.body.reading_date).toBe('2026-08-05');
    req.flush({ member: { id: 9 } });
  });

  it('รูปไม่มีวันถ่าย → ใช้วันนี้ตามเวลาไทย ไม่ใช่ UTC', () => {
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    fillForm();
    component.saveMember();

    const req = http.expectOne(r => r.url.endsWith('/member/register-onsite'));
    // toISOString() จะถอยไปเป็นเมื่อวานถ้าบันทึกช่วงเที่ยงคืนถึงตี 7 ของไทย
    expect(req.request.body.reading_date).toBe(
      `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
    );
    req.flush({ member: { id: 9 } });
  });

  it('เอารูปออกแล้ว วันถ่ายของรูปเก่าต้องไม่ค้างอยู่', () => {
    fillForm();
    component.photoCapturedAt = new Date(2026, 7, 5);
    component.photoPreview = 'data:image/jpeg;base64,xxx';

    component.removePhoto();

    expect(component.photoCapturedAt).toBeNull();
  });

  it('กดบันทึกรัว ๆ ต้องยิงครั้งเดียว', () => {
    fillForm();
    component.saveMember();
    component.saveMember();

    expect(http.match(r => r.url.endsWith('/member/register-onsite')).length).toBe(1);
  });

  /**
   * ก่อนหน้านี้ระบบเก็บพิกัดจากเครื่องแม้คลาดเคลื่อนหลักสิบกิโล บ้านที่ลงทะเบียนช่วงนั้น
   * จึงมีพิกัดที่อยู่คนละอำเภอ ซึ่งทำให้จับคู่รูปกับบ้านผิดหลังไปเรื่อย ๆ ต้องจับให้เห็น
   */
  describe('จับพิกัดที่เพี้ยน', () => {
    const houseAt = (id: number, lat: number | null, lng: number | null) => ({
      id,
      house_no: `99/${id}`,
      latitude: lat,
      longitude: lng
    });

    it('หลังที่ห่างจากใจกลางหมู่บ้านเป็นร้อยกิโล → ผิดปกติ ส่วนหลังอื่นไม่โดนลูกหลง', () => {
      component.members = [
        houseAt(1, 14.9799, 102.0977),
        houseAt(2, 14.98, 102.0978),
        houseAt(3, 14.9801, 102.0979),
        houseAt(4, 14.98335, 100.0) // ค่าที่เครื่องเดาจาก IP
      ];

      expect(component.isCoordsSuspicious(component.members[3])).toBe(true);
      expect(component.isCoordsSuspicious(component.members[0])).toBe(false);
      expect(component.suspiciousCoordsCount).toBe(1);
      expect(component.distanceFromVillage(component.members[3])).toContain('กม.');
    });

    it('บ้านในหมู่บ้านเดียวกันห่างกันไม่กี่ร้อยเมตร ต้องไม่ถูกหาว่าผิด', () => {
      component.members = [
        houseAt(1, 14.9799, 102.0977),
        houseAt(2, 14.9805, 102.0985),
        houseAt(3, 14.9812, 102.0991)
      ];

      expect(component.suspiciousCoordsCount).toBe(0);
    });

    it('มีพิกัดไม่ถึง 3 หลัง → ยังตัดสินไม่ได้ ห้ามกล่าวหาหลังไหน', () => {
      component.members = [houseAt(1, 14.9799, 102.0977), houseAt(2, 14.98335, 100.0)];

      expect(component.suspiciousCoordsCount).toBe(0);
    });
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
