import { Component, OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toast } from 'ngx-sonner';
import {
  UnassignedCandidate,
  UnassignedReading,
  UnassignedService
} from '../../services/unassigned.service';
import { MeterReadingService } from '../../services/meter-reading.service';
import { AuthService } from '../../../auth/services/auth.service';
import { extractErrorMessage, extractErrorCode } from '../../../auth/services/auth-error';
import { API_BASE_URL } from '../../../../core/api.config';

/**
 * คิวรูปที่ยังไม่รู้ว่าเป็นของบ้านหลังไหน — "ข้อมูลกำพร้า"
 *
 * ═══ ทำไมต้องมีหน้านี้ ═══
 *
 * คนเดินจดเจอสองเคสที่ตัดสินหน้างานไม่ได้: AI อ่านเลขไม่ออก (หน้าปัดฝ้า/โคลนบัง)
 * และเคสที่อ่านออกแต่เข้าได้หลายบ้านพอ ๆ กัน ก่อนมีคิวนี้เขามีทางเลือกแค่
 * "เดาแล้วกดไปก่อน" (จบที่บิลผิดบ้าน) หรือ "ทิ้งรูปแล้วเดินกลับไปใหม่"
 *
 * ═══ ของที่ค้างนานคือของที่ต้องรีบ ═══
 *
 * เรียงเก่าสุดขึ้นก่อนโดยตั้งใจ — พอข้ามเดือนไปแล้วการออกบิลย้อนหลังจะไปชนด่าน
 * "มีบิลใหม่กว่าอยู่" ทันที แล้วหน่วยน้ำของรูปใบนั้นจะไปรวมกับเดือนถัดไปแทน
 * (หลังบ้านตีทิ้งอัตโนมัติเมื่อค้างเกิน 90 วัน)
 */
@Component({
  selector: 'app-unassigned-queue',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './unassigned-queue.html',
  styleUrls: ['./unassigned-queue.css']
})
export class UnassignedQueueComponent implements OnInit {
  private service = inject(UnassignedService);
  private meterReadingService = inject(MeterReadingService);
  private auth = inject(AuthService);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly isLoading = signal(true);
  readonly rows = signal<UnassignedReading[]>([]);

  /** ใบที่กำลังเปิดดูอยู่ พร้อมรายชื่อบ้านที่เป็นไปได้ */
  readonly selected = signal<UnassignedReading | null>(null);
  readonly isLoadingDetail = signal(false);
  readonly isAssigning = signal(false);

  /** รอบบิลที่จะออกให้ใบนี้ — ตั้งต้นเป็นเดือนปัจจุบัน */
  billingMonth = String(new Date().getMonth() + 1).padStart(2, '0');
  billingYear = String(new Date().getFullYear());

  /** เลขที่คนตรวจอ่านได้จากรูป — ว่างไว้ = ใช้ค่าที่ AI อ่านมา */
  manualUnit: number | null = null;
  selectedMemberId: number | null = null;

  /** ธงยืนยันที่ต้องส่งไปด้วยเมื่อโดนด่านของหลังบ้านตีกลับ */
  private confirms: Record<string, boolean> = {};

  /** ข้อความจากด่านที่ตีกลับ (null = ยังไม่เคยโดน) */
  readonly blockedMessage = signal<string | null>(null);
  readonly blockedCode = signal<string | null>(null);

  ngOnInit(): void {
    if (!this.isBrowser) return;
    this.reload();
  }

  reload(): void {
    this.isLoading.set(true);

    this.service.list('Pending').subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.isLoading.set(false);
        toast.error(extractErrorMessage(err, 'ดึงคิวรูปที่รอจับคู่ไม่สำเร็จ'), { id: 'unassigned-error' });
      }
    });
  }

  /**
   * ที่อยู่รูปเต็ม — หลังบ้านคืนมาเป็น path ต้องต่อกับ API_BASE_URL เอง
   * (ต่อจาก hostname ปัจจุบัน ไม่งั้นเปิดจากมือถือในวงแลนแล้วรูปวิ่งไป localhost ของตัวเอง)
   */
  photoUrl(row: UnassignedReading): string {
    const raw = String(row.evidence_photo ?? '').trim();
    if (/^(data:|https?:\/\/)/i.test(raw)) return raw;
    return `${API_BASE_URL}/${raw.replace(/^\/+/, '')}`;
  }

  open(row: UnassignedReading): void {
    this.selected.set(row);
    this.manualUnit = null;
    this.selectedMemberId = null;
    this.confirms = {};
    this.blockedMessage.set(null);
    this.blockedCode.set(null);
    this.loadCandidates(row.id);
  }

  close(): void {
    if (this.isAssigning()) return;
    this.selected.set(null);
  }

  /** รายชื่อบ้านที่เป็นไปได้ คิดด้วยเกณฑ์ชุดเดียวกับหน้าอัปรูปทั้งชุด */
  private loadCandidates(id: number): void {
    this.isLoadingDetail.set(true);

    this.service.getOne(id, this.billingMonth, this.billingYear).subscribe({
      next: (row) => {
        this.selected.set(row);
        // ระบบเสนอมาแล้วอันดับหนึ่ง แต่ไม่เลือกให้เอง — คนต้องกดยืนยันเองเสมอ
        // เพราะใบพวกนี้คือใบที่ระบบบอกไปแล้วว่าตัวเองแยกไม่ออก
        this.isLoadingDetail.set(false);
      },
      error: (err) => {
        this.isLoadingDetail.set(false);
        toast.error(extractErrorMessage(err, 'ดึงรายชื่อบ้านที่เป็นไปได้ไม่สำเร็จ'), { id: 'unassigned-detail' });
      }
    });
  }

  /** เปลี่ยนรอบบิลแล้วต้องคิดผู้สมัครใหม่ — เลขตั้งต้นของแต่ละบ้านคนละค่ากันในแต่ละเดือน */
  onBillingChange(): void {
    const row = this.selected();
    if (row) this.loadCandidates(row.id);
  }

  candidates(): UnassignedCandidate[] {
    return this.selected()?.candidates ?? [];
  }

  /** เลขที่จะส่งไปออกบิล — ค่าที่คนพิมพ์ชนะค่าที่ AI อ่าน (คนเปิดรูปดูอยู่ตรงหน้า) */
  unitToSend(): number | null {
    if (this.manualUnit !== null && this.manualUnit !== undefined) return Number(this.manualUnit);
    return this.selected()?.meter_unit ?? null;
  }

  canAssign(): boolean {
    return !this.isAssigning() && this.selectedMemberId !== null && this.unitToSend() !== null;
  }

  /** กดยืนยันข้ามด่านที่ตีกลับมา แล้วลองใหม่ทันที */
  confirmAndRetry(flag: string): void {
    this.confirms[flag] = true;
    this.blockedMessage.set(null);
    this.blockedCode.set(null);
    this.assign();
  }

  /**
   * ปุ่มยืนยันที่ควรขึ้นสำหรับด่านที่ตีกลับมา — null = ด่านที่ไม่มีทางข้าม
   *
   * ด่านที่บล็อกตาย (รูปถูกใช้ไปแล้ว · ถ่ายรัวจากจุดเดิม · เวลาถ่ายเป็นอนาคต ·
   * บิลจ่ายแล้ว) ต้องไม่มีปุ่มโผล่มาเลย ไม่งั้นคนจะกดวนอยู่นั่นโดยไม่มีอะไรเปลี่ยน
   */
  confirmFlagFor(code: string | null): { flag: string; label: string } | null {
    switch (code) {
      case 'HIGH_USAGE':
        return { flag: 'confirm_high_usage', label: 'ยืนยันว่าหน่วยน้ำที่สูงผิดปกตินั้นถูกต้อง' };
      case 'DIGIT_CHANGE':
        return { flag: 'confirm_digit_change', label: 'ยืนยันว่าจำนวนหลักที่เปลี่ยนไปถูกต้อง' };
      case 'LOW_CONFIDENCE':
        return { flag: 'confirm_low_confidence', label: 'ยืนยันว่าเลขที่อ่านได้ตรงกับหน้าปัด' };
      case 'DUPLICATE_LOCATION':
        return { flag: 'confirm_duplicate_location', label: 'ยืนยันว่าเป็นรูปที่ถ่ายใหม่จริง' };
      case 'STALE_PHOTO':
        return { flag: 'confirm_stale_photo', label: 'ยืนยันว่าใช้รูปถูกใบ' };
      case 'METER_ROLLBACK':
        return { flag: 'confirm_meter_reset', label: 'ยืนยันว่าเปลี่ยนมิเตอร์ / มิเตอร์วนรอบ' };
      case 'BILL_EXISTS':
        return { flag: 'replace', label: 'จดทับบิลเดือนเดียวกันที่มีอยู่แล้ว' };
      default:
        return null;
    }
  }

  assign(): void {
    const row = this.selected();
    const unit = this.unitToSend();
    if (!row || !this.selectedMemberId || unit === null || this.isAssigning()) return;

    this.isAssigning.set(true);

    this.meterReadingService.getActiveWaterRate().subscribe({
      next: (rate: any) => {
        if (!rate?.id) {
          this.isAssigning.set(false);
          toast.error('ยังไม่มีเรทค่าน้ำในระบบ ตั้งเรทที่หน้าตั้งค่าหมู่บ้านก่อนครับ', { id: 'no-rate' });
          return;
        }

        this.service
          .assign(row.id, {
            members_id: Number(this.selectedMemberId),
            water_rates_id: rate.id,
            billing_month: this.billingMonth,
            billing_year: this.billingYear,
            // ส่งเลขที่คนพิมพ์เองเท่านั้น — ไม่ส่งแปลว่าใช้ค่าที่ AI อ่านไว้ตามเดิม
            current_unit: this.manualUnit !== null ? Number(this.manualUnit) : undefined,
            create_by: this.auth.admin()?.id,
            ...this.confirms
          })
          .subscribe({
            next: () => {
              this.isAssigning.set(false);
              this.selected.set(null);
              toast.success('จับคู่รูปกับบ้านและออกบิลเรียบร้อยครับ', { id: 'assign-ok' });
              this.reload();
            },
            error: (err) => {
              this.isAssigning.set(false);
              this.blockedCode.set(extractErrorCode(err));
              this.blockedMessage.set(extractErrorMessage(err, 'ออกบิลไม่สำเร็จ'));
            }
          });
      },
      error: (err) => {
        this.isAssigning.set(false);
        toast.error(extractErrorMessage(err, 'ดึงเรทค่าน้ำไม่สำเร็จ'), { id: 'rate-error' });
      }
    });
  }

  /** ใบที่กำลังจะตีทิ้ง — ต้องถามก่อน เพราะลบไฟล์รูปทิ้งด้วยและกู้คืนไม่ได้ */
  readonly rowToDiscard = signal<UnassignedReading | null>(null);
  discardNote = '';

  confirmDiscard(): void {
    const row = this.rowToDiscard();
    if (!row) return;

    this.service.discard(row.id, this.discardNote, this.auth.admin()?.id).subscribe({
      next: () => {
        this.rowToDiscard.set(null);
        this.discardNote = '';
        this.selected.set(null);
        toast.success('ตีทิ้งรูปนี้แล้วครับ', { id: 'discard-ok' });
        this.reload();
      },
      error: (err) => {
        toast.error(extractErrorMessage(err, 'ตีทิ้งไม่สำเร็จ'), { id: 'discard-error' });
      }
    });
  }
}
