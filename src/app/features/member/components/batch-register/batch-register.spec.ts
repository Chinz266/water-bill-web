import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { BatchRegisterComponent } from './batch-register';

/**
 * ลงทะเบียนทั้งหมู่บ้านจากรูปที่ถ่ายมา — จุดที่พังแล้วเจ็บที่สุดคือ
 * "บ้านซ้ำ" กับ "เลขตั้งต้นผิด" เพราะทั้งคู่ไปโผล่เป็นบิลผิดในเดือนถัดไป
 */

/** แถวหนึ่งในคิว สร้างตรง ๆ ไม่ผ่านตัวเลือกไฟล์ (jsdom เปิดรูปจริงไม่ได้) */
const row = (over: any = {}) => ({
  seq: over.seq ?? 1,
  file: new File(['รูปจำลอง'], `meter-${over.seq ?? 1}.jpg`, { type: 'image/jpeg' }),
  fileKey: `meter-${over.seq ?? 1}.jpg|1|1`,
  previewUrl: 'blob:preview',
  brokenImage: false,
  capturedAt: new Date(2026, 7, 5),
  latitude: 14.9799,
  longitude: 102.097771,
  houseNo: '99/1',
  ownerName: 'สมชาย ใจดี',
  phone: '',
  initialUnit: 1250,
  status: 'ready',
  error: null,
  memberId: null,
  ...over
});

describe('BatchRegisterComponent — ลงทะเบียนหลายบ้านจากรูป', () => {
  let component: BatchRegisterComponent;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BatchRegisterComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    }).compileComponents();

    const fixture = TestBed.createComponent(BatchRegisterComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    http.match(r => r.url.endsWith('/villages')).forEach(r => r.flush([{ id: 1, village_name: 'โนนกราด' }]));
    http.match(r => r.url.endsWith('/member/all')).forEach(r => r.flush([]));

    // รูปจริงเปิดใน jsdom ไม่ได้ ตัวย่อรูปจึงต้องถูกแทนตอนเทสต์คิวบันทึก
    (component as any).photoDataUrl = () => Promise.resolve('data:image/jpeg;base64,xxx');
  });

  describe('ตรวจก่อนบันทึก', () => {
    it('ข้อมูลครบ → ลงทะเบียนได้', () => {
      component.rows = [row()] as any;

      expect(component.blockingIssue(component.rows[0])).toBeNull();
    });

    it('รูปไม่มีพิกัดติดมา → บล็อก (หลังบ้านบังคับพิกัด และจับคู่รูปทีหลังไม่ได้)', () => {
      component.rows = [row({ latitude: null, longitude: null })] as any;

      expect(component.blockingIssue(component.rows[0])).toContain('พิกัด');
    });

    it('ไม่กรอกเลขมิเตอร์ตั้งต้น → บล็อก (บิลใบแรกจะคิดจาก 0)', () => {
      component.rows = [row({ initialUnit: null })] as any;

      expect(component.blockingIssue(component.rows[0])).toContain('เลขมิเตอร์ตั้งต้น');
    });

    it('เลขตั้งต้น 0 ผ่านได้ (มิเตอร์เพิ่งติดใหม่)', () => {
      component.rows = [row({ initialUnit: 0 })] as any;

      expect(component.blockingIssue(component.rows[0])).toBeNull();
    });

    it('เลขตั้งต้นติดลบ → บล็อก', () => {
      component.rows = [row({ initialUnit: -5 })] as any;

      expect(component.blockingIssue(component.rows[0])).toContain('ติดลบ');
    });

    it('บ้านเลขที่ซ้ำกันเองในคิว → บล็อกทั้งสองแถว', () => {
      component.rows = [row({ seq: 1 }), row({ seq: 2 })] as any;

      expect(component.blockingIssue(component.rows[0])).toContain('ซ้ำ');
      expect(component.blockingIssue(component.rows[1])).toContain('ซ้ำ');
    });

    it('บ้านเลขที่ที่มีอยู่ในระบบแล้ว → บล็อก (เว้นวรรค/ตัวพิมพ์ไม่ช่วยให้รอด)', () => {
      component.members = [{ id: 7, house_no: ' 99/1 ' }];
      component.rows = [row()] as any;

      expect(component.blockingIssue(component.rows[0])).toContain('มีอยู่ในระบบแล้ว');
    });

    it('ถ่ายใกล้บ้านที่ลงทะเบียนไว้แล้ว → เตือน แต่ไม่บล็อก (บ้านมิเตอร์ติดกันมีจริง)', () => {
      component.members = [{ id: 7, house_no: '99/9', latitude: 14.9799, longitude: 102.097771 }];
      component.rows = [row()] as any;

      expect(component.nearbyMember(component.rows[0])?.house_no).toBe('99/9');
      expect(component.blockingIssue(component.rows[0])).toBeNull();
    });

    it('ยังไม่ได้เลือกหมู่บ้าน → บล็อก', () => {
      component.villagesId = null;
      component.rows = [row()] as any;

      expect(component.blockingIssue(component.rows[0])).toContain('หมู่บ้าน');
    });
  });

  describe('คิวลงทะเบียน', () => {
    it('ส่งฟิลด์ครบ พร้อมวันจดจากวันที่ถ่ายรูป', async () => {
      component.rows = [row()] as any;
      component.saveAll();
      await Promise.resolve();

      const req = http.expectOne(r => r.url.endsWith('/member/register-onsite'));
      expect(req.request.body).toMatchObject({
        house_no: '99/1',
        fname: 'สมชาย',
        lname: 'ใจดี',
        villages_id: 1,
        latitude: 14.9799,
        initial_meter_unit: 1250,
        reading_date: '2026-08-05'
      });
      req.flush({ member: { id: 9 } });

      expect(component.rows[0].status).toBe('saved');
    });

    it('รูปไม่มีวันถ่าย → ใช้วันนี้ตามเวลาไทย', async () => {
      const today = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      component.rows = [row({ capturedAt: null })] as any;
      component.saveAll();
      await Promise.resolve();

      const req = http.expectOne(r => r.url.endsWith('/member/register-onsite'));
      expect(req.request.body.reading_date).toBe(
        `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
      );
      req.flush({ member: { id: 9 } });
    });

    it('หลังหนึ่งไม่ผ่าน ต้องไม่หยุดทั้งกอง', async () => {
      component.rows = [row({ seq: 1, houseNo: '99/1' }), row({ seq: 2, houseNo: '99/2' })] as any;
      component.saveAll();
      await Promise.resolve();

      http
        .expectOne(r => r.url.endsWith('/member/register-onsite'))
        .flush({ message: 'บ้านเลขที่นี้มีอยู่แล้ว' }, { status: 400, statusText: 'Bad Request' });
      await Promise.resolve();

      const second = http.expectOne(r => r.url.endsWith('/member/register-onsite'));
      expect(second.request.body.house_no).toBe('99/2');
      second.flush({ member: { id: 10 } });

      expect(component.rows[0].status).toBe('failed');
      expect(component.rows[0].error).toContain('บ้านเลขที่นี้มีอยู่แล้ว');
      expect(component.rows[1].status).toBe('saved');
    });

    it('บ้านที่เพิ่งลงทะเบียนไปต้องถูกนับเป็นบ้านที่มีอยู่แล้วทันที', async () => {
      component.rows = [row()] as any;
      component.saveAll();
      await Promise.resolve();

      http.expectOne(r => r.url.endsWith('/member/register-onsite')).flush({ member: { id: 9 } });

      expect(component.members.some(m => m.house_no === '99/1')).toBe(true);
    });

    it('แถวที่ยังกรอกไม่ครบต้องไม่ถูกส่งขึ้นไป', () => {
      component.rows = [row({ houseNo: '' })] as any;
      component.saveAll();

      http.expectNone(r => r.url.endsWith('/member/register-onsite'));
    });
  });
});
