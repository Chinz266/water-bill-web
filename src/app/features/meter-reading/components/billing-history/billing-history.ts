import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { toast } from 'ngx-sonner';
import { MeterReadingService } from '../../services/meter-reading.service';

@Component({
  selector: 'app-billing-history',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './billing-history.html',
  styleUrls: ['./billing-history.css']
})
export class BillingHistoryComponent implements OnInit {
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

  // ชื่อเจ้าของบ้านแบบเต็ม (บางบิลอาจไม่มีข้อมูลลูกบ้านผูกไว้)
  ownerName(bill: any): string {
    const member = bill?.member;
    if (!member) return 'ไม่พบข้อมูลลูกบ้าน';
    return `${member.fname ?? ''} ${member.lname ?? ''}`.trim() || 'ไม่ระบุชื่อ';
  }

  constructor(
    private meterReadingService: MeterReadingService,
    private cdr: ChangeDetectorRef
  ) { }

  // แปลงสถานะจากหลังบ้านเป็นข้อความไทยที่คนอ่านเข้าใจทันที
  statusLabel(status: string): string {
    return status === 'Paid' ? 'ชำระแล้ว' : 'รอชำระเงิน';
  }

  toggleStatus(bill: any) {
    const newStatus = bill.payment_status === 'Pending' ? 'Paid' : 'Pending';
    this.meterReadingService.updatePaymentStatus(bill.id, newStatus).subscribe({
      next: () => {
        bill.payment_status = newStatus;
        this.cdr.detectChanges();
        toast.success(
          newStatus === 'Paid' ? 'เปลี่ยนเป็น "ชำระแล้ว" เรียบร้อย' : 'เปลี่ยนเป็น "รอชำระเงิน" เรียบร้อย',
          { id: 'status-updated' }
        );
      },
      error: (err) => {
        console.error('Update status error:', err);
        toast.error('เปลี่ยนสถานะไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', { id: 'status-error' });
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
        toast.error('ดึงประวัติบิลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', { id: 'history-error' });
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
        toast.error('ลบข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', { id: 'delete-error' });
      }
    });
  }
}
