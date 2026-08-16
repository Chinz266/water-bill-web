import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { MemberListComponent } from './member-list';
import { BillPrintService } from '../../../meter-reading/services/bill-print.service';

/**
 * พิมพ์บิลย้อนหลังจากทะเบียนลูกบ้าน
 *
 * เอกสารต้องเป็นใบเดียวกับที่ออกจากหน้าประวัติบิล (BillPrintService.printSingle)
 * และรอบบิลบนใบนั้นต้องถูก ซึ่งคิดได้ต่อเมื่อทำดัชนีจากบิล "ทั้งกอง" ไม่ใช่เฉพาะบ้านหลังนี้
 */

const bill = (id: number, memberId: number, month: string, year = '2026') => ({
  id,
  billing_month: month,
  billing_year: year,
  usage_unit: 12,
  total_amount: '450.00',
  payment_status: 'Pending',
  member: { id: memberId, house_no: `99/${memberId}` },
  meter_reading: { reading_date: `${year}-${month}-05` }
});

describe('MemberListComponent — พิมพ์บิลย้อนหลังของบ้านหลังเดียว', () => {
  let component: MemberListComponent;
  let http: HttpTestingController;
  let print: BillPrintService;

  const openFor = (memberId: number, bills: any[]) => {
    component.openBills({ id: memberId, house_no: `99/${memberId}`, fname: 'สมชาย', lname: 'ใจดี' });
    http.expectOne(r => r.url.endsWith('/bills')).flush(bills);
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MemberListComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    }).compileComponents();

    const fixture = TestBed.createComponent(MemberListComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    print = TestBed.inject(BillPrintService);
    fixture.detectChanges();

    http.match(r => r.url.endsWith('/member/all')).forEach(r => r.flush([]));
    http.match(r => r.url.endsWith('/villages')).forEach(r => r.flush([]));
  });

  it('เอาเฉพาะบิลของบ้านหลังที่กด ไม่ปนหลังอื่น', () => {
    openFor(1, [bill(1, 1, '07'), bill(2, 2, '07'), bill(3, 1, '08')]);

    expect(component.memberBills.map(b => b.id)).toEqual([3, 1]);
    expect(component.isLoadingBills).toBe(false);
  });

  it('เรียงตามรอบบิล ใหม่สุดขึ้นก่อน — ข้ามปีก็ต้องถูก', () => {
    openFor(1, [bill(1, 1, '02', '2026'), bill(2, 1, '12', '2025'), bill(3, 1, '01', '2026')]);

    expect(component.memberBills.map(b => b.id)).toEqual([1, 3, 2]);
  });

  it('บ้านที่หลังบ้านคืนมาเป็น members_id (ไม่มี member ซ้อน) ก็ต้องเจอ', () => {
    const flat = { ...bill(5, 0, '08'), member: undefined, members_id: 1 };
    openFor(1, [flat, bill(6, 2, '08')]);

    expect(component.memberBills.map(b => b.id)).toEqual([5]);
  });

  it('ทำดัชนีรอบจากบิลทั้งกอง ไม่ใช่เฉพาะของบ้านหลังนี้', () => {
    // ใบ ก.ค. ของบ้านหลังเดียวกันคือตัวที่บอกว่ารอบ ส.ค. เริ่มวันไหน
    openFor(1, [bill(1, 1, '07'), bill(3, 1, '08'), bill(2, 2, '07')]);

    expect(print.cycleOf(component.memberBills[0])).not.toBeNull();
  });

  it('พิมพ์แล้วต้องเป็นใบ A4 ตัวเดียวกับหน้าประวัติบิล', () => {
    openFor(1, [bill(1, 1, '08')]);
    component.printBill(component.memberBills[0]);

    expect(print.billToPrint()?.id).toBe(1);
  });

  it('ดึงบิลไม่สำเร็จ → บอกให้ลองใหม่ ไม่ใช่ขึ้นว่าไม่มีบิล', () => {
    component.openBills({ id: 1, house_no: '99/1' });
    http.expectOne(r => r.url.endsWith('/bills')).flush(
      { message: 'ผิดพลาด' },
      { status: 500, statusText: 'Server Error' }
    );

    expect(component.billsLoadFailed).toBe(true);
    expect(component.isLoadingBills).toBe(false);
    expect(component.memberBills).toEqual([]);
  });

  it('เปิดบ้านหลังใหม่ต้องไม่ค้างบิลของหลังก่อนหน้า', () => {
    openFor(1, [bill(1, 1, '08')]);
    openFor(2, [bill(1, 1, '08'), bill(2, 2, '08')]);

    expect(component.memberBills.map(b => b.id)).toEqual([2]);
  });
});
