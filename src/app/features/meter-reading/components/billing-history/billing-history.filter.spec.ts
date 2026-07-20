import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { BillingHistoryComponent } from './billing-history';

const bill = (id: number, houseNo: string, owner: string, month: string, year = '2026') => ({
  id,
  billing_month: month,
  billing_year: year,
  previous_unit: 100,
  current_unit: 130,
  usage_unit: 30,
  price_per_unit: 15,
  total_amount: '450.00',
  payment_status: id % 2 === 0 ? 'Paid' : 'Pending',
  create_date: `${year}-${month}-18T07:00:00.000Z`,
  member: { id, house_no: houseNo, fname: owner, lname: 'ใจดี', phone: '0812345678' }
});

describe('BillingHistoryComponent — เลือกเดือนและค้นหา', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<BillingHistoryComponent>>;
  let component: BillingHistoryComponent;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BillingHistoryComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();

    fixture = TestBed.createComponent(BillingHistoryComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    // บิล 3 เดือน: มิ.ย. 1 ใบ, ก.ค. 2 ใบ, ส.ค. 1 ใบ
    http.expectOne(r => r.url.endsWith('/bills')).flush([
      bill(1, '99/1', 'สมชาย', '06'),
      bill(2, '99/2', 'สมหญิง', '07'),
      bill(3, '47/1', 'วรพล', '07'),
      bill(4, '99/3', 'สมศักดิ์', '08')
    ]);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('เปิดหน้ามาต้องเลือกเดือนล่าสุดให้เอง ไม่ต้องกดอะไร', () => {
    expect(component.selectedMonthKey).toBe('2026-08');
    expect(component.selectedGroup?.label).toBe('สิงหาคม 2569');
    expect(component.visibleBills.length).toBe(1);
  });

  it('เลือกเดือนแล้วต้องเห็นเฉพาะบิลของเดือนนั้น', () => {
    component.selectedMonthKey = '2026-07';
    expect(component.visibleBills.length).toBe(2);
    expect(component.visibleBills.map(b => b.member.house_no).sort()).toEqual(['47/1', '99/2']);
  });

  it('ตัวเลือกเดือนต้องเรียงจากล่าสุดลงไป และมีครบทุกเดือนที่มีบิล', () => {
    expect(component.billGroups.map(g => g.key)).toEqual(['2026-08', '2026-07', '2026-06']);
  });

  it('ค้นหาด้วยบ้านเลขที่ ต้องเจอเฉพาะในเดือนที่ดูอยู่', () => {
    component.selectedMonthKey = '2026-07';
    component.searchTerm = '47';
    expect(component.visibleBills.length).toBe(1);
    expect(component.visibleBills[0].member.house_no).toBe('47/1');
  });

  it('ค้นหาด้วยชื่อเจ้าของบ้านก็ต้องเจอ', () => {
    component.selectedMonthKey = '2026-07';
    component.searchTerm = 'วรพล';
    expect(component.visibleBills.length).toBe(1);
  });

  it('ค้นหาไม่เจอต้องได้ผลลัพธ์ว่าง (หน้าจะขึ้นข้อความให้ลองใหม่)', () => {
    component.searchTerm = 'ไม่มีบ้านนี้';
    expect(component.visibleBills.length).toBe(0);
  });

  it('ยอดรวมและจำนวนค้างชำระต้องเป็นของเดือนที่เลือกเท่านั้น', () => {
    component.selectedMonthKey = '2026-07';
    const group = component.selectedGroup!;
    expect(group.total).toBe(900);   // 450 x 2 ใบ
    expect(group.unpaid).toBe(1);    // id 3 เป็น Pending, id 2 เป็น Paid
  });
});
