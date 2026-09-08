import { ChangeDetectorRef, Component, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { toast } from 'ngx-sonner';
import { ReportService, Report } from '../../services/report.service';
import { MemberPortalService } from '../../../member-portal/services/member-portal.service';
import { AuthService } from '../../../auth/services/auth.service';
import { extractErrorMessage } from '../../../auth/services/auth-error';
import { BillPrintService } from '../../../meter-reading/services/bill-print.service';
import {
  REPORT_CATEGORIES,
  REPORT_DETAIL_MAX,
  categoryIcon,
  categoryLabel,
  statusChip,
  statusLabel,
} from '../../report.constants';

/**
 * หน้าแจ้งเรื่องของลูกบ้าน — ส่งเรื่องถึงผู้ดูแลหมู่บ้าน และดูคำตอบที่ได้รับ
 * เห็นเฉพาะเรื่องของบ้านตัวเอง (หลังบ้านกรองให้ผ่าน account_members)
 */
@Component({
  selector: 'app-my-reports',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './my-reports.html',
  styleUrls: ['../../../member-portal/portal-shared.css', './my-reports.css'],
})
export class MyReportsComponent implements OnInit {
  private reportService = inject(ReportService);
  private portal = inject(MemberPortalService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private print = inject(BillPrintService);
  private cdr = inject(ChangeDetectorRef);

  readonly displayName = this.auth.displayName;
  readonly categories = REPORT_CATEGORIES;
  readonly detailMax = REPORT_DETAIL_MAX;

  reports: Report[] = [];
  houses: any[] = [];
  /** โหลดรายชื่อบ้านไม่สำเร็จ — แยกจาก "ไม่มีบ้าน" เพราะวิธีแก้ของผู้ใช้ต่างกัน */
  housesFailed = false;
  isLoading = true;

  // ---------- ฟอร์มแจ้งเรื่องใหม่ ----------
  showForm = false;
  isSending = false;
  form: { members_id: number | null; category: string; detail: string } = {
    members_id: null,
    category: '',
    detail: '',
  };
  photo: string | null = null;
  formErrors = { category: '', detail: '' };

  // เรื่องที่กำลังเปิดดูรายละเอียดเต็ม
  selectedReport: Report | null = null;

  // ตอน prerender (SSR) ยังไม่มี token ใน localStorage ยิง API ไปก็ได้ 401 เปล่า ๆ
  // ต้องข้ามไปก่อน แล้วให้ฝั่ง browser โหลดจริง ไม่งั้น build จะพังตอน prerender
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  ngOnInit(): void {
    if (!this.isBrowser) return;

    this.loadReports();

    this.portal.getMyHouses().subscribe({
      next: (houses) => {
        this.houses = houses ?? [];
        // ดูแลบ้านหลังเดียว (กรณีปกติ) เลือกให้เลย ไม่ต้องให้กดเอง
        if (this.houses.length === 1) {
          this.form.members_id = this.houses[0].id;
        }
        this.cdr.detectChanges();
      },
      // ถ้าโหลดบ้านไม่ได้ ฟอร์มจะส่งไม่ออกเลย (ไม่มี members_id) — ต้องบอกผู้ใช้
      // ไม่ใช่เงียบไว้ใน console แล้วปล่อยให้ไปตันตอนกดส่ง
      error: (err) => {
        console.error('โหลดรายชื่อบ้านไม่สำเร็จ:', err);
        this.housesFailed = true;
        this.cdr.detectChanges();
        toast.error(extractErrorMessage(err, 'โหลดข้อมูลบ้านของคุณไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), {
          id: 'my-houses-error',
        });
      },
    });
  }

  loadReports(): void {
    this.isLoading = true;
    this.reportService.getMyReports().subscribe({
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
          id: 'my-reports-error',
        });
      },
    });
  }

  // ==========================================
  // ฟอร์มแจ้งเรื่อง
  // ==========================================
  openForm(): void {
    // ไม่มีบ้านผูกกับบัญชี = ส่งเรื่องไม่ได้แน่นอน (หลังบ้านต้องการ members_id)
    // บอกตั้งแต่ตรงนี้ ดีกว่าให้กรอกจนเสร็จแล้วค่อยเด้งว่าให้เลือกบ้าน ทั้งที่ไม่มีให้เลือก
    if (this.houses.length === 0) {
      toast.error(
        this.housesFailed
          ? 'ยังโหลดข้อมูลบ้านของคุณไม่ได้ กรุณาปิดแล้วเปิดหน้านี้ใหม่อีกครั้ง'
          : 'บัญชีนี้ยังไม่ได้ผูกกับบ้านหลังไหน รบกวนติดต่อผู้ดูแลหมู่บ้านให้เพิ่มให้ก่อน',
        { id: 'report-no-house' },
      );
      return;
    }

    if (this.houses.length === 1) {
      this.form.members_id = this.houses[0].id;
    }
    this.showForm = true;
  }

  closeForm(): void {
    this.showForm = false;
    this.form = {
      members_id: this.houses.length === 1 ? this.houses[0].id : null,
      category: '',
      detail: '',
    };
    this.photo = null;
    this.formErrors = { category: '', detail: '' };
  }

  /** เลือกหมวดด้วยการกดการ์ด (นิ้วโป้งกดง่ายกว่า dropdown บนมือถือ) */
  pickCategory(value: string): void {
    this.form.category = value;
    this.formErrors.category = '';
  }

  /** เลือกรูป → ย่อด้านยาวสุดเหลือ 1024px แล้วเก็บเป็น base64 (ไม่ต้องอัปไฟล์จริง) */
  onPhotoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('กรุณาเลือกไฟล์ภาพภาพ', { id: 'report-photo-type' });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // ย่อก่อนส่งเสมอ รูปจากกล้องมือถือใหญ่หลาย MB ถ้าส่งดิบ ๆ หลังบ้านจะปฏิเสธ
        const maxSide = 1024;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);

        this.photo = canvas.toDataURL('image/jpeg', 0.7);
        this.cdr.detectChanges();
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);

    // เคลียร์ค่า input เผื่อผู้ใช้เลือกไฟล์เดิมซ้ำ (จะได้ยิง change อีกครั้ง)
    input.value = '';
  }

  removePhoto(): void {
    this.photo = null;
  }

  private validate(): boolean {
    this.formErrors = { category: '', detail: '' };
    let ok = true;

    if (!this.form.category) {
      this.formErrors.category = 'กรุณาเลือกหมวดหมู่เรื่องที่ต้องการแจ้ง';
      ok = false;
    }
    if (!this.form.detail || this.form.detail.trim() === '') {
      this.formErrors.detail = 'กรุณากรอกรายละเอียด จะได้ช่วยตรวจสอบได้ตรงจุด';
      ok = false;
    } else if (this.form.detail.trim().length > this.detailMax) {
      this.formErrors.detail = `รายละเอียดยาวเกินไป (ไม่เกิน ${this.detailMax} ตัวอักษร)`;
      ok = false;
    }
    return ok;
  }

  submit(): void {
    if (this.isSending) return;
    if (!this.validate()) return;

    if (!this.form.members_id) {
      toast.error('กรุณาเลือกบ้านที่ต้องการแจ้งเรื่อง', { id: 'report-need-house' });
      return;
    }

    this.isSending = true;
    this.reportService
      .createMyReport({
        members_id: this.form.members_id,
        category: this.form.category,
        detail: this.form.detail.trim(),
        photo: this.photo,
      })
      .subscribe({
        next: () => {
          this.isSending = false;
          this.closeForm();
          toast.success('ส่งเรื่องถึงผู้ดูแลเรียบร้อยแล้ว รอการติดต่อกลับ', {
            id: 'report-sent',
          });
          this.loadReports();
        },
        error: (err) => {
          this.isSending = false;
          this.cdr.detectChanges();
          console.error('ส่งเรื่องไม่สำเร็จ:', err);
          toast.error(extractErrorMessage(err, 'ส่งเรื่องไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), {
            id: 'report-send-error',
          });
        },
      });
  }

  // ==========================================
  // รายละเอียด / ข้อความบนจอ
  // ==========================================
  openDetail(report: Report): void {
    this.selectedReport = report;
  }

  closeDetail(): void {
    this.selectedReport = null;
  }

  /** จำนวนเรื่องที่ยังไม่เสร็จ ไว้โชว์บนหัวข้อ */
  get openCount(): number {
    return this.reports.filter((r) => r.status !== 'Resolved').length;
  }

  categoryLabel = categoryLabel;
  categoryIcon = categoryIcon;
  statusLabel = statusLabel;
  statusChip = statusChip;

  /** '2026-07-22T09:30:00Z' → '22 กรกฎาคม 2569' (ใช้ตัวแปลงตัวเดียวกับบิล) */
  dateLabel(value: string | Date | null | undefined): string {
    return this.print.dateLabel(value);
  }

  houseLabel(report: Report): string {
    const m = report.member;
    if (!m) return '—';
    const name = `${m.fname ?? ''} ${m.lname ?? ''}`.trim();
    return name ? `บ้านเลขที่ ${m.house_no} · ${name}` : `บ้านเลขที่ ${m.house_no}`;
  }

  onLogout(): void {
    this.auth.logout();
    toast.success('ออกจากระบบแล้ว', { id: 'logout-success' });
    this.router.navigateByUrl('/member/login');
  }
}
