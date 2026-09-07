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
      latitude: 14.98335,
      longitude: 102.12286,
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
      latitude: 14.98335,
      longitude: 102.12286,
      initial_meter_unit: 1250
    });
    // EXIF ไม่มีค่าความคลาดเคลื่อนติดมา ฟิลด์นี้จึงต้องไม่ถูกส่งขึ้นไปเลย
    expect(req.request.body.gps_accuracy_m).toBeUndefined();
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
   * หน้านี้ไม่มีชั้นตรวจพิกัดแล้ว (เทียบใจกลางหมู่บ้าน / ยกพิกัดจากครั้งที่จด) เพราะทางเข้า
   * เหลือทางเดียวคือรูป — โหลดมาแล้วต้องไม่ยิงอะไรเพิ่ม และไม่แตะค่าที่หลังบ้านส่งมา
   */
  describe('พิกัดมาจากรูปทางเดียว', () => {
    it('โหลดรายชื่อแล้วไม่ยิงแก้ทะเบียนเอง ไม่ว่าพิกัดของหลังไหนจะเป็นค่าอะไร', () => {
      component.loadMembers();
      http.expectOne(r => r.url.endsWith('/member/all')).flush([
        { id: 1, house_no: '99/1', latitude: 14.9799, longitude: 102.0977 },
        { id: 2, house_no: '99/2', latitude: 14.98, longitude: 102.0978 },
        { id: 3, house_no: '99/3', latitude: 14.9801, longitude: 102.0979 },
        { id: 4, house_no: '99/4', latitude: 14.98335, longitude: 102.12286 }
      ]);

      http.expectNone(r => r.url.endsWith('/member/update'));
      expect(component.members.every(m => component.hasMemberCoords(m))).toBe(true);
      expect(component.missingCoordsCount).toBe(0);
    });

    it('บ้านที่ยังไม่มีพิกัดถูกนับไว้ ให้รู้ว่าเหลือกี่หลังที่ต้องหารูปมาแนบ', () => {
      component.loadMembers();
      http.expectOne(r => r.url.endsWith('/member/all')).flush([
        { id: 7, house_no: '99/1', latitude: null, longitude: null },
        { id: 8, house_no: '99/2', latitude: 14.9799, longitude: 102.0977 }
      ]);

      expect(component.missingCoordsCount).toBe(1);
    });
  });

  /**
   * ดึงพิกัดจากรูปแล้วต้องเขียนลงฐานข้อมูลเลย ของเดิมแค่เซ็ตลงฟอร์ม
   * คนที่กดแล้วปิดหน้าต่างจะได้ค่าเก่ากลับมา ทั้งที่หน้าจอเพิ่งขึ้นพิกัดใหม่ให้ดู
   */
  describe('ดึงพิกัดจากรูปในหน้าแก้ไข', () => {
    it('บันทึกทันที ไม่ต้องกดบันทึกการแก้ไขซ้ำ', () => {
      component.editingMember = {
        id: 7,
        house_no: '99/1',
        fname: 'สมชาย',
        lname: 'ใจดี',
        phone: '0812345678',
        villages_id: 1,
        latitude: 14.9799,
        longitude: 102.097771
      };

      component['persistCoords']('บันทึกพิกัดจากรูปเรียบร้อยแล้ว');

      const req = http.expectOne(r => r.url.endsWith('/member/update'));
      expect(req.request.body).toMatchObject({
        id: 7,
        house_no: '99/1',
        latitude: 14.9799,
        longitude: 102.097771
      });
      req.flush({});

      // โหลดรายชื่อใหม่ ค่าที่โชว์ในตารางจะได้ตรงกับที่เพิ่งบันทึก
      http.expectOne(r => r.url.endsWith('/member/all')).flush([]);
      expect(component.isUpdating).toBe(false);
    });

    it('ยิงพลาด → ค่าบนฟอร์มยังเป็นพิกัดจากรูป กดบันทึกลองใหม่ได้', () => {
      component.editingMember = { id: 7, house_no: '99/1', fname: 'สมชาย', latitude: 14.9799, longitude: 102.097771 };

      component['persistCoords']('บันทึกพิกัดจากรูปเรียบร้อยแล้ว');
      http.expectOne(r => r.url.endsWith('/member/update')).flush({}, { status: 500, statusText: 'Server Error' });

      expect(component.editingMember.latitude).toBe(14.9799);
      expect(component.isUpdating).toBe(false);
      expect(component.editLocationError).toBeTruthy();
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

  /**
   * เลิกวัดพิกัดจากเครื่องทั้งหน้าแล้ว (ดูคอมเมนต์ที่ coordsFromPhoto) — เครื่องที่ไม่มี GPS จริง
   * คืนค่าที่ห่างของจริงเป็นร้อยกิโล ปุ่มในรายการจึงต้องรับพิกัดจากไฟล์รูปเท่านั้น
   */
  describe('ดึงพิกัดจากรูปให้บ้านในรายการ', () => {
    const photoEvent = () =>
      ({ target: { files: [new Blob(['x'])], value: 'C:\\fakepath\\meter.jpg' } }) as unknown as Event;

    /** ตัวอ่าน EXIF ถูกทดสอบไบต์ต่อไบต์อยู่แล้วใน exif.spec.ts ที่นี่สนใจแค่ปลายทางของค่า */
    const photoCoords = (coords: { lat: number; lng: number } | null) => {
      (component as any).coordsFromPhoto = async () => coords;
    };

    it('รูปมีพิกัด → บันทึกทับให้เลย ไม่ต้องเปิดหน้าต่างแก้ไข', async () => {
      component.members = [{ id: 7, house_no: '99/1', fname: 'สมชาย', villages_id: 1 }];
      photoCoords({ lat: 14.98335, lng: 102.12286 });

      await component.fillCoordsFromPhoto(component.members[0], photoEvent());

      const req = http.expectOne(r => r.url.endsWith('/member/update'));
      expect(req.request.body).toMatchObject({ id: 7, latitude: 14.98335, longitude: 102.12286 });
      req.flush({});

      http.expectOne(r => r.url.endsWith('/member/all')).flush([]);
      expect(component.locatingMemberId).toBeNull();
    });

    it('รูปไม่มีพิกัดติดมา → ไม่ยิงอะไรเลย และปุ่มต้องกลับมากดได้', async () => {
      component.members = [{ id: 8, house_no: '99/2' }];
      photoCoords(null);

      await component.fillCoordsFromPhoto(component.members[0], photoEvent());

      http.expectNone(r => r.url.endsWith('/member/update'));
      expect(component.locatingMemberId).toBeNull();
    });
  });
});
