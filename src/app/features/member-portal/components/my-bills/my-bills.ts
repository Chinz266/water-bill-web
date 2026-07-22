import { ChangeDetectorRef, Component, OnInit, inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { toast } from 'ngx-sonner';
import { MemberPortalService } from '../../services/member-portal.service';
import { AuthService } from '../../../auth/services/auth.service';
import { extractErrorMessage } from '../../../auth/services/auth-error';
import { BillPrintService } from '../../../meter-reading/services/bill-print.service';

/**
 * หน้าเดียวของฝั่งลูกบ้าน — ดูบิลบ้านตัวเอง (ทุกหลังที่บัญชีนี้ดูแล)
 * อ่านอย่างเดียว: เปลี่ยนสถานะ/ลบบิลทำไม่ได้ นั่นเป็นงานของเจ้าหน้าที่
 */
@Component({
  selector: 'app-my-bills',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './my-bills.html',
  styleUrls: ['../../portal-shared.css', './my-bills.css']
})
export class MyBillsComponent implements OnInit {
  private portal = inject(MemberPortalService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private print = inject(BillPrintService);
  private cdr = inject(ChangeDetectorRef);

  readonly displayName = this.auth.displayName;

  bills: any[] = [];
  houses: any[] = [];
  admins: any[] = [];
  isLoading = true;

  // ดูแลหลายบ้าน → เลือกดูทีละหลังได้ ('' = ทุกหลัง)
  selectedHouseId: number | '' = '';

  // เลือกดูบิลทีละเดือนได้ ('' = ทุกเดือน)
  selectedMonthKey: string = '';

  // บิลที่เปิดดูรายละเอียดเต็ม
  selectedBill: any = null;

  // ตอน prerender (SSR) ยังไม่มี token ใน localStorage ยิง API ไปก็ได้ 401 เปล่า ๆ
  // ต้องข้ามไปก่อน แล้วให้ฝั่ง browser โหลดจริง ไม่งั้น build จะพังตอน prerender
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  ngOnInit(): void {
    if (!this.isBrowser) return;

    this.loadData();
  }

  loadData(): void {
    this.isLoading = true;

    this.portal.getMyHouses().subscribe({
      next: (houses) => {
        this.houses = houses ?? [];
        this.cdr.detectChanges();
      },
      error: (err) => console.error('โหลดรายชื่อบ้านไม่สำเร็จ:', err)
    });

    this.portal.getAdmins().subscribe({
      next: (admins) => {
        // เอาเฉพาะผู้ดูแลที่มีเบอร์โทรให้ติดต่อได้
        this.admins = (admins ?? []).filter((a) => a.phone);
        this.cdr.detectChanges();
      },
      error: (err) => console.error('โหลดข้อมูลผู้ดูแลไม่สำเร็จ:', err)
    });

    this.portal.getMyBills().subscribe({
      next: (bills) => {
        this.bills = bills ?? [];
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('โหลดบิลไม่สำเร็จ:', err);
        this.isLoading = false;
        this.cdr.detectChanges();
        toast.error(extractErrorMessage(err, 'โหลดบิลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), { id: 'my-bills-error' });
      }
    });
  }

  private monthKey(bill: any): string {
    return `${bill.billing_year}-${bill.billing_month}`;
  }

  /** เดือนทั้งหมดที่มีบิล (ใหม่สุดก่อน ตามลำดับที่หลังบ้านส่งมา) ไว้ทำ dropdown เลือกเดือน */
  get monthOptions(): { key: string; label: string; count: number }[] {
    const options: { key: string; label: string; count: number }[] = [];
    for (const bill of this.bills) {
      const key = this.monthKey(bill);
      const existing = options.find((o) => o.key === key);
      if (existing) {
        existing.count++;
      } else {
        options.push({ key, label: this.monthLabel(bill.billing_month, bill.billing_year), count: 1 });
      }
    }
    return options;
  }

  /** บิลตามบ้านและเดือนที่เลือก (ค่าว่าง = ทั้งหมด) */
  get visibleBills(): any[] {
    let bills = this.bills;
    if (this.selectedHouseId !== '') {
      bills = bills.filter((bill) => bill.member?.id === Number(this.selectedHouseId));
    }
    if (this.selectedMonthKey !== '') {
      bills = bills.filter((bill) => this.monthKey(bill) === this.selectedMonthKey);
    }
    return bills;
  }

  /** บิลล่าสุดที่ยังไม่ชำระ — เอาไว้ชูเป็นการ์ดเด่นบนสุด */
  get latestUnpaid(): any | null {
    return this.visibleBills.find((bill) => bill.payment_status !== 'Paid') ?? null;
  }

  /** ยอดค้างชำระรวมทุกใบของบ้านที่เลือกอยู่ */
  get unpaidTotal(): number {
    return this.visibleBills
      .filter((bill) => bill.payment_status !== 'Paid')
      .reduce((sum, bill) => sum + (Number(bill.total_amount) || 0), 0);
  }

  get unpaidCount(): number {
    return this.visibleBills.filter((bill) => bill.payment_status !== 'Paid').length;
  }

  /**
   * ชื่อที่ใช้ทักทาย — บัญชีลูกบ้านไม่มีชื่อ (ล็อกอินด้วยเบอร์) เลยหยิบชื่อเจ้าของบ้านมาแทน
   * ถ้ากำลังเลือกดูบ้านหลังไหนอยู่ ใช้ชื่อเจ้าของหลังนั้น ไม่งั้นใช้หลังแรก
   * ระหว่างที่รายชื่อบ้านยังโหลดไม่เสร็จ ค่อยถอยไปใช้เบอร์โทรตามเดิม
   */
  get greetingName(): string {
    const house =
      this.houses.find((h) => h.id === Number(this.selectedHouseId)) ?? this.houses[0];
    const name = house ? `${house.fname ?? ''} ${house.lname ?? ''}`.trim() : '';
    // เติม "คุณ" เฉพาะตอนได้ชื่อจริง — ถ้ายังโหลดไม่เสร็จจะเป็นเบอร์โทร ไม่ควรกลายเป็น "คุณ08x..."
    return name ? `คุณ${name}` : this.displayName();
  }

  /** ชื่อหมู่บ้านของบ้านที่บัญชีนี้ดูแล (ปกติมีหมู่บ้านเดียว ถ้าหลายที่ก็คั่นด้วยจุด) */
  get villageName(): string {
    const names = this.houses
      .map((house) => house.village?.village_name)
      .filter((name: string | null | undefined): name is string => !!name);
    return [...new Set(names)].join(' · ');
  }

  /** ชื่อผู้ดูแลแบบเต็ม — ถ้าไม่มีชื่อใช้คำว่า "ผู้ดูแลระบบ" แทน */
  adminName(admin: any): string {
    const name = `${admin?.fname ?? ''} ${admin?.lname ?? ''}`.trim();
    return name || 'ผู้ดูแลระบบ';
  }

  openDetail(bill: any): void {
    this.selectedBill = bill;
  }

  closeDetail(): void {
    this.selectedBill = null;
  }

  onLogout(): void {
    this.auth.logout();
    toast.success('ออกจากระบบแล้ว', { id: 'logout-success' });
    this.router.navigateByUrl('/member/login');
  }

  // ข้อความ/รูปแบบใช้ตัวเดียวกับเอกสารพิมพ์ (BillPrintService) ให้ตรงกันทุกจุด
  statusLabel(status: string): string {
    return this.print.statusLabel(status);
  }

  monthLabel(month: string | number, year: string | number): string {
    return this.print.monthLabel(month, year);
  }

  dateLabel(value: string | Date | null | undefined): string {
    return this.print.dateLabel(value);
  }

  dueDate(bill: any): Date | null {
    return this.print.dueDate(bill);
  }
}
