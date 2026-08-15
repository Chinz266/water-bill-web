import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { MeterCropperComponent } from './meter-cropper';

/**
 * ด่านกัน AI อ่านหลักหาย/หลักเกิน (meter_digits) ฝั่งจดทีละหลัง
 *
 * จำนวนหลักของมิเตอร์ตัวเดิมคงที่เสมอ หลังบ้านจึงใช้เทียบจับเคสที่อ่านผิดแบบ
 * ยอดคลาดสิบเท่า — แต่จะทำงานได้ก็ต่อเมื่อหน้าเว็บส่ง meter_digits ไปให้
 */

describe('MeterCropperComponent — ด่านจำนวนหลัก', () => {
  let component: MeterCropperComponent;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MeterCropperComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    }).compileComponents();

    const fixture = TestBed.createComponent(MeterCropperComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    http.expectOne(r => r.url.endsWith('/member/all')).flush([{ id: 1, house_no: '99/1' }]);
  });

  /** จำลองการอ่านรูปสำเร็จ — ให้ component เก็บเลข/จำนวนหลักที่ AI อ่านมา */
  const readPhoto = (meterDigits: number | null, unit = 1009) => {
    component.croppedBlob = new Blob(['รูป'], { type: 'image/jpeg' });
    component.uploadToBackend();
    http.expectOne(r => r.url.endsWith('/meter-readings/ocr-upload')).flush({
      success: true,
      read_unit: unit,
      confidence: 0.91,
      ...(meterDigits === null ? {} : { meter_digits: meterDigits })
    });
  };

  const save = () => {
    component.selectedMemberId = 1;
    component.confirmAndSave();
    http.expectOne(r => r.url.endsWith('/water-rates/active')).flush({ id: 5 });
    return http.expectOne(r => r.url.endsWith('/bills/scan'));
  };

  it('ส่ง meter_digits ที่ AI นับได้ไปกับตอนออกบิล', () => {
    readPhoto(4);

    const req = save();
    expect(req.request.body.current_unit).toBe(1009);
    expect(req.request.body.meter_digits).toBe(4);
    expect(req.request.body.confirm_digit_change).toBe(false);
  });

  it('คนแก้เลขเอง → ไม่ส่งจำนวนหลักของ AI ไป (เลขที่ผ่านตาคนเชื่อถือได้กว่า)', () => {
    readPhoto(4);
    component.aiResult.read_unit = 10090; // เจ้าหน้าที่พิมพ์ทับเอง

    const req = save();
    expect(req.request.body.current_unit).toBe(10090);
    expect(req.request.body.meter_digits).toBeUndefined();
  });

  it('หลังบ้านไม่ได้ส่งจำนวนหลักมา → ไม่ต้องเดาเอง', () => {
    readPhoto(null);

    expect(save().request.body.meter_digits).toBeUndefined();
  });

  it('โดนบล็อกเพราะจำนวนหลักไม่ตรง → ขึ้นคำเตือน แล้วยืนยันแล้วส่งธงไปด้วย', () => {
    readPhoto(4);

    save().flush(
      { message: 'หน้าปัดมิเตอร์ของบ้านหลังนี้เคยอ่านได้ 5 หลัก แต่รอบนี้อ่านได้ 4 หลัก' },
      { status: 409, statusText: 'Conflict' }
    );

    expect(component.digitChangeWarning).toContain('5 หลัก');
    // คนละด่านกับหน่วยน้ำสูงผิดปกติ ต้องไม่ขึ้นสลับกัน
    expect(component.highUsageWarning).toBeNull();

    component.confirmDigitChangeAndSave();
    http.expectOne(r => r.url.endsWith('/water-rates/active')).flush({ id: 5 });

    const retry = http.expectOne(r => r.url.endsWith('/bills/scan'));
    expect(retry.request.body.confirm_digit_change).toBe(true);
    expect(retry.request.body.confirm_high_usage).toBe(false);
  });
});
