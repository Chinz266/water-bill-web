import { Component, OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { toast } from 'ngx-sonner';
import {
  AuditService,
  FlagSummary,
  HousekeepingStatus,
  ReadingFlag
} from '../../services/audit.service';
import { extractErrorMessage } from '../../../auth/services/auth-error';

/** ชื่อไทยของธงแต่ละชนิด — รหัสจากหลังบ้านอ่านไม่รู้เรื่องสำหรับคนเก็บเงิน */
const FLAG_LABELS: Record<string, string> = {
  duplicate_location: 'พิกัดซ้ำกับการจดครั้งก่อน',
  burst_photo: 'ถ่ายรัวจากจุดเดิม',
  future_timestamp: 'เวลาถ่ายเป็นอนาคต',
  stale_photo: 'รูปเก่ากว่ารอบที่ออกบิล',
  meter_reset: 'เปลี่ยนมิเตอร์ / มิเตอร์วนรอบ',
  high_usage: 'หน่วยน้ำสูงผิดปกติ (กดยืนยันผ่าน)',
  usage_warning: 'หน่วยน้ำขยับจากปกติ (เตือนเฉย ๆ)',
  digit_change: 'จำนวนหลักบนหน้าปัดเปลี่ยน',
  low_confidence: 'AI อ่านเลขไม่ชัด',
  manual_entry: 'กรอกเลขเอง ไม่ได้ผ่าน AI',
  offline_sync: 'ซิงก์จากเครื่องที่บันทึกไว้ตอนไม่มีสัญญาณ'
};

/**
 * หน้าสอบทานของผู้ดูแล — ธงที่ระบบติดไว้ + งานเก็บกวาดระบบ
 *
 * ═══ อ่านหน้านี้ยังไงให้ถูก ═══
 *
 * ธงใบเดียวแทบไม่ได้แปลว่ามีอะไรผิด — พิกัดซ้ำครั้งเดียวเกิดจากหน้าเว็บ cache
 * พิกัดไว้ก็ได้ สิ่งที่บอกอะไรจริงคือ **ความถี่**: คนที่ติดธงเดิมซ้ำ ๆ ทุกเดือน
 * คือสัญญาณ ส่วนคนที่ติดครั้งเดียวในรอบปีคือเรื่องปกติของหน้างาน
 *
 * และถ้าธงชนิดไหนขึ้นเกือบทุกใบ แปลว่าเกณฑ์ตั้งแน่นเกินของจริง — ต้องไปปรับเกณฑ์
 * ที่หน้าตั้งค่าหมู่บ้าน ไม่ใช่ปล่อยให้คนกดผ่านต่อไป เพราะนิสัยกดผ่านจะลามไปถึง
 * ใบที่ผิดจริงในวันที่มันเกิดขึ้น
 */
@Component({
  selector: 'app-audit-board',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './audit-board.html',
  styleUrls: ['./audit-board.css']
})
export class AuditBoardComponent implements OnInit {
  private audit = inject(AuditService);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly isLoading = signal(true);
  readonly flags = signal<ReadingFlag[]>([]);
  readonly summary = signal<FlagSummary | null>(null);
  readonly housekeeping = signal<HousekeepingStatus | null>(null);

  /** ชนิดธงที่กำลังกรองอยู่ ('' = ทุกชนิด) */
  selectedType = '';

  /** ถามยืนยันก่อนสั่งเก็บกวาด — การลบไฟล์รูปกู้คืนไม่ได้ */
  readonly askCleanup = signal(false);
  readonly isCleaning = signal(false);

  ngOnInit(): void {
    // ตอน prerender ยังไม่มี token ยิงไปก็ได้ 401 เปล่า ๆ (เหมือนหน้าอื่น)
    if (!this.isBrowser) return;
    this.reload();
  }

  flagLabel(type: string): string {
    return FLAG_LABELS[type] ?? type;
  }

  /** ธงที่ "คนกดยืนยันข้ามด่าน" ต่างจากธงที่ระบบติดเองเฉย ๆ — ต้องแยกให้เห็น */
  wasConfirmedByPerson(flag: ReadingFlag): boolean {
    return flag.confirmed_by !== null;
  }

  reload(): void {
    this.isLoading.set(true);

    this.audit.flags({ flag_type: this.selectedType || undefined, limit: 200 }).subscribe({
      next: (rows) => {
        this.flags.set(rows);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.isLoading.set(false);
        toast.error(extractErrorMessage(err, 'ดึงรายการธงไม่สำเร็จ'), { id: 'audit-flags-error' });
      }
    });

    this.audit.summary(30).subscribe({
      next: (data) => this.summary.set(data),
      error: () => this.summary.set(null)
    });

    this.audit.housekeeping().subscribe({
      next: (data) => this.housekeeping.set(data),
      error: () => this.housekeeping.set(null)
    });
  }

  onFilterChange(): void {
    this.reload();
  }

  confirmCleanup(): void {
    if (this.isCleaning()) return;
    this.isCleaning.set(true);

    this.audit.runHousekeeping().subscribe({
      next: (result) => {
        this.isCleaning.set(false);
        this.askCleanup.set(false);
        toast.success(
          `เก็บกวาดเรียบร้อย — ลบรูปหมดอายุ ${result.photos_purged} ไฟล์ · ` +
            `ลบไฟล์ที่ไม่มีใครใช้ ${result.orphan_files_removed} ไฟล์ · ` +
            `ดีดบิลเลยกำหนด ${result.overdue_marked} ใบ`,
          { id: 'housekeeping-done' }
        );
        this.reload();
      },
      error: (err) => {
        this.isCleaning.set(false);
        toast.error(extractErrorMessage(err, 'สั่งเก็บกวาดไม่สำเร็จ'), { id: 'housekeeping-error' });
      }
    });
  }
}
