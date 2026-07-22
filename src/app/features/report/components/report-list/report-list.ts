import { ChangeDetectorRef, Component, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toast } from 'ngx-sonner';
import { ReportService, Report } from '../../services/report.service';
import { extractErrorMessage } from '../../../auth/services/auth-error';
import { BillPrintService } from '../../../meter-reading/services/bill-print.service';
import {
  REPORT_DETAIL_MAX,
  REPORT_STATUSES,
  categoryIcon,
  categoryLabel,
  statusChip,
  statusLabel,
} from '../../report.constants';

/**
 * หน้าเรื่องที่ลูกบ้านแจ้ง (ฝั่งเจ้าหน้าที่) — เห็นทุกบ้าน
 * ตอบกลับและเปลี่ยนสถานะได้ ส่วนลูกบ้านจะเห็นคำตอบในหน้า /member/reports ของตัวเอง
 */
@Component({
  selector: 'app-report-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './report-list.html',
  styleUrls: ['./report-list.css'],
})
export class ReportListComponent implements OnInit {
  private reportService = inject(ReportService);
  private print = inject(BillPrintService);
  private cdr = inject(ChangeDetectorRef);

  readonly statuses = REPORT_STATUSES;
  readonly detailMax = REPORT_DETAIL_MAX;

  reports: Report[] = [];
  isLoading = true;

  // ตัวกรอง: '' = ทุกสถานะ
  selectedStatus = '';
  searchTerm = '';

  // เรื่องที่กำลังเปิดตอบ
  selectedReport: Report | null = null;
  replyText = '';
  isSaving = false;

  // เรื่องที่กำลังจะลบ (ถามยืนยันก่อนลบจริง)
  reportToDelete: Report | null = null;

  // ตอน prerender (SSR) ยังไม่มี token ใน localStorage ยิง API ไปก็ได้ 401 เปล่า ๆ
  // ต้องข้ามไปก่อน แล้วให้ฝั่ง browser โหลดจริง ไม่งั้น build จะพังตอน prerender
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  ngOnInit(): void {
    if (!this.isBrowser) return;
    this.loadReports();
  }

  loadReports(): void {
    this.isLoading = true;
    this.reportService.getReports().subscribe({
      next: (reports) => {
        this.reports = reports ?? [];
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('โหลดเรื่องที่แจ้งไม่สำเร็จ:', err);
        this.isLoading = false;
        this.cdr.detectChanges();
        toast.error(extractErrorMessage(err, 'โหลดเรื่องที่แจ้งไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), {
          id: 'reports-load-error',
        });
      },
    });
  }

  // ==========================================
  // ตัวกรองและตัวนับ
  // ==========================================
  get visibleReports(): Report[] {
    const term = this.searchTerm.trim().toLowerCase();
    return this.reports.filter((r) => {
      if (this.selectedStatus && r.status !== this.selectedStatus) return false;
      if (!term) return true;
      return [
        r.member?.house_no,
        r.member?.fname,
        r.member?.lname,
        r.member?.phone,
        r.detail,
        categoryLabel(r.category),
      ].some((v) => (v ?? '').toString().toLowerCase().includes(term));
    });
  }

  countByStatus(status: string): number {
    return this.reports.filter((r) => r.status === status).length;
  }

  /** เรื่องที่ยังไม่เสร็จ — ตัวเลขที่เจ้าหน้าที่ต้องเห็นก่อนเพื่อน */
  get openCount(): number {
    return this.reports.filter((r) => r.status !== 'Resolved').length;
  }

  // ==========================================
  // ตอบกลับ / เปลี่ยนสถานะ
  // ==========================================
  openReply(report: Report): void {
    this.selectedReport = report;
    this.replyText = report.admin_reply ?? '';
  }

  closeReply(): void {
    this.selectedReport = null;
    this.replyText = '';
  }

  /** บันทึกคำตอบ (และเปลี่ยนสถานะไปด้วยถ้าระบุมา) */
  saveReply(status?: string): void {
    if (!this.selectedReport || this.isSaving) return;

    const reply = this.replyText.trim();
    if (reply.length > this.detailMax) {
      toast.error(`ข้อความตอบกลับยาวเกินไป (ไม่เกิน ${this.detailMax} ตัวอักษร)`, {
        id: 'reply-too-long',
      });
      return;
    }

    const id = this.selectedReport.id;
    const payload: { admin_reply?: string; status?: string } = { admin_reply: reply };
    if (status) payload.status = status;

    this.isSaving = true;
    this.reportService.replyReport(id, payload).subscribe({
      next: () => {
        this.isSaving = false;
        this.closeReply();
        toast.success('บันทึกคำตอบเรียบร้อยแล้ว ลูกบ้านจะเห็นในหน้าของเขาทันที', {
          id: 'reply-saved',
        });
        this.loadReports();
      },
      error: (err) => {
        this.isSaving = false;
        this.cdr.detectChanges();
        console.error('บันทึกคำตอบไม่สำเร็จ:', err);
        toast.error(extractErrorMessage(err, 'บันทึกคำตอบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), {
          id: 'reply-error',
        });
      },
    });
  }

  /** เปลี่ยนสถานะจากหน้ารายการ โดยไม่ต้องเปิดกล่องตอบ */
  changeStatus(report: Report, status: string): void {
    this.reportService.replyReport(report.id, { status }).subscribe({
      next: () => {
        report.status = status as Report['status'];
        this.cdr.detectChanges();
        toast.success(`เปลี่ยนสถานะเป็น "${statusLabel(status)}" แล้ว`, { id: 'status-changed' });
      },
      error: (err) => {
        console.error('เปลี่ยนสถานะไม่สำเร็จ:', err);
        toast.error(extractErrorMessage(err, 'เปลี่ยนสถานะไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), {
          id: 'status-error',
        });
      },
    });
  }

  // ==========================================
  // ลบเรื่อง
  // ==========================================
  askDelete(report: Report): void {
    this.reportToDelete = report;
  }

  cancelDelete(): void {
    this.reportToDelete = null;
  }

  confirmDelete(): void {
    if (!this.reportToDelete) return;
    const id = this.reportToDelete.id;
    this.reportToDelete = null;

    this.reportService.deleteReport(id).subscribe({
      next: () => {
        toast.success('ลบเรื่องเรียบร้อยแล้ว', { id: 'report-deleted' });
        this.loadReports();
      },
      error: (err) => {
        console.error('ลบเรื่องไม่สำเร็จ:', err);
        this.cdr.detectChanges();
        toast.error(extractErrorMessage(err, 'ลบเรื่องไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), {
          id: 'report-delete-error',
        });
      },
    });
  }

  // ==========================================
  // ข้อความบนจอ
  // ==========================================
  categoryLabel = categoryLabel;
  categoryIcon = categoryIcon;
  statusLabel = statusLabel;
  statusChip = statusChip;

  dateLabel(value: string | Date | null | undefined): string {
    return this.print.dateLabel(value);
  }

  ownerName(report: Report): string {
    const m = report.member;
    if (!m) return 'ไม่พบข้อมูลลูกบ้าน';
    return `${m.fname ?? ''} ${m.lname ?? ''}`.trim() || 'ไม่ระบุชื่อ';
  }
}
