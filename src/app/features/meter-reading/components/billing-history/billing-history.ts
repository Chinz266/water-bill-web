import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MeterReadingService } from '../../services/meter-reading.service';

@Component({
  selector: 'app-billing-history',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './billing-history.html',
  styleUrls: ['./billing-history.css']
})
export class BillingHistoryComponent implements OnInit {
  bills: any[] = [];
  isLoading = true;
  isFetching = false;

  constructor(
    private meterReadingService: MeterReadingService,
    private cdr: ChangeDetectorRef
  ) { }

  toggleStatus(bill: any) {
    const newStatus = bill.payment_status === 'PENDING' ? 'PAID' : 'PENDING';
    this.meterReadingService.updatePaymentStatus(bill.id, newStatus).subscribe({
      next: () => {
        bill.payment_status = newStatus;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Update status error:', err);
        alert('❌ เปลี่ยนสถานะไม่สำเร็จ เช็คฝั่งหลังบ้านหน่อยครับ');
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
        console.log('ข้อมูลจาก API:', data);
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
        alert('❌ ไม่สามารถดึงข้อมูลประวัติได้');
      }
    });
  }
  // 🌟 ฟังก์ชันลบข้อมูล (ต้องเอามาแปะไว้ใน Class ของ BillingHistoryComponent)
  deleteBill(id: number) {
    const isConfirm = confirm('🚨 แน่ใจไหมว่าต้องการลบบิลนี้? ข้อมูลจะถูกลบออกจากฐานข้อมูลถาวรเลยนะ!');
    
    if (isConfirm) {
      this.meterReadingService.deleteBill(id).subscribe({
        next: () => {
          // พอลบสำเร็จ ก็สั่งโหลดข้อมูลใหม่ให้หน้าจอตารางรีเฟรชทันที
          this.loadBillingHistory();
        },
        error: (err) => {
          console.error('Delete error:', err);
          alert('❌ ลบข้อมูลไม่สำเร็จ เช็คฝั่งหลังบ้านหน่อยครับ');
        }
      });
    }
  }
}  