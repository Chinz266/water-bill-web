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

/**
 * ชื่อไทยของข้อตรวจพบแต่ละประเภท — รหัสจากหลังบ้านอ่านไม่รู้เรื่องสำหรับคนเก็บเงิน
 *
 * เขียนเป็นประโยคบอกเล่าว่า "เกิดอะไรขึ้น" ด้วยภาษาราชการที่ใช้ในเอกสารของหมู่บ้าน
 * ไม่ใช่ศัพท์ของระบบ เพราะหน้านี้เป็นหลักฐานที่ผู้ดูแลใช้ประกอบการตรวจสอบย้อนหลัง
 */
const FLAG_LABELS: Record<string, string> = {
  duplicate_location: 'พิกัดซ้ำกับการบันทึกครั้งก่อน',
  burst_photo: 'ถ่ายภาพต่อเนื่องจากจุดเดิม',
  future_timestamp: 'เวลาถ่ายภาพล่วงหน้าเกินวันปัจจุบัน',
  stale_photo: 'ภาพถ่ายก่อนรอบบิลที่ออก',
  meter_reset: 'เลขมิเตอร์ลดลงจากครั้งก่อน (เปลี่ยนมิเตอร์ / วนรอบ)',
  high_usage: 'ปริมาณการใช้น้ำสูงผิดปกติ',
  usage_warning: 'ปริมาณการใช้น้ำเบี่ยงเบนจากค่าเฉลี่ย',
  digit_change: 'จำนวนหลักบนหน้าปัดไม่ตรงกับที่บันทึกไว้',
  low_confidence: 'ระบบ AI อ่านตัวเลขไม่ชัดเจน',
  manual_entry: 'เจ้าหน้าที่บันทึกตัวเลขเอง ไม่ผ่านระบบ AI',
  offline_sync: 'บันทึกขณะไม่มีสัญญาณ แล้วส่งเข้าระบบภายหลัง'
};

/**
 * หน้าตรวจย้อนหลังของผู้ดูแล — เรื่องที่ระบบทักไว้ + งานเก็บกวาดข้อมูลเก่า
 *
 * ═══ อ่านหน้านี้ยังไงให้ถูก ═══
 *
 * ระบบทักครั้งเดียวแทบไม่ได้แปลว่ามีอะไรผิด — พิกัดซ้ำครั้งเดียวเกิดจากหน้าเว็บ cache
 * พิกัดไว้ก็ได้ สิ่งที่บอกอะไรจริงคือ **ความถี่**: บ้านที่ถูกทักเรื่องเดิมซ้ำ ๆ ทุกเดือน
 * คือสัญญาณ ส่วนบ้านที่ถูกทักครั้งเดียวในรอบปีคือเรื่องปกติของหน้างาน
 *
 * และถ้าเรื่องไหนถูกทักเกือบทุกใบ แปลว่าเกณฑ์ตั้งแน่นเกินของจริง — ต้องไปปรับเกณฑ์
 * ที่หน้าตั้งค่าหมู่บ้าน ไม่ใช่ปล่อยให้คนกดยืนยันผ่านต่อไป เพราะนิสัยกดผ่านจะลามไปถึง
 * ใบที่ผิดจริงในวันที่มันเกิดขึ้น
 *
 * ⚠️ คำบนจอเลี่ยงศัพท์ของระบบทั้งหน้า (ไม่มีคำว่า "ธง" หรือ "ด่าน") และใช้ภาษาทางการ
 *    ตามที่เจ้าของระบบกำหนด เพราะหน้านี้ใช้อ้างอิงเวลาชี้แจงย้อนหลังกับลูกบ้าน —
 *    ตัวแปรในโค้ดยังใช้ flag ตามหลังบ้านเหมือนเดิม
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

  /** ประเภทข้อตรวจพบที่กำลังกรองอยู่ ('' = ทุกประเภท) */
  selectedType = '';

  /** ถามยืนยันก่อนลบ — ไฟล์รูปที่ลบแล้วกู้คืนไม่ได้ */
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

  /**
   * ตัดรหัสภาษาอังกฤษท้ายข้อความที่หลังบ้านแปะมา เช่น "(manual_after_ocr_fail)"
   *
   * รหัสพวกนี้มีไว้ให้คนเขียนโปรแกรมไล่ log ไม่ใช่ให้ผู้ใช้งานอ่าน — ขึ้นบนจอแล้ว
   * อ่านไม่ออกจนเลิกอ่านทั้งบรรทัด ส่วนวงเล็บที่มีวันที่/ตัวเลขไทยยังอยู่ครบ
   */
  flagDetail(detail: string | null): string {
    return (detail ?? '').replace(/\s*\([a-z0-9_]+\)\s*$/i, '').trim();
  }

  /** ใบที่ "เจ้าหน้าที่ยืนยันผ่าน" ต่างจากใบที่ระบบบันทึกไว้เองเฉย ๆ — ต้องแยกให้เห็น */
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
        toast.error(extractErrorMessage(err, 'เรียกดูรายการข้อตรวจพบไม่สำเร็จ'), { id: 'audit-flags-error' });
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
          `ดำเนินการเรียบร้อย — ลบภาพที่พ้นกำหนดจัดเก็บ ${result.photos_purged} ไฟล์ · ` +
            `ลบไฟล์ที่ไม่มีรายการอ้างอิง ${result.orphan_files_removed} ไฟล์ · ` +
            `ปรับสถานะบิลเกินกำหนดชำระ ${result.overdue_marked} ใบ`,
          { id: 'housekeeping-done' }
        );
        this.reload();
      },
      error: (err) => {
        this.isCleaning.set(false);
        toast.error(extractErrorMessage(err, 'ลบภาพที่พ้นกำหนดจัดเก็บไม่สำเร็จ'), { id: 'housekeeping-error' });
      }
    });
  }
}
