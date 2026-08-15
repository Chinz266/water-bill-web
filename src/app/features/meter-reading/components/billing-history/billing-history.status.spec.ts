import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { BillingHistoryComponent } from './billing-history';

/**
 * สถานะการชำระเงินต้องยืนยันก่อนเปลี่ยนเสมอ — ชิปสถานะอยู่ติดปุ่มอื่นในแถวเดียวกัน
 * แตะพลาดบนมือถือได้ง่าย และผลของการกดพลาดมีจริงทั้งสองทาง
 */

const bill = (id: number, status: string) => ({
  id,
  billing_month: '08',
  billing_year: '2026',
  total_amount: '450.00',
  payment_status: status,
  member: { id, house_no: `99/${id}`, fname: 'สมชาย', lname: 'ใจดี' }
});

describe('BillingHistoryComponent — ยืนยันก่อนเปลี่ยนสถานะการชำระ', () => {
  let component: BillingHistoryComponent;
  let http: HttpTestingController;

  const statusRequests = () => http.match(r => r.url.endsWith('/status'));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BillingHistoryComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();

    const fixture = TestBed.createComponent(BillingHistoryComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    http.expectOne(r => r.url.endsWith('/bills')).flush([bill(1, 'Pending'), bill(2, 'Paid')]);
    fixture.detectChanges();
  });

  it('กดชิปสถานะเฉย ๆ ยังไม่เปลี่ยนอะไร แค่เปิดหน้าต่างถาม', () => {
    component.askToggleStatus(component.bills[0]);

    expect(component.billToToggle.id).toBe(1);
    expect(component.bills[0].payment_status).toBe('Pending');
    expect(statusRequests().length).toBe(0);
  });

  it('บอกสถานะปลายทางถูกทั้งสองทิศ', () => {
    component.askToggleStatus(component.bills[0]);
    expect(component.toggleTargetStatus).toBe('Paid');

    component.askToggleStatus(component.bills[1]);
    expect(component.toggleTargetStatus).toBe('Pending');
  });

  it('กด "ยังไม่เปลี่ยน" แล้วต้องไม่ยิงอะไรเลย', () => {
    component.askToggleStatus(component.bills[0]);
    component.cancelToggleStatus();

    expect(component.billToToggle).toBeNull();
    expect(statusRequests().length).toBe(0);
  });

  it('ยืนยันแล้วจึงเปลี่ยนจริง และปิดหน้าต่างให้', () => {
    component.askToggleStatus(component.bills[0]);
    component.confirmToggleStatus();

    const req = http.expectOne(r => r.url.endsWith('/bills/1/status'));
    expect(req.request.body).toEqual({ payment_status: 'Paid' });
    req.flush({});

    expect(component.bills[0].payment_status).toBe('Paid');
    expect(component.billToToggle).toBeNull();
    expect(component.isTogglingStatus).toBe(false);
    // ยอดค้างของเดือนนั้นต้องคำนวณใหม่ด้วย ไม่ใช่แค่เปลี่ยนป้าย
    expect(component.billGroups[0].unpaid).toBe(0);
  });

  it('กดยืนยันรัว ๆ ต้องยิงครั้งเดียว', () => {
    component.askToggleStatus(component.bills[0]);
    component.confirmToggleStatus();
    component.confirmToggleStatus();

    expect(statusRequests().length).toBe(1);
  });

  it('เปลี่ยนไม่สำเร็จ → หน้าต่างยังเปิดอยู่ให้กดใหม่ และสถานะเดิมต้องไม่เปลี่ยน', () => {
    component.askToggleStatus(component.bills[0]);
    component.confirmToggleStatus();

    http.expectOne(r => r.url.endsWith('/bills/1/status')).flush(
      { message: 'ผิดพลาด' },
      { status: 500, statusText: 'Server Error' }
    );

    expect(component.bills[0].payment_status).toBe('Pending');
    expect(component.billToToggle.id).toBe(1);
    expect(component.isTogglingStatus).toBe(false);
  });

  it('ระหว่างกำลังยิงห้ามปิดหน้าต่าง — ไม่งั้นจะไม่รู้ว่าเปลี่ยนสำเร็จไหม', () => {
    component.askToggleStatus(component.bills[0]);
    component.confirmToggleStatus();
    component.cancelToggleStatus();

    expect(component.billToToggle.id).toBe(1);
    http.expectOne(r => r.url.endsWith('/bills/1/status')).flush({});
  });
});
