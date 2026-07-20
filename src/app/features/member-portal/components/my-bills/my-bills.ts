import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
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
  imports: [CommonModule, FormsModule],
  templateUrl: './my-bills.html',
  styleUrls: ['./my-bills.css']
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
  isLoading = true;

  // ดูแลหลายบ้าน → เลือกดูทีละหลังได้ ('' = ทุกหลัง)
  selectedHouseId: number | '' = '';

  // บิลที่เปิดดูรายละเอียดเต็ม
  selectedBill: any = null;

  ngOnInit(): void {
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

  /** บิลตามบ้านที่เลือก (ค่าว่าง = ทุกหลัง) */
  get visibleBills(): any[] {
    if (this.selectedHouseId === '') return this.bills;
    return this.bills.filter((bill) => bill.member?.id === Number(this.selectedHouseId));
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

  openDetail(bill: any): void {
    this.selectedBill = bill;
  }

  closeDetail(): void {
    this.selectedBill = null;
  }

  printBill(bill: any): void {
    this.print.printSingle(bill);
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
