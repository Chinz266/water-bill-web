import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { BillingHistoryComponent } from './billing-history';
import { AuthService } from '../../../auth/services/auth.service';

/**
 * โหมดแก้ไขเลขมิเตอร์ — ยอดที่แก้แล้วคือเงินที่ลูกบ้านต้องจ่ายจริง
 *
 * เทสต์ชุดนี้ล็อกไว้ 3 อย่างที่พังแล้วไม่มีใครเห็น:
 *   1. บิลที่จ่ายเงินแล้วต้องแก้ไม่ได้ — ยอดที่จ่ายรวมบิลค้างเก่าที่ถูกปิดไปพร้อมกัน
 *      แก้ทีหลังจะได้บัญชีที่ไม่ตรงกับเงินสดในมือ
 *   2. หน้าเว็บไม่ส่ง usage_unit / total_amount ไปเอง — หลังบ้านคิดใหม่ทั้งหมด
 *      ยอดสองฝั่งเพี้ยนกันเมื่อไหร่ คนจะเชื่อตัวเลขบนจอที่ผิด
 *   3. ธง confirm_* ไม่ถูกส่งเป็น true เอง ต้องโดนหลังบ้านตีกลับแล้วให้คนกดยืนยันก่อน
 */

const today = new Date().toISOString();

const bill = (id: number, status: string, readingDate: string) => ({
  id,
  billing_month: '08',
  billing_year: '2026',
  total_amount: '450.00',
  payment_status: status,
  create_date: readingDate,
  meter_reading: { id: id * 10, meter_unit: 1250, reading_date: readingDate },
  member: { id, house_no: `99/${id}`, fname: 'สมชาย', lname: 'ใจดี' }
});

describe('BillingHistoryComponent — แก้ไขเลขมิเตอร์', () => {
  let component: BillingHistoryComponent;
  let http: HttpTestingController;
  let auth: AuthService;

  const editRequests = () => http.match(r => r.url.endsWith('/reading'));

  beforeEach(async () => {
    // AuthService อ่านเซสชันจาก localStorage ตอนถูกสร้าง จึงต้องวางไว้ก่อน TestBed
    localStorage.setItem('water-bill.admin', JSON.stringify({
      id: 9, role: 'admin', fname: 'เจ้าหน้าที่', lname: 'จดมิเตอร์'
    }));
    localStorage.setItem('water-bill.token', 'test-token');

    await TestBed.configureTestingModule({
      imports: [BillingHistoryComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();

    const fixture = TestBed.createComponent(BillingHistoryComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    fixture.detectChanges();

    http.expectOne(r => r.url.endsWith('/bills')).flush([
      bill(1, 'Pending', today),
      bill(2, 'Paid', today)
    ]);
    fixture.detectChanges();
  });

  afterEach(() => localStorage.clear());

  const asStaff = () => auth.patchUser({ admin_role: 'staff' });
  const asOwner = () => auth.patchUser({ admin_role: 'owner' });

  it('บิลที่ชำระแล้วแก้ไม่ได้ ถึงจะเป็นผู้ดูแลก็ตาม', () => {
    asOwner();

    expect(component.canEdit(component.bills[1])).toBe(false);
    // กดฝืนก็ต้องไม่เปิดหน้าต่างให้
    component.openEdit(component.bills[1]);
    expect(component.editBill).toBeNull();
  });

  it('เจ้าหน้าที่จดมิเตอร์แก้ของเก่าที่ค้างชำระได้ แต่ของเก่าที่ปิดไปแล้วไม่ได้', () => {
    asStaff();
    const lastMonth = new Date(Date.now() - 30 * 86_400_000).toISOString();

    expect(component.canEdit({ ...bill(3, 'Pending', lastMonth) })).toBe(true);
    expect(component.canEdit({ ...bill(4, 'Paid', lastMonth) })).toBe(false);
    // จดวันนี้ยังแก้ได้เสมอ แม้สถานะจะเป็นอย่างอื่น
    expect(component.canEdit({ ...bill(5, 'Overdue', today) })).toBe(true);
  });

  it('บัญชีที่ไม่มี admin_role ถือเป็นสิทธิ์น้อย ไม่ใช่ผู้ดูแล', () => {
    // บัญชีที่ออกก่อนมีคอลัมน์นี้ — เดาให้เป็นผู้ดูแลไม่ได้เด็ดขาด
    expect(auth.isOwner()).toBe(false);
    const lastMonth = new Date(Date.now() - 30 * 86_400_000).toISOString();
    expect(component.canEdit({ ...bill(6, 'Paid', lastMonth) })).toBe(false);
  });

  it('ไม่กรอกเหตุผลแล้วต้องไม่ยิงอะไรออกไป — log ที่ไม่มีเหตุผลตอบไม่ได้ว่าทำไมยอดเปลี่ยน', () => {
    asOwner();
    component.openEdit(component.bills[0]);
    component.editUnit = 1300;
    component.editReason = '  ';
    component.saveEdit();

    expect(editRequests().length).toBe(0);
    expect(component.isSavingEdit).toBe(false);
  });

  it('ส่งแค่เลขใหม่กับเหตุผล ไม่ส่งยอดเงินที่คิดเอง', () => {
    asOwner();
    component.openEdit(component.bills[0]);
    component.editUnit = 1300;
    component.editReason = 'จดเลขสลับหลัก';
    component.saveEdit();

    const req = http.expectOne(r => r.url.endsWith('/bills/1/reading'));
    const body = req.request.body as FormData;

    expect(req.request.method).toBe('PATCH');
    expect(body.get('current_unit')).toBe('1300');
    expect(body.get('reason')).toBe('จดเลขสลับหลัก');
    expect(body.get('usage_unit')).toBeNull();
    expect(body.get('total_amount')).toBeNull();
    // ยังไม่โดนตีกลับ = ยังไม่มีใครกดยืนยันอะไร ธงต้องไม่ติดไปเอง
    expect(body.get('confirm_high_usage')).toBeNull();
    expect(body.get('confirm_meter_reset')).toBeNull();

    req.flush({ usage_unit: 50, total_amount: 750 });
    expect(component.editBill).toBeNull();
  });

  it('โดนด่านหน่วยพุ่งตีกลับ → หน้าต่างยังเปิดให้ยืนยัน แล้วรอบสองถึงจะติดธงไปด้วย', () => {
    asOwner();
    component.openEdit(component.bills[0]);
    component.editUnit = 9999;
    component.editReason = 'อ่านหน้าปัดใหม่แล้วเป็นเลขนี้';
    component.saveEdit();

    http.expectOne(r => r.url.endsWith('/bills/1/reading')).flush(
      { message: 'หน่วยน้ำสูงกว่าค่าเฉลี่ยเกิน 3 เท่า', code: 'high_usage' },
      { status: 400, statusText: 'Bad Request' }
    );

    // ยังไม่ปิดหน้าต่าง คนต้องได้อ่านคำเตือนก่อนตัดสินใจ
    expect(component.editBill.id).toBe(1);
    expect(component.editBlocker).toBe('high_usage');

    component.saveEdit();
    const second = http.expectOne(r => r.url.endsWith('/bills/1/reading'));
    expect((second.request.body as FormData).get('confirm_high_usage')).toBe('true');
    second.flush({ usage_unit: 8749, total_amount: 131235 });
  });

  it('ยิงซ้ำระหว่างกำลังบันทึกต้องออกไปครั้งเดียว', () => {
    asOwner();
    component.openEdit(component.bills[0]);
    component.editUnit = 1300;
    component.editReason = 'จดเลขสลับหลัก';
    component.saveEdit();
    component.saveEdit();

    expect(editRequests().length).toBe(1);
  });

  it('เปิดดูรายละเอียดแล้วดึงประวัติการแก้ของใบนั้นมาโชว์', () => {
    component.openDetail(component.bills[0]);

    const req = http.expectOne(r => r.url.includes('/audit/reading-logs'));
    expect(req.request.url).toContain('bills_id=1');
    req.flush([
      { id: 1, meter_readings_id: 10, bills_id: 1, old_unit: '1200', new_unit: '1250',
        old_total_amount: '300.00', new_total_amount: '450.00', old_photo_path: null,
        new_photo_path: null, reason: 'จดเลขสลับหลัก', edited_by: 1, edited_role: 'owner',
        edited_at: today, editor: { id: 1, fname: 'ผู้ใหญ่บ้าน', lname: 'ใจดี' } }
    ]);

    expect(component.editLogs.length).toBe(1);
    expect(component.logUnit(component.editLogs[0].old_unit)).toBe('1200');
    expect(component.editorName(component.editLogs[0])).toBe('ผู้ใหญ่บ้าน ใจดี');
  });

  it('ดึงประวัติการแก้ไม่ได้ ก็ไม่บังหน้ารายละเอียดที่เหลือ', () => {
    component.openDetail(component.bills[0]);
    http.expectOne(r => r.url.includes('/audit/reading-logs')).flush(
      { message: 'ผิดพลาด' },
      { status: 500, statusText: 'Server Error' }
    );

    expect(component.editLogs).toEqual([]);
    expect(component.selectedBill.id).toBe(1);
  });
});
