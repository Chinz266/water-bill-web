import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BillPrintComponent } from './bill-print';
import { BillPrintService } from '../../services/bill-print.service';

// หมู่บ้านที่หลังบ้าน join มาให้พร้อมบิล (bill.member.village)
// village_no เก็บเป็นเลขล้วน คำว่า "หมู่ที่" เป็นหน้าที่ของหน้าเว็บเติมเอง
const villageOf = () => ({
  id: 7,
  village_name: 'โนนกราด',
  village_no: '1',
  subdistrict: 'หนองบัวศาลา',
  district: 'เมืองนครราชสีมา',
  province: 'นครราชสีมา',
  zip_code: '30000'
});

// บิลจำลอง 2 ใบของคนละบ้าน หน้าตาเหมือนที่หลังบ้านส่งมาจริง
const billOf = (id: number, houseNo: string, village: any = villageOf()) => ({
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
  member: { id, house_no: houseNo, fname: 'สมชาย', lname: 'ใจดี', phone: '0812345678', village }
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

  it('สั่งพิมพ์หลายใบแล้วต้องมีสลิปครบทุกบิลอยู่ในหน้า และค้างไว้จนพิมพ์เสร็จ', () => {
    service.printMany([billOf(1, '99/1'), billOf(2, '99/2')]);

    // เอกสารต้องถูก render ครบตั้งแต่ก่อนสั่งพิมพ์ ไม่งั้นได้กระดาษเปล่า
    expect(fixture.nativeElement.querySelectorAll('.slip').length).toBe(2);

    // ⚠️ ห้ามล้างทันทีหลังสั่งพิมพ์ — บนมือถือคำสั่งพิมพ์คืนค่าก่อนหน้าตัวอย่างจะถูกวาด
    //    ล้างเลยจะได้กระดาษเปล่า ต้องรอ afterprint
    window.dispatchEvent(new Event('afterprint'));
    expect(fixture.nativeElement.querySelectorAll('.slip').length).toBe(0);
  });

  it('สั่งพิมพ์ใบเดียวต้องได้ใบเต็มหน้า A4 พร้อมยอดเงินเป็นตัวอักษรไทย', () => {
    service.printSingle(billOf(7, '99/1/2'));

    const html = fixture.nativeElement.innerHTML;
    expect(html).toContain('99/1/2');
    expect(html).toContain('สามร้อยหกสิบบาทถ้วน');
  });

  it('กำหนดชำระต้องเป็นวันที่ 1 ของเดือนถัดจากรอบบิล และข้ามปีได้ถูก', () => {
    const july = service.dueDate({ billing_month: '07', billing_year: '2026' })!;
    expect(july.getDate()).toBe(1);
    expect(service.dateLabel(july)).toBe('1 สิงหาคม 2569');

    // รอบเดือน 12 ต้องข้ามไปเป็น 1 มกราคม ปีถัดไป
    const december = service.dueDate({ billing_month: '12', billing_year: '2026' })!;
    expect(service.dateLabel(december)).toBe('1 มกราคม 2570');
  });

  // หมู่บ้าน/หมู่ที่/ตำบล/อำเภอ/จังหวัด/รหัสไปรษณีย์ อยู่รวมกันบรรทัดเดียวต่อจากบ้านเลขที่
  it('ใบเต็มหน้าต้องมีที่อยู่เต็มบรรทัดเดียวต่อจากบ้านเลขที่', () => {
    service.printSingle(billOf(9, '99/1'));

    const html = fixture.nativeElement.innerHTML;
    expect(html).toContain(
      'บ้านโนนกราด หมู่ที่ 1 ตำบลหนองบัวศาลา อำเภอเมืองนครราชสีมา จังหวัดนครราชสีมา 30000'
    );
  });

  // ชื่อหมู่บ้านที่กรอกมาพร้อมคำนำหน้าแล้วต้องไม่กลายเป็น 'บ้านบ้านโนนกราด'
  it('ชื่อหมู่บ้านที่มีคำนำหน้าอยู่แล้วต้องไม่โดนเติมซ้ำ', () => {
    service.printSingle(billOf(12, '99/4', { ...villageOf(), village_name: 'บ้านโนนกราด' }));

    expect(fixture.nativeElement.innerHTML).toContain('บ้านโนนกราด หมู่ที่ 1 ตำบล');
    expect(fixture.nativeElement.innerHTML).not.toContain('บ้านบ้าน');
  });

  // บิลของบ้านที่ยังไม่ได้ผูกหมู่บ้าน (หรือบิลเก่าก่อนมีฟีเจอร์นี้) ต้องพิมพ์ได้ตามปกติ
  it('ไม่มีข้อมูลหมู่บ้านต้องไม่พิมพ์คำว่าตำบล/อำเภอค้างไว้เปล่า ๆ', () => {
    service.printSingle(billOf(11, '99/3', null));

    const html = fixture.nativeElement.innerHTML;
    // ทั้งบรรทัดที่อยู่ต้องหายไปเลย ไม่ใช่เหลือหัวข้อกับค่าว่าง
    // (เช็คที่ป้ายชื่อบรรทัด เพราะหัวเอกสารมีคำว่า "ตำบล ....." ของ orgAddress อยู่แล้ว)
    expect(html).not.toContain('<span>ที่อยู่</span>');
    expect(html).not.toContain('ตำบลหนองบัวศาลา');
    // ยังต้องเห็นบิลตามปกติ แค่ไม่มีบรรทัดที่อยู่
    expect(html).toContain('99/3');
  });

  it('สลิปของแต่ละบ้านต้องแสดงเฉพาะบ้านที่ส่งเข้าไป', () => {
    service.printMany([billOf(5, '42/7')]);

    const html = fixture.nativeElement.innerHTML;
    expect(html).toContain('42/7');
    expect(html).not.toContain('99/1');
  });
});
