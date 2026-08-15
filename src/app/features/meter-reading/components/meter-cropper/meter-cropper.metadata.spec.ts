import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { MeterCropperComponent } from './meter-cropper';

/**
 * ข้อมูล EXIF ที่ติดมากับรูป — ค่าที่ไม่คาดคิดจากกล้อง/แกลเลอรี/หลังบ้าน
 * ต้องไม่ทำให้บันทึกวันจดมิเตอร์ผิดหรือหน้าจอดับ
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** วันที่ในรูปแบบ EXIF มาตรฐาน 'YYYY:MM:DD HH:mm:ss' */
const exif = (d: Date) => `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} 08:30:00`;

/** วันที่แบบที่หลังบ้านคืนมาใน reading_date */
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

describe('MeterCropperComponent — ข้อมูลที่ติดมากับรูป', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<MeterCropperComponent>>;
  let component: MeterCropperComponent;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MeterCropperComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    }).compileComponents();

    fixture = TestBed.createComponent(MeterCropperComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    // รายชื่อบ้านที่โหลดตอน ngOnInit — ไม่เกี่ยวกับเทสต์ชุดนี้แต่ต้องเคลียร์ทิ้ง
    http.expectOne(r => r.url.endsWith('/member/all')).flush([]);
  });

  describe('วันที่ถ่ายรูป', () => {
    it('อ่านรูปแบบ EXIF มาตรฐานได้', () => {
      const yesterday = daysAgo(1);
      component.aiResult = { read_unit: 120, metadata: { captureDate: exif(yesterday) } };

      expect(component.capturedAt?.getDate()).toBe(yesterday.getDate());
      expect(component.capturedAt?.getMonth()).toBe(yesterday.getMonth());
      expect(component.hasUnreadableCaptureDate).toBe(false);
    });

    it('อ่านรูปแบบ ISO ได้ ไม่เพี้ยนเป็นสตริงแปลก ๆ', () => {
      const yesterday = daysAgo(1);
      const pad = (n: number) => String(n).padStart(2, '0');
      const iso = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}T22:08:11.000Z`;
      component.aiResult = { read_unit: 120, metadata: { captureDate: iso } };

      expect(component.capturedAt?.getDate()).toBe(yesterday.getDate());
    });

    it('เป็น timestamp ตัวเลขก็ไม่พัง', () => {
      const yesterday = daysAgo(1);
      component.aiResult = { read_unit: 120, metadata: { captureDate: yesterday.getTime() } };

      expect(component.capturedAt?.getDate()).toBe(yesterday.getDate());
    });

    it('อ่านไม่ออก → คืน null แล้วบอกว่าจะใช้วันนี้แทน', () => {
      component.aiResult = { read_unit: 120, metadata: { captureDate: 'ไม่ทราบวันที่' } };

      expect(component.capturedAt).toBeNull();
      expect(component.hasUnreadableCaptureDate).toBe(true);
    });

    it('วันที่ไม่มีจริง (31 ก.พ.) ต้องไม่ถูกเลื่อนเป็นเดือนถัดไปเงียบ ๆ', () => {
      component.aiResult = { read_unit: 120, metadata: { captureDate: '2026:02:31 08:30:00' } };

      expect(component.capturedAt).toBeNull();
    });

    it('วันในอนาคต (นาฬิกาเครื่องเพี้ยน) ต้องไม่เอามาใช้', () => {
      const nextYear = new Date();
      nextYear.setFullYear(nextYear.getFullYear() + 1);
      component.aiResult = { read_unit: 120, metadata: { captureDate: exif(nextYear) } };

      expect(component.capturedAt).toBeNull();
    });

    it('รูปเก่าเกิน 2 ปีต้องไม่เอามาใช้', () => {
      component.aiResult = { read_unit: 120, metadata: { captureDate: exif(daysAgo(365 * 3)) } };

      expect(component.capturedAt).toBeNull();
    });

    it('ไม่มี metadata เลยก็ไม่ขึ้นคำเตือนว่าอ่านไม่ออก', () => {
      component.aiResult = { read_unit: 120 };

      expect(component.capturedAt).toBeNull();
      expect(component.hasUnreadableCaptureDate).toBe(false);
    });

    it('รูปถ่ายคนละเดือนกับบิลที่เลือก ต้องเตือน', () => {
      component.aiResult = { read_unit: 120, metadata: { captureDate: exif(daysAgo(70)) } };

      expect(component.isCaptureOutsideBillingMonth).toBe(true);
    });

    it('รูปถ่ายเดือนเดียวกับบิลที่เลือก ไม่ต้องเตือน', () => {
      const today = new Date();
      component.aiResult = { read_unit: 120, metadata: { captureDate: exif(today) } };
      component.billingKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

      expect(component.isCaptureOutsideBillingMonth).toBe(false);
    });
  });

  /**
   * รอบบิลของแต่ละบ้านคิดจากวันจดจริง ไม่ใช่เดือนบนปฏิทิน (ดู billing-cycle.ts)
   * เจ้าหน้าที่ต้องเห็นว่ารอบนี้กี่วัน และรูปใบนี้ควรลงรอบเดือนไหนของบ้านหลังนี้
   */
  describe('รอบบิลของบ้านที่เลือก', () => {
    /** เลือกบ้านแล้วตอบประวัติการจดกลับไปให้ */
    const selectHouseWithReadings = (dates: Date[]) => {
      component.members = [{ id: 1, house_no: '99/1' }];
      component.selectedMemberId = 1;
      component.onMemberChange();

      http
        .expectOne(r => r.url.endsWith('/meter-readings/member/1'))
        .flush(dates.map((date, i) => ({ id: i + 1, reading_date: iso(date), meter_unit: 100, members_id: 1 })));

      // เลขตั้งต้น/บิลซ้ำของเดือนที่เลือก ไม่เกี่ยวกับเทสต์ชุดนี้แต่ต้องเคลียร์ทิ้ง
      http.match(r => r.url.includes('/bills/member/')).forEach(r => r.flush(null));
    };

    it('รอบนี้นับจากวันจดครั้งก่อนถึงวันที่ถ่ายรูป', () => {
      component.aiResult = { read_unit: 120, metadata: { captureDate: exif(daysAgo(1)) } };
      selectHouseWithReadings([daysAgo(31)]);

      expect(component.currentCycle?.days).toBe(30);
      expect(component.cycleLabel).toContain('30 วัน');
    });

    it('เดือนก่อนลืมจดไปรอบหนึ่ง → รอบยาวผิดปกติ ต้องเห็นได้จากจำนวนวัน', () => {
      component.aiResult = { read_unit: 120, metadata: { captureDate: exif(daysAgo(1)) } };
      selectHouseWithReadings([daysAgo(90), daysAgo(61)]);

      expect(component.currentCycle?.days).toBe(60);
    });

    it('บ้านใหม่ที่ยังไม่เคยจด → ไม่มีรอบให้แสดง (ไม่ใช่ 0 วัน)', () => {
      component.aiResult = { read_unit: 120, metadata: { captureDate: exif(daysAgo(1)) } };
      selectHouseWithReadings([]);

      expect(component.currentCycle).toBeNull();
      expect(component.cycleLabel).toBe('');
    });

    it('รูปเก่าจากเดือนก่อน → เสนอรอบเดือนนั้น แล้วกดเปลี่ยนได้ในปุ่มเดียว', () => {
      const captured = daysAgo(40); // เกิน 31 วัน จึงเป็นคนละเดือนกับวันนี้เสมอ
      component.aiResult = { read_unit: 120, metadata: { captureDate: exif(captured) } };

      expect(component.isCaptureOutsideBillingMonth).toBe(true);
      expect(component.suggestedBillingOption?.key).toBe(
        `${captured.getFullYear()}-${pad(captured.getMonth() + 1)}`
      );

      component.useSuggestedBilling();

      expect(component.billingKey).toBe(`${captured.getFullYear()}-${pad(captured.getMonth() + 1)}`);
      expect(component.isCaptureOutsideBillingMonth).toBe(false);
    });
  });

  describe('พิกัด GPS', () => {
    it('หลังบ้านส่งมาเป็นสตริงตัวเลขก็ใช้ได้', () => {
      component.aiResult = { read_unit: 120, metadata: { latitude: '13.7563', longitude: '100.5018' } };

      expect(component.captureCoords).toEqual({ lat: 13.7563, lng: 100.5018 });
    });

    it('ค่าที่ไม่ใช่ตัวเลข → null (กัน DecimalPipe โยน error จนหน้าจอดับ)', () => {
      component.aiResult = { read_unit: 120, metadata: { latitude: "13°45'", longitude: '100.5018' } };

      expect(component.captureCoords).toBeNull();
    });

    it('0,0 คือ EXIF ว่าง ไม่ใช่พิกัดจริง', () => {
      component.aiResult = { read_unit: 120, metadata: { latitude: 0, longitude: 0 } };

      expect(component.captureCoords).toBeNull();
    });

    it('ค่าหลุดขอบเขตโลก → null', () => {
      component.aiResult = { read_unit: 120, metadata: { latitude: 999, longitude: 100.5 } };

      expect(component.captureCoords).toBeNull();
    });
  });

  describe('จับคู่รูปกับบ้านจากพิกัด', () => {
    // สามหลังเรียงจากใกล้ไปไกลจากจุดถ่ายรูป (0.0001 องศา ≈ 11 เมตร)
    const houses = [
      { id: 1, house_no: '99/1', fname: 'สมชาย', lname: 'ใจดี', latitude: 13.7502, longitude: 100.5 },
      { id: 2, house_no: '99/2', fname: 'สมหญิง', lname: 'ใจดี', latitude: 13.75, longitude: 100.5 },
      { id: 3, house_no: '99/3', fname: 'วรพล', lname: 'ใจดี', latitude: null, longitude: null }
    ];
    const photoAt = (lat: number, lng: number) => ({ read_unit: 120, metadata: { latitude: lat, longitude: lng } });

    beforeEach(() => {
      component.members = houses.map(h => ({ ...h }));
    });

    it('เรียงบ้านที่ใกล้จุดถ่ายรูปที่สุดขึ้นก่อน บ้านที่ยังไม่มีพิกัดไปท้ายสุด', () => {
      component.aiResult = photoAt(13.75, 100.5);

      expect(component.memberOptions.map(r => r.member.house_no)).toEqual(['99/2', '99/1', '99/3']);
      expect(component.memberOptions[2].meters).toBeNull();
    });

    it('รูปไม่มีพิกัด → เรียงตามเดิม ไม่มีระยะห่างให้แสดง', () => {
      component.aiResult = { read_unit: 120 };

      expect(component.memberOptions.map(r => r.member.house_no)).toEqual(['99/1', '99/2', '99/3']);
      expect(component.memberOptions.every(r => r.meters === null)).toBe(true);
    });

    it('เสนอบ้านที่ใกล้ที่สุดเมื่อยังไม่ได้เลือกบ้าน', () => {
      component.aiResult = photoAt(13.75, 100.5);

      expect(component.nearestMember?.member.house_no).toBe('99/2');
    });

    it('ถ่ายไกลจากทุกบ้าน → ไม่เดามั่ว', () => {
      component.aiResult = photoAt(13.8, 100.5); // ห่างราว 5 กม.

      expect(component.nearestMember).toBeNull();
    });

    it('เลือกบ้านที่ห่างจากจุดถ่ายรูปเกิน 50 ม. ต้องเตือน', () => {
      component.aiResult = photoAt(13.7511, 100.5); // ห่างบ้าน 99/2 ราว 122 ม.
      component.selectedMemberId = 2;

      expect(component.isSelectedFarFromPhoto).toBe(true);
    });

    it('เลือกบ้านที่ตรงกับจุดถ่ายรูป ไม่ต้องเตือน', () => {
      component.aiResult = photoAt(13.75, 100.5);
      component.selectedMemberId = 2;

      expect(component.isSelectedFarFromPhoto).toBe(false);
    });

    it('บ้านที่ยังไม่มีพิกัด ไม่เตือน (ไม่มีอะไรให้เทียบ)', () => {
      component.aiResult = photoAt(13.8, 100.5);
      component.selectedMemberId = 3;

      expect(component.selectedMemberDistance).toBeNull();
      expect(component.isSelectedFarFromPhoto).toBe(false);
    });
  });

  describe('ผลอ่านเลขจากหลังบ้าน', () => {
    /** กด "อ่านเลขมิเตอร์" แล้วตอบกลับมาด้วย res ที่กำหนด */
    const scan = (res: any) => {
      component.croppedBlob = new Blob(['ภาพครอปจำลอง']);
      component.uploadToBackend();
      http.expectOne(r => r.url.endsWith('/meter-readings/ocr-upload')).flush(res);
    };

    it('ต้องแนบ EXIF จากไฟล์ต้นฉบับเข้าไปด้วย เพราะรูปที่ส่งไปเป็นรูปครอปที่ไม่มี EXIF แล้ว', () => {
      component['photoMeta'] = { captureDate: '2026:08:14 08:30:00', latitude: 13.7563, longitude: 100.5018 };

      scan({ read_unit: 120 });

      expect(component.aiResult.read_unit).toBe(120);
      expect(component.aiResult.metadata.captureDate).toBe('2026:08:14 08:30:00');
      expect(component.captureCoords).toEqual({ lat: 13.7563, lng: 100.5018 });
    });

    it('ถ้าหลังบ้านอ่าน metadata เองได้ ให้ค่าจากหลังบ้านชนะ', () => {
      component['photoMeta'] = { captureDate: '2026:08:14 08:30:00' };

      scan({ read_unit: 120, metadata: { captureDate: '2026:08:15 09:00:00' } });

      expect(component.aiResult.metadata.captureDate).toBe('2026:08:15 09:00:00');
    });
  });

  describe('วันจดมิเตอร์ที่ส่งขึ้นหลังบ้าน', () => {
    /** กดบันทึกจนถึง POST /bills/scan แล้วคืน body ที่ส่งไปจริง */
    const saveAndCapture = () => {
      component.selectedMemberId = 1;
      component.confirmAndSave();

      http.expectOne(r => r.url.endsWith('/water-rates/active')).flush({ id: 5, price_per_unit: '15.00', status: 'Active' });
      const req = http.expectOne(r => r.url.endsWith('/bills/scan'));
      req.flush({ id: 99 });
      return req.request.body;
    };

    it('ใช้วันที่ถ่ายรูปเป็นวันจด', () => {
      const yesterday = daysAgo(1);
      const pad = (n: number) => String(n).padStart(2, '0');
      component.aiResult = { read_unit: 120, metadata: { captureDate: exif(yesterday) } };

      expect(saveAndCapture().reading_date).toBe(
        `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`
      );
    });

    it('ไม่มีวันถ่าย → ใช้วันที่วันนี้ตามเวลาไทย ไม่ใช่ UTC', () => {
      const today = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      component.aiResult = { read_unit: 120 };

      // toISOString() จะถอยไปเป็นเมื่อวานถ้าบันทึกช่วงเที่ยงคืนถึงตี 7 ของไทย
      expect(saveAndCapture().reading_date).toBe(
        `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
      );
    });

    it('ส่งพิกัดกับเวลาที่ถ่ายไปเก็บคู่กับบิลด้วย (เดิมโหมดทีละหลังไม่ได้ส่งเลย)', () => {
      component.aiResult = {
        read_unit: 120,
        metadata: { captureDate: exif(daysAgo(1)), latitude: 13.7563, longitude: 100.5018 }
      };

      const body = saveAndCapture();

      expect(body.latitude).toBe(13.7563);
      expect(body.longitude).toBe(100.5018);
      expect(body.captured_at).toBeTruthy();
    });

    it('รูปไม่มีพิกัด → ไม่ส่งพิกัดขึ้นไป (0,0 คือกลางมหาสมุทร ไม่ใช่ค่าว่าง)', () => {
      component.aiResult = { read_unit: 120, metadata: { latitude: 0, longitude: 0 } };

      const body = saveAndCapture();

      expect(body.latitude).toBeUndefined();
      expect(body.longitude).toBeUndefined();
    });

    it('มิเตอร์ใหม่ที่อ่านได้ 0 ต้องออกบิลได้', () => {
      component.aiResult = { read_unit: 0 };

      expect(saveAndCapture().current_unit).toBe(0);
    });
  });

  describe('จำพิกัดบ้านให้อัตโนมัติหลังออกบิลสำเร็จ', () => {
    const saveWith = (member: any, metadata: any) => {
      component.members = [member];
      component.selectedMemberId = member.id;
      component.aiResult = { read_unit: 120, metadata };
      component.confirmAndSave();

      http.expectOne(r => r.url.endsWith('/water-rates/active')).flush({ id: 5 });
      http.expectOne(r => r.url.endsWith('/bills/scan')).flush({ id: 99 });
    };

    it('บ้านที่ยังไม่มีพิกัด → เก็บพิกัดจากรูปไว้ใช้ครั้งหน้า', () => {
      saveWith(
        { id: 1, house_no: '99/1', fname: 'สมชาย', phone: '0812345678' },
        { latitude: 13.75, longitude: 100.5 }
      );

      const update = http.expectOne(r => r.url.endsWith('/member/update'));
      expect(update.request.body.latitude).toBe(13.75);
      // ต้องแนบข้อมูลเดิมไปครบ เผื่อหลังบ้านเขียนทับทั้งแถว ไม่งั้นชื่อ/เบอร์หาย
      expect(update.request.body.phone).toBe('0812345678');
      update.flush({});
    });

    it('บ้านที่มีพิกัดอยู่แล้ว → ไม่ทับของเดิม', () => {
      saveWith(
        { id: 1, house_no: '99/1', latitude: 13.7, longitude: 100.4 },
        { latitude: 13.75, longitude: 100.5 }
      );

      http.expectNone(r => r.url.endsWith('/member/update'));
    });

    it('รูปไม่มีพิกัด → ไม่ต้องยิงอะไรเพิ่ม', () => {
      saveWith({ id: 1, house_no: '99/1' }, {});

      http.expectNone(r => r.url.endsWith('/member/update'));
    });
  });
});
