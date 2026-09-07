import {
  Component,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { toast } from 'ngx-sonner';
import {
  UnassignedCandidate,
  UnassignedReading,
  UnassignedService,
  UnassignedSuggested
} from '../../services/unassigned.service';
import { MeterReadingService } from '../../services/meter-reading.service';
import { AuthService } from '../../../auth/services/auth.service';
import { extractErrorMessage, extractErrorCode } from '../../../auth/services/auth-error';
import { API_BASE_URL } from '../../../../core/api.config';

/**
 * คิวรูปที่ยังออกบิลไม่ได้ — รอคนที่มีเวลาตัดสิน
 *
 * ═══ ทำไมต้องมีหน้านี้ ═══
 *
 * คนเดินจดเจอสามเคสที่ตัดสินหน้างานไม่ได้: AI อ่านเลขไม่ออก (หน้าปัดฝ้า/โคลนบัง),
 * อ่านออกแต่เข้าได้หลายบ้านพอ ๆ กัน และ **รู้บ้านแล้วแต่ด่านตีกลับ** (หน่วยพุ่ง /
 * เลขต่ำกว่าเดือนก่อน / จดสลับตัวในกลุ่มมิเตอร์ที่ติดกัน)
 *
 * ก่อนมีคิวนี้เขามีทางเลือกแค่ "เดาแล้วกดไปก่อน" (จบที่บิลผิดบ้าน) "กดยืนยันข้ามด่าน
 * ทั้งที่ยังไม่ได้ตรวจ" หรือ "ทิ้งรูปแล้วเดินกลับไปใหม่"
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
  imports: [CommonModule, FormsModule, ScrollingModule],
  templateUrl: './unassigned-queue.html',
  styleUrls: ['./unassigned-queue.css']
})
export class UnassignedQueueComponent implements OnInit, OnDestroy {
  private service = inject(UnassignedService);
  private meterReadingService = inject(MeterReadingService);
  private auth = inject(AuthService);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly isLoading = signal(true);
  readonly rows = signal<UnassignedReading[]>([]);

  /**
   * ความสูงของการ์ดหนึ่งใบ + ระยะห่าง (พิกเซล) — ต้องตรงกับ `.queue-item` ใน CSS เป๊ะ
   *
   * cdk-virtual-scroll วางการ์ดด้วย index × ค่านี้ ไม่ได้วัดของจริง ค่าที่ไม่ตรงกับ CSS
   * จะทำให้การ์ดซ้อนกันหรือมีช่องโหว่ — การ์ดจึงถูกล็อกความสูงไว้ และทุกบรรทัดในนั้น
   * ถูกบังคับให้เป็นบรรทัดเดียว (nowrap + ellipsis) เพื่อให้สูงเท่ากันทุกใบทุกความกว้างจอ
   */
  readonly itemSize = 160;

  /** viewport ของ virtual scroll — ใช้เลื่อนไปหาการ์ดที่เพิ่งเชื่อมกัน */
  readonly viewport = viewChild(CdkVirtualScrollViewport);

  /** การ์ดที่เพิ่งถูกเลื่อนไปหา — ไฮไลต์ชั่วคราวให้ตาจับได้ว่าหน้าจอกระโดดไปไหน */
  readonly highlightedId = signal<number | null>(null);
  private highlightTimer: ReturnType<typeof setTimeout> | null = null;

  /** บ้านที่จะติ๊กให้หลังโหลดรายละเอียดเสร็จ (มาจากปุ่ม "บ้านเดียวกับคิว #N") */
  private preselectMemberId: number | null = null;

  /** ใบที่กำลังเปิดดูอยู่ พร้อมรายชื่อบ้านที่เป็นไปได้ */
  readonly selected = signal<UnassignedReading | null>(null);
  readonly isLoadingDetail = signal(false);
  readonly isAssigning = signal(false);

  /** รอบบิลที่จะออกให้ใบนี้ — ตั้งต้นเป็นเดือนปัจจุบัน */
  billingMonth = String(new Date().getMonth() + 1).padStart(2, '0');
  billingYear = String(new Date().getFullYear());

  /**
   * ป้ายสั้น ๆ ของด่านที่ตีกลับ — ใช้บนรายการคิว ให้เห็นตั้งแต่ยังไม่เปิด
   * ว่าใบนี้เป็น "ไม่รู้บ้าน" หรือ "รู้บ้านแล้วแต่ตัวเลขน่าสงสัย" ซึ่งใช้เวลาตรวจคนละแบบ
   */
  blockedLabel(code: string | null): string | null {
    switch (code) {
      case 'HIGH_USAGE':
        return 'หน่วยน้ำสูงผิดปกติ';
      case 'METER_ROLLBACK':
        return 'เลขต่ำกว่าเดือนก่อน';
      case 'CLUSTER_SEQUENCE_MISMATCH':
        return 'อาจจดสลับตัวในกลุ่มมิเตอร์';
      case 'DIGIT_CHANGE':
        return 'จำนวนหลักเปลี่ยน';
      case 'LOW_CONFIDENCE':
        return 'ระบบอ่านตัวเลขได้ไม่ชัดเจน';
      case 'DUPLICATE_LOCATION':
        return 'พิกัดซ้ำกับครั้งก่อน';
      case 'STALE_PHOTO':
        return 'รูปเก่ากว่ารอบนี้';
      case 'BILL_EXISTS':
        return 'มีบิลรอบนี้แล้ว';
      default:
        return code ? 'ด่านตีกลับ' : null;
    }
  }

  /** บ้านที่คนหน้างานเลือกไว้ — null = รูปกำพร้าแท้ ๆ ที่ยังไม่รู้ว่าของใคร */
  suggested(): UnassignedSuggested | null {
    return this.selected()?.suggested ?? null;
  }

  /**
   * หยิบบ้านที่คนหน้างานเลือกไว้มาใส่ช่องเลือก — ต้องกดเอง ไม่เลือกให้อัตโนมัติ
   *
   * บ้านนั้นเชื่อถือได้กว่าการเดาของระบบ (คนยืนอยู่หน้ามิเตอร์ตัวนั้นจริง ๆ) แต่หนึ่งใน
   * เหตุผลที่ใบนี้มาอยู่ในคิวคือ "อาจจดสลับบ้าน" — การติ๊กให้เองจะทำให้คนกดอนุมัติผ่าน
   * โดยไม่ได้มองว่าบ้านถูกไหม ซึ่งเป็นสิ่งเดียวที่หน้านี้มีไว้ให้ทำ
   */
  useSuggested(): void {
    const suggested = this.suggested();
    if (suggested) this.selectedMemberId = suggested.members_id;
  }

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

  ngOnDestroy(): void {
    if (this.highlightTimer) clearTimeout(this.highlightTimer);
  }

  trackById = (_: number, row: UnassignedReading) => row.id;

  /**
   * ข้อความบนป้ายเชื่อมไทม์ไลน์ — ต้องมีตัวเลขทั้งสองใบ ไม่ใช่แค่บอกว่า "เชื่อมกับ #9"
   *
   * คนที่กดยืนยันต้องตัดสินจาก "57 ➔ 90 = 33 หน่วย" ว่าสมเหตุสมผลไหม ป้ายที่บอกแค่
   * ว่าเชื่อมกันคือการขอให้เชื่อระบบโดยไม่มีอะไรให้ตรวจ ซึ่งพอเชื่อมผิดจะไม่มีใครจับได้
   */
  chainLabel(row: UnassignedReading): string | null {
    const chain = row.chain;
    if (!chain) return null;

    const before = chain.captured_at ? this.shortDate(chain.captured_at) : 'ก่อนหน้า';
    const now = row.captured_at ? this.shortDate(row.captured_at) : 'ใบนี้';

    return (
      `ต่อเนื่องจากคิว #${chain.id} (${before}: ${chain.meter_unit} ➔ ${now}: ${row.meter_unit} ` +
      `= ใช้ไป ${chain.usage_unit} หน่วย)`
    );
  }

  private shortDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
  }

  /**
   * ป้ายบอกว่าจุดที่ถ่ายอยู่ทางไหนของหมุดที่ลงทะเบียนไว้ — null = ไม่มีพิกัดให้เทียบ
   *
   * ═══ ทำไมต้องต่อท้ายว่า "อย่าเพิ่งเชื่อ" ═══
   *
   * ป้ายนี้อ่านแล้วดูแม่นมาก ("ด้านขวา 0.2 เมตร") ทั้งที่ GPS มือถือคลาดเคลื่อน 3-30 ม.
   * ตัวเลขระดับเซนติเมตรจึงเป็นเสียงรบกวนล้วน ๆ — คนที่เห็นป้ายนี้แล้วกดยืนยันบ้านตามนั้น
   * จะออกบิลผิดบ้านโดยที่หน้าจอดูน่าเชื่อถือทุกอย่าง
   *
   * หลังบ้านจึงส่ง `reliable` มาด้วย และตรงนี้ต้องพูดออกมาตรง ๆ ไม่ใช่ซ่อนไว้ในโค้ด
   */
  directionBadge(candidate: UnassignedCandidate): string | null {
    const relative = candidate.relative;
    if (!relative?.relative_direction) return null;

    const distance = relative.distance_meters.toFixed(2).replace(/\.?0+$/, '');
    const head =
      `📍 จุดที่ถ่ายอยู่ทาง "ด้าน${relative.relative_direction}" ` +
      `${distance} เมตร จากหมุดของบ้าน ${candidate.house_no}`;

    if (relative.from_sequence) {
      return `${head} (พิกัดซ้ำกันเป๊ะ — ทิศนี้มาจากลำดับตำแหน่งบนกำแพง)`;
    }
    if (!relative.reliable) {
      return `${head} — ⚠️ ระยะนี้ต่ำกว่าความคลาดเคลื่อนของ GPS (3-30 ม.) ใช้ดูประกอบเท่านั้น อย่าใช้ตัดสินว่าเป็นบ้านไหน`;
    }
    return head;
  }

  /** ใบก่อนหน้ารู้บ้านแล้วไหม — รู้แล้วถึงจะมีปุ่ม "บ้านเดียวกับคิว #N" ให้กด */
  chainHouse(row: UnassignedReading): { members_id: number; house_no: string } | null {
    const chain = row.chain;
    if (!chain?.members_id) return null;
    return { members_id: chain.members_id, house_no: chain.house_no ?? `บ้าน #${chain.members_id}` };
  }

  /**
   * เปิดใบนี้พร้อมติ๊กบ้านเดียวกับใบก่อนหน้าไว้ให้ (ปุ่มลัดบนการ์ด)
   *
   * ยังต้องกด "จับคู่แล้วออกบิล" อีกทีเสมอ — ปุ่มนี้ย่นแค่ขั้นตอนหาบ้าน ไม่ได้ข้ามขั้นตอน
   * ที่คนต้องเห็นรูปกับตัวเลขก่อนตัดสิน ซึ่งเป็นทั้งหมดที่หน้านี้มีไว้ทำ
   */
  openWithChain(row: UnassignedReading): void {
    this.preselectMemberId = this.chainHouse(row)?.members_id ?? null;
    this.open(row);
  }

  reload(afterLoad?: () => void): void {
    this.isLoading.set(true);

    this.service.list('Pending').subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.isLoading.set(false);
        afterLoad?.();
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
        //
        // ข้อยกเว้นเดียวคือคนกดปุ่ม "บ้านเดียวกับคิว #N" มาเอง ซึ่งเป็นการเลือกของคน
        // ไม่ใช่การเดาของระบบ
        if (this.preselectMemberId) {
          this.selectedMemberId = this.preselectMemberId;
          this.preselectMemberId = null;
        }
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
              // ใบที่เชื่อมกับใบนี้เพิ่งรู้บ้านไปด้วยโดยอัตโนมัติ — พาไปดูเลย
              // ไม่งั้นมันจะจมอยู่กลางคิวยาว ๆ แล้วไม่มีใครรู้ว่าตอนนี้ตอบได้แล้ว
              this.reload(() => this.revealChained(row.id));
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

  /**
   * เลื่อนไปหาใบที่เชื่อมกับใบที่เพิ่งจับคู่ไป แล้วไฮไลต์ไว้ชั่วคราว
   *
   * ═══ ทำไมต้องเลื่อนให้ ═══
   *
   * ใบคู่หูอาจอยู่ห่างออกไปหลายสิบใบในคิวที่เรียงตามเวลาเข้าคิว การบอกด้วยข้อความเฉย ๆ
   * ว่า "มีใบที่เกี่ยวข้อง" แปลว่าคนต้องไถหาเอง ซึ่งแทบไม่มีใครทำ แล้วใบนั้นก็ค้างต่อไป
   *
   * ต้องเลื่อนผ่าน viewport ของ virtual scroll ไม่ใช่ scrollIntoView ตรง ๆ เพราะการ์ด
   * ที่อยู่นอกจอ **ยังไม่ถูกสร้างใน DOM** — หา element ไม่เจอตั้งแต่แรก
   * เลื่อนด้วย index ให้ CDK สร้างการ์ดขึ้นมาก่อน แล้วค่อยจัดตำแหน่งให้พอดีกลางจออีกที
   */
  private revealChained(assignedId: number): void {
    const index = this.rows().findIndex((row) => row.chain?.id === assignedId);
    if (index < 0) return;

    const target = this.rows()[index];
    this.viewport()?.scrollToIndex(index, 'smooth');
    this.highlightedId.set(target.id);

    if (this.highlightTimer) clearTimeout(this.highlightTimer);
    // ไฮไลต์ค้างถาวรจะกลายเป็นสีที่ไม่มีความหมาย — ดับเองหลังคนได้เห็นแล้ว
    this.highlightTimer = setTimeout(() => this.highlightedId.set(null), 5000);

    // รอให้ CDK สร้างการ์ดเสร็จก่อน แล้วค่อยจัดให้อยู่กลางจอ (เผื่อ scrollToIndex
    // วางไว้ชิดขอบบนจนอ่านไม่สะดวก) — ไม่เจอ element ก็ไม่เป็นไร เลื่อนไปแล้วรอบหนึ่ง
    setTimeout(() => {
      const element = document.querySelector(`[data-queue-id="${target.id}"]`);
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 250);

    toast.info(
      `คิว #${target.id} เป็นมิเตอร์ตัวเดียวกัน — ตรวจเลขแล้วกดยืนยันบ้านเดียวกันได้เลยครับ`,
      { id: 'chain-reveal' }
    );
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
