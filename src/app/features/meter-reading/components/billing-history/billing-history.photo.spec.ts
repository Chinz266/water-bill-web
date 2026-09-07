import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { BillingHistoryComponent } from './billing-history';
import { API_BASE_URL } from '../../../../core/api.config';

/**
 * รูปหน้าปัด + ข้อมูลตอนถ่ายในหน้ารายละเอียดบิล
 *
 * ทั้งก้อนคิดครั้งเดียวตอนกดเปิดใบ ไม่ได้คิดสดใน template — เทสต์ชุดนี้จึงล็อกไว้ว่า
 * ค่าที่ "มีจริงแต่เป็นศูนย์" (AI อ่านไม่ออกเลย) ต้องไม่หายไปพร้อมกับค่าที่ไม่มี
 */

const bill = (reading: any) => ({
  id: 1,
  billing_month: '08',
  billing_year: '2026',
  total_amount: '450.00',
  payment_status: 'Pending',
  member: { id: 1, house_no: '99/1', fname: 'สมชาย', lname: 'ใจดี' },
  meter_reading: reading
});

describe('BillingHistoryComponent — รูปมิเตอร์ในหน้ารายละเอียด', () => {
  let component: BillingHistoryComponent;
  let http: HttpTestingController;

  const openWith = (reading: any) => {
    component.openDetail(bill(reading));
    return component.detail!;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BillingHistoryComponent],
      // routerLink ในหน้าว่าง (ยังไม่มีบิล) ต้องมี router จำลอง ไม่งั้น template พังตั้งแต่ตอน render
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    }).compileComponents();

    const fixture = TestBed.createComponent(BillingHistoryComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    http.expectOne(r => r.url.endsWith('/bills')).flush([]);
  });

  it('path จากหลังบ้านต้องต่อกับ API_BASE_URL ไม่ใช่ path เปล่า', () => {
    expect(openWith({ meter_photo: 'uploads/m1.jpg' }).photo).toBe(`${API_BASE_URL}/uploads/m1.jpg`);
    // มี / นำหน้ามาด้วยก็ต้องไม่กลายเป็น //uploads
    expect(openWith({ meter_photo: '/uploads/m1.jpg' }).photo).toBe(`${API_BASE_URL}/uploads/m1.jpg`);
  });

  it('data URL / URL เต็ม ใช้ค่าเดิมตรง ๆ', () => {
    expect(openWith({ meter_photo: 'data:image/jpeg;base64,xxx' }).photo).toBe('data:image/jpeg;base64,xxx');
    expect(openWith({ meter_photo: 'https://cdn.example/m1.jpg' }).photo).toBe('https://cdn.example/m1.jpg');
  });

  it('ไม่มีรูป (บิลเก่า) → null ไม่ใช่ URL ที่ชี้ไปไหนไม่รู้', () => {
    expect(openWith({ meter_photo: null }).photo).toBeNull();
    expect(openWith({ meter_photo: '   ' }).photo).toBeNull();
    expect(openWith(undefined).photo).toBeNull();
  });

  it('ความมั่นใจ 0 ต้องยังโชว์ — เป็นเคสที่ต้องเห็นที่สุด', () => {
    expect(openWith({ read_confidence: 0 }).confidence).toBe(0);
    expect(openWith({ read_confidence: 0.873 }).confidence).toBe(87);
    // NULL = คนพิมพ์เลขเอง ไม่ได้ให้ AI อ่าน จึงไม่มีอะไรให้แสดง
    expect(openWith({ read_confidence: null }).confidence).toBeNull();
    expect(openWith({}).confidence).toBeNull();
  });

  it('พิกัด 0,0 คือค่าที่หลุดมาตอนอ่าน EXIF ไม่ได้ ไม่ใช่จุดที่ไปยืนถ่าย', () => {
    expect(openWith({ latitude: 0, longitude: 0 }).coords).toBe('');
    expect(openWith({ latitude: null, longitude: null }).coords).toBe('');
    // ขาดไปข้างเดียวก็ใช้ไม่ได้ — Number(null) = 0 จะลากพิกัดไปนอกทวีป
    expect(openWith({ latitude: null, longitude: 102.12286 }).coords).toBe('');
    // หลังบ้านคืนเป็น string ได้ (คอลัมน์ decimal ของ MySQL)
    expect(openWith({ latitude: '14.98335', longitude: '102.12286' }).coords).toBe('14.98335, 102.12286');
    expect(openWith({ latitude: 14.98335, longitude: 102.12286 }).coords).toBe('14.98335, 102.12286');
  });

  it('เปิดใบใหม่ต้องล้างสถานะรูปพังของใบก่อนหน้า', () => {
    openWith({ meter_photo: 'uploads/หาย.jpg' });
    component.onPhotoError();
    expect(component.photoBroken).toBe(true);

    openWith({ meter_photo: 'uploads/m2.jpg' });
    expect(component.photoBroken).toBe(false);
  });

  it('รูปพังแล้วกดขยายไม่ได้ ไม่งั้นได้จอดำเปล่า ๆ', () => {
    openWith({ meter_photo: 'uploads/หาย.jpg' });
    component.onPhotoError();
    component.openPhoto();

    expect(component.photoZoomed).toBe(false);
  });

  it('ปิดรายละเอียดแล้วรูปเต็มจอต้องปิดตาม', () => {
    openWith({ meter_photo: 'uploads/m1.jpg' });
    component.openPhoto();
    expect(component.photoZoomed).toBe(true);

    component.closeDetail();
    expect(component.photoZoomed).toBe(false);
    expect(component.detail).toBeNull();
  });
});
