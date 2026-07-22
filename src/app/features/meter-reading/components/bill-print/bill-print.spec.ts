import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BillPrintComponent } from './bill-print';
import { BillPrintService } from '../../services/bill-print.service';

// บิลจำลอง 2 ใบของคนละบ้าน หน้าตาเหมือนที่หลังบ้านส่งมาจริง
const billOf = (id: number, houseNo: string) => ({
  id,
  billing_month: '07',
  billing_year: '2026',
  previous_unit: 10500,
  current_unit: 10524,
  usage_unit: 24,
  price_per_unit: 15,
  total_amount: '360.00',
  payment_status: 'Pending',
  create_date: '2026-07-18T07:00:00.000Z',
  meter_reading: { id, reading_date: '2026-07-17', meter_unit: 10524 },
  member: { id, house_no: houseNo, fname: 'สมชาย', lname: 'ใจดี', phone: '0812345678' }
});

describe('BillPrintComponent', () => {
  let fixture: ComponentFixture<BillPrintComponent>;
  let service: BillPrintService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [BillPrintComponent] }).compileComponents();
    fixture = TestBed.createComponent(BillPrintComponent);
    service = TestBed.inject(BillPrintService);
    fixture.detectChanges();
  });

  it('ยังไม่สั่งพิมพ์ ต้องไม่มีเอกสารค้างอยู่ในหน้า', () => {
    expect(document.querySelectorAll('.slip').length).toBe(0);
    expect(document.querySelectorAll('#bill-print').length).toBe(0);
  });

  it('สั่งพิมพ์หลายใบแล้วต้องมีสลิปครบทุกบิล "ก่อน" ที่ไดอะล็อกพิมพ์จะเปิด', () => {
    let slipsAtPrintTime = -1;
    // จับภาพ DOM ณ วินาทีที่เบราว์เซอร์ถูกสั่งพิมพ์ — จุดที่พลาดแล้วจะได้กระดาษเปล่า
    window.print = () => {
      slipsAtPrintTime = fixture.nativeElement.querySelectorAll('.slip').length;
    };

    service.printMany([billOf(1, '99/1'), billOf(2, '99/2')]);

    expect(slipsAtPrintTime).toBe(2);

    // 🌟 บนมือถือ window.print() ไม่ค้างรอเหมือนบนคอม (บางรุ่นยิง afterprint ทันทีด้วยซ้ำ)
    //    เอกสารจึงต้องค้างอยู่ ห้ามล้างทิ้ง ไม่งั้นหายก่อนถูกพิมพ์ = ได้กระดาษเปล่า
    //    (ไม่กวนผู้ใช้ เพราะถูก display:none ซ่อนบนจออยู่แล้ว)
    expect(fixture.nativeElement.querySelectorAll('.slip').length).toBe(2);
  });

  it('สั่งพิมพ์ชุดใหม่ต้องแทนที่ชุดเก่า ไม่พิมพ์ซ้อนกัน', () => {
    window.print = () => {};

    service.printMany([billOf(1, '99/1'), billOf(2, '99/2')]);
    service.printSingle(billOf(9, '77/7'));

    const html = fixture.nativeElement.innerHTML;
    expect(html).toContain('77/7');
    expect(html).not.toContain('99/1');
    expect(fixture.nativeElement.querySelectorAll('.slip').length).toBe(0);
  });

  it('สั่งพิมพ์ใบเดียวต้องได้ใบเต็มหน้า A4 พร้อมยอดเงินเป็นตัวอักษรไทย', () => {
    let htmlAtPrintTime = '';
    window.print = () => {
      htmlAtPrintTime = fixture.nativeElement.innerHTML;
    };

    service.printSingle(billOf(7, '99/1/2'));

    expect(htmlAtPrintTime).toContain('99/1/2');
    expect(htmlAtPrintTime).toContain('สามร้อยหกสิบบาทถ้วน');
  });

  it('กำหนดชำระต้องเป็นวันที่ 1 ของเดือนถัดจากรอบบิล และข้ามปีได้ถูก', () => {
    const july = service.dueDate({ billing_month: '07', billing_year: '2026' })!;
    expect(july.getDate()).toBe(1);
    expect(service.dateLabel(july)).toBe('1 สิงหาคม 2569');

    // รอบเดือน 12 ต้องข้ามไปเป็น 1 มกราคม ปีถัดไป
    const december = service.dueDate({ billing_month: '12', billing_year: '2026' })!;
    expect(service.dateLabel(december)).toBe('1 มกราคม 2570');
  });

  it('สลิปของแต่ละบ้านต้องแสดงเฉพาะบ้านที่ส่งเข้าไป', () => {
    let htmlAtPrintTime = '';
    window.print = () => {
      htmlAtPrintTime = fixture.nativeElement.innerHTML;
    };

    service.printMany([billOf(5, '42/7')]);

    expect(htmlAtPrintTime).toContain('42/7');
    expect(htmlAtPrintTime).not.toContain('99/1');
  });
});
