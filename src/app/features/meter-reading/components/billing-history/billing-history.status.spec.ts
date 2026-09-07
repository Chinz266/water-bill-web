import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { BillingHistoryComponent } from './billing-history';

/**
 * สถานะการชำระเงินต้องยืนยันก่อนเปลี่ยนเสมอ — ชิปสถานะอยู่ติดปุ่มอื่นในแถวเดียวกัน
 * แตะพลาดบนมือถือได้ง่าย และผลของการกดพลาดมีจริงทั้งสองทาง
 *
 * ⚠️ สองทิศทางเดินคนละ endpoint โดยตั้งใจ:
 *   - รับเงิน (→ Paid)  ยิง POST /bills/:id/pay   — ปิดบิลค้างเก่าที่ถูกทบยอดให้ทั้งชุด
 *   - แก้ที่กดผิด (→ Pending) ยิง PATCH /bills/:id/status — เป็นการแก้ข้อมูล ไม่ใช่ธุรกรรม
 *
 * ถ้าใช้ /status รับเงิน ใบเก่าที่ถูกทบจะยังค้าง แล้วบิลเดือนหน้าทบยอดเดิมเข้าไปอีกรอบ
 * = เก็บเงินซ้ำจากก้อนที่ลูกบ้านจ่ายไปแล้ว
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

  /** คำขอที่ "เปลี่ยนสถานะเงิน" ไม่ว่าทางไหน — ใช้ยืนยันว่ายังไม่มีอะไรถูกยิงออกไป */
  const statusRequests = () =>
    http.match(r => r.url.endsWith('/status') || r.url.endsWith('/pay'));

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

  it('ยืนยันรับเงินแล้วยิง /pay และปิดหน้าต่างให้', () => {
    component.askToggleStatus(component.bills[0]);
    component.confirmToggleStatus();

    const req = http.expectOne(r => r.url.endsWith('/bills/1/pay'));
    req.flush({ paid_amount: 450, settled_bill_ids: [] });

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

    http.expectOne(r => r.url.endsWith('/bills/1/pay')).flush(
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
    http.expectOne(r => r.url.endsWith('/bills/1/pay')).flush({});
  });

  it('กดกลับเป็น "รอชำระเงิน" ยังใช้ /status ตามเดิม — เป็นการแก้ที่กดผิด ไม่ใช่รับเงิน', () => {
    component.askToggleStatus(component.bills[1]); // ใบที่ Paid อยู่
    component.confirmToggleStatus();

    const req = http.expectOne(r => r.url.endsWith('/bills/2/status'));
    expect(req.request.body).toEqual({ payment_status: 'Pending' });
    req.flush({});

    expect(component.bills[1].payment_status).toBe('Pending');
  });

  it('รับเงินใบที่ทบยอดค้างมา → ปิดใบเก่าที่หลังบ้านเคลียร์ให้บนจอด้วย', () => {
    // ใบเก่าที่ค้างอยู่ต้องเปลี่ยนเป็น Paid บนจอด้วย ไม่งั้นตารางจะโชว์ว่ายังค้าง
    // ทั้งที่ปิดไปแล้ว แล้วมีคนไปกดรับเงินซ้ำอีกใบ
    component.bills.push({ ...bill(7, 'Overdue'), billing_month: '07' });
    component.askToggleStatus(component.bills[0]);
    component.confirmToggleStatus();

    http
      .expectOne(r => r.url.endsWith('/bills/1/pay'))
      .flush({ paid_amount: 900, settled_bill_ids: [7] });

    expect(component.bills.find(b => b.id === 7)?.payment_status).toBe('Paid');
  });

  it('ยอดที่ต้องเก็บใช้ grand_total ไม่ใช่ค่าน้ำเดือนนี้', () => {
    const withArrears = { ...bill(9, 'Pending'), total_amount: '450.00', arrears_amount: '300.00', grand_total: '750.00' };

    expect(component.payable(withArrears)).toBe(750);
    expect(component.arrears(withArrears)).toBe(300);
    expect(component.hasArrears(withArrears)).toBe(true);

    // บิลเก่าก่อนมีระบบทบยอด (ไม่มี grand_total) ต้องถอยไปใช้ total_amount
    expect(component.payable(bill(1, 'Pending'))).toBe(450);
    expect(component.hasArrears(bill(1, 'Pending'))).toBe(false);
  });
});
