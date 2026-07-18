import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { toast } from 'ngx-sonner';
import { MeterReadingService } from '../../services/meter-reading.service';
import { extractErrorMessage } from '../../../auth/services/auth-error';

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

  // เปิดไดอะล็อกพิมพ์ของเบราว์เซอร์ — ผู้ใช้เลือก "บันทึกเป็น PDF" หรือพิมพ์กระดาษก็ได้
  // ใบเสร็จที่จะพิมพ์คือ #bill-print ซึ่ง CSS @media print จัดการแสดงให้เอง
  printBill(): void {
    if (typeof window !== 'undefined') {
      window.print();
    }
  }

  // ==========================================
  // ข้อมูลหัวบิล — 🌟 แก้ชื่อหน่วยงาน/ที่อยู่หมู่บ้านของคุณตรงนี้ได้เลย
  // ==========================================
  readonly orgName = 'ที่ทำการประปาหมู่บ้าน';
  readonly orgAddress = 'หมู่ที่ .... ตำบล ............ อำเภอ ............ จังหวัด ............';
  readonly orgPhone = 'โทร. ..............';

  // กำหนดชำระภายใน 15 วันนับจากวันออกบิล (ปรับตัวเลขได้ตามระเบียบหมู่บ้าน)
  dueDate(bill: any): Date | null {
    if (!bill?.create_date) return null;
    const d = new Date(bill.create_date);
    d.setDate(d.getDate() + 15);
    return d;
  }

  // ==========================================
  // แปลงจำนวนเงินเป็นตัวอักษรไทย เช่น 295 → "สองร้อยเก้าสิบห้าบาทถ้วน"
  // ==========================================
  private readonly thDigit = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  private readonly thPlace = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

  bahtText(amount: number): string {
    const value = Number(amount);
    if (isNaN(value)) return '';

    const [bahtStr, satangStr] = value.toFixed(2).split('.');
    const baht = parseInt(bahtStr, 10);
    const satang = parseInt(satangStr, 10);

    let text = baht === 0 ? 'ศูนย์บาท' : this.readThaiInteger(baht) + 'บาท';
    text += satang === 0 ? 'ถ้วน' : this.readThaiInteger(satang) + 'สตางค์';
    return text;
  }

  // อ่านจำนวนเต็มเป็นภาษาไทย (รองรับหลักล้านด้วยการวนซ้ำ)
  private readThaiInteger(num: number): string {
    if (num === 0) return '';

    // ตัดเป็นกลุ่มล้าน เช่น 1,234,567 = "หนึ่งล้าน" + "สองแสนสามหมื่นสี่พันห้าร้อยหกสิบเจ็ด"
    if (num >= 1000000) {
      const millions = Math.floor(num / 1000000);
      const rest = num % 1000000;
      return this.readThaiInteger(millions) + 'ล้าน' + (rest > 0 ? this.readThaiInteger(rest) : '');
    }

    const digits = num.toString().split('').map(Number);
    const len = digits.length;
    let text = '';

    for (let i = 0; i < len; i++) {
      const d = digits[i];
      const place = len - i - 1; // 0 = หน่วย, 1 = สิบ, ...
      if (d === 0) continue;

      if (place === 1 && d === 1) {
        text += 'สิบ';               // สิบ (ไม่ใช่ หนึ่งสิบ)
      } else if (place === 1 && d === 2) {
        text += 'ยี่สิบ';            // ยี่สิบ (ไม่ใช่ สองสิบ)
      } else if (place === 0 && d === 1 && len > 1) {
        text += 'เอ็ด';             // ...เอ็ด (ไม่ใช่ ...หนึ่ง)
      } else {
        text += this.thDigit[d] + this.thPlace[place];
      }
    }
    return text;
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
