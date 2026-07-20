import { Component, OnInit, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { toast } from 'ngx-sonner';
import { MeterReadingService } from '../../services/meter-reading.service';
import { extractErrorMessage } from '../../../auth/services/auth-error';
import { BillPrintService } from '../../services/bill-print.service';

@Component({
  selector: 'app-billing-history',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './billing-history.html',
  styleUrls: ['./billing-history.css']
})
export class BillingHistoryComponent implements OnInit {
  private print = inject(BillPrintService);

  bills: any[] = [];
  isLoading = true;
  isFetching = false;

  // 🌟 บิลที่กำลังจะลบ — ใช้เปิดหน้าต่างยืนยันก่อนลบจริง
  billToDelete: any = null;

  // 🌟 บิลที่กำลังเปิดดูรายละเอียดเต็ม (ข้อมูลลูกบ้าน + การจดมิเตอร์ + การคิดเงิน)
  selectedBill: any = null;

  openDetail(bill: any) {
    this.selectedBill = bill;
  }

  closeDetail() {
    this.selectedBill = null;
  }


  // สั่งพิมพ์ผ่านศูนย์กลาง เอกสารถูก render ที่ <app-bill-print> ใน app.html
  printSingleBill(bill: any): void {
    this.print.printSingle(bill);
  }

  printBills(bills: any[]): void {
    this.print.printMany(bills);
  }



  constructor(
    private meterReadingService: MeterReadingService,
    private cdr: ChangeDetectorRef
  ) { }

  // ข้อความ/รูปแบบทั้งหมดใช้ตัวเดียวกับที่พิมพ์ลงกระดาษ (ดู BillPrintService)
  statusLabel(status: string): string {
    return this.print.statusLabel(status);
  }

  ownerName(bill: any): string {
    return this.print.ownerName(bill);
  }

  monthLabel(month: string | number, year: string | number): string {
    return this.print.monthLabel(month, year);
  }

  bahtText(amount: number): string {
    return this.print.bahtText(amount);
  }

  dueDate(bill: any): Date | null {
    return this.print.dueDate(bill);
  }

  dateLabel(value: string | Date | null | undefined): string {
    return this.print.dateLabel(value);
  }

  // ==========================================
  // จัดบิลเป็นกลุ่มตามเดือน (เดือนล่าสุดอยู่บนสุด)
  // ==========================================
  billGroups: any[] = [];

  // เดือนที่กำลังดูอยู่ และคำค้นหาบ้าน/ชื่อเจ้าของ
  selectedMonthKey = '';
  searchTerm = '';

  // กลุ่มของเดือนที่เลือกอยู่
  get selectedGroup(): any | null {
    return this.billGroups.find(g => g.key === this.selectedMonthKey) ?? null;
  }

  // บิลที่จะแสดงจริง = เฉพาะเดือนที่เลือก แล้วกรองด้วยคำค้นหาอีกชั้น
  get visibleBills(): any[] {
    const bills: any[] = this.selectedGroup?.bills ?? [];
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) return bills;

    return bills.filter(bill =>
      String(bill.member?.house_no ?? '').toLowerCase().includes(term) ||
      this.ownerName(bill).toLowerCase().includes(term)
    );
  }


  // รวมบิลเป็นกลุ่มรายเดือน พร้อมยอดรวมและจำนวนที่ยังไม่ชำระของเดือนนั้น
  private buildBillGroups(): void {
    const groups = new Map<string, any>();

    for (const bill of this.bills) {
      const month = String(bill.billing_month ?? '').padStart(2, '0');
      const year = String(bill.billing_year ?? '');
      const key = `${year}-${month}`;

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label: this.monthLabel(bill.billing_month, bill.billing_year),
          bills: [],
          total: 0,
          unpaid: 0
        });
      }

      const group = groups.get(key);
      group.bills.push(bill);
      group.total += Number(bill.total_amount) || 0;
      if (bill.payment_status !== 'Paid') group.unpaid++;
    }

    // เรียงเดือนล่าสุดขึ้นก่อน
    this.billGroups = [...groups.values()].sort((a, b) => b.key.localeCompare(a.key));

    // เปิดหน้ามาให้เห็นเดือนล่าสุดเลย (หรือถ้าเดือนที่ดูอยู่หายไปแล้วก็เด้งกลับมาเดือนล่าสุด)
    if (!this.billGroups.some(g => g.key === this.selectedMonthKey)) {
      this.selectedMonthKey = this.billGroups[0]?.key ?? '';
    }
  }

  toggleStatus(bill: any) {
    const newStatus = bill.payment_status === 'Pending' ? 'Paid' : 'Pending';
    this.meterReadingService.updatePaymentStatus(bill.id, newStatus).subscribe({
      next: () => {
        bill.payment_status = newStatus;
        this.buildBillGroups(); // ยอดค้างชำระของเดือนนั้นเปลี่ยน ต้องคำนวณใหม่
        this.cdr.detectChanges();
        toast.success(
          newStatus === 'Paid' ? 'เปลี่ยนเป็น "ชำระแล้ว" เรียบร้อย' : 'เปลี่ยนเป็น "รอชำระเงิน" เรียบร้อย',
          { id: 'status-updated' }
        );
      },
      error: (err) => {
        console.error('Update status error:', err);
        toast.error(extractErrorMessage(err, 'เปลี่ยนสถานะไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), { id: 'status-error' });
      }
    });
  }

  // 🌟 ปรับ ngOnInit ให้เรียกตรงๆ ไม่ต้องใช้ setTimeout ป้องกันปัญหา Scope หลุด
  ngOnInit(): void {
    this.loadBillingHistory();
  }

  loadBillingHistory() {
    if (this.isFetching) return;

    this.isFetching = true;
    this.isLoading = true;

    this.meterReadingService.getBills().subscribe({
      next: (data) => {
        this.bills = data;
        this.buildBillGroups(); // จัดกลุ่มรายเดือนใหม่ทุกครั้งที่โหลดข้อมูล
        this.isLoading = false;
        this.isFetching = false;

        // 🌟 ใส่เครื่องหมาย ? ดักไว้ (Optional Chaining) ป้องกันระเบิด
        this.cdr?.detectChanges();
      },
      error: (err) => {
        console.error('Fetch history error:', err);
        this.isLoading = false;
        this.isFetching = false;

        // 🌟 ใส่เครื่องหมาย ? ดักไว้เช่นกันครับ
        this.cdr?.detectChanges();
        toast.error(extractErrorMessage(err, 'ดึงประวัติบิลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), { id: 'history-error' });
      }
    });
  }

  // --- 🗑️ ถามยืนยันก่อนลบ (แทน confirm() ของเบราว์เซอร์) ---
  askDelete(bill: any) {
    this.billToDelete = bill;
  }

  cancelDelete() {
    this.billToDelete = null;
  }

  confirmDelete() {
    if (!this.billToDelete) return;

    const id = this.billToDelete.id;
    this.billToDelete = null;
    this.deleteBill(id);
  }

  // 🌟 ฟังก์ชันลบข้อมูล
  deleteBill(id: number) {
    this.meterReadingService.deleteBill(id).subscribe({
      next: () => {
        toast.success('ลบบิลเรียบร้อยแล้ว', { id: 'delete-success' });
        // พอลบสำเร็จ ก็สั่งโหลดข้อมูลใหม่ให้หน้าจอตารางรีเฟรชทันที
        this.loadBillingHistory();
      },
      error: (err) => {
        console.error('Delete error:', err);
        this.cdr?.detectChanges();
        toast.error(extractErrorMessage(err, 'ลบข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), { id: 'delete-error' });
      }
    });
  }
}
