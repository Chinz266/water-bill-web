import { ChangeDetectorRef, Component, OnDestroy, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { toast } from 'ngx-sonner';
import { MeterReadingService } from '../../services/meter-reading.service';
import { MemberService } from '../../../member/services/member.service';
import { AuthService } from '../../../auth/services/auth.service';
import { extractErrorMessage } from '../../../auth/services/auth-error';
import { BillPrintService } from '../../services/bill-print.service';
import { Village, VillageService } from '../../../village/services/village.service';
import { StoredQueue, StoredRow, clearQueue, loadQueue, saveQueue } from '../../services/batch-queue.store';

/**
 * สถานะของแต่ละแถว — แยก "อ่านไม่ผ่าน" กับ "ออกบิลไม่ผ่าน" ออกจากกัน
 * ถ้ารวมเป็นอันเดียว การสั่งอ่านใหม่จะไปล้างเลขของแถวที่คนเพิ่งนั่งแก้เองทิ้ง
 */
type RowStatus =
  | 'pending'
  | 'ready'
  | 'saving'
  | 'saved'
  | 'read_failed'
  | 'save_failed'
  /** กู้คิวมาแล้วค้างอยู่ตอนกำลังออกบิล — ไม่มีทางรู้ว่าไปถึงหลังบ้านหรือยัง */
  | 'unknown';

/** บ้านที่หลังบ้านเสนอมาสำหรับรูปใบหนึ่ง */
interface Candidate {
  members_id: number;
  house_no: string;
  name: string;
  previous_unit: number;
  usage_unit: number;
  average_usage: number | null;
  already_billed: boolean;
  score: number;
  distance_m: number | null;
}

interface ScanRow {
  seq: number;
  /** null = แถวที่กู้มาจากคิวเก่า ตัวรูปไม่ได้ถูกเก็บไว้ */
  file: File | null;
  fileKey: string;
  fileName: string;
  previewUrl: string | null;
  brokenImage: boolean;

  capturedAt: Date | null;
  latitude: number | null;
  longitude: number | null;

  memberId: number | null;
  /** ระบบเสนอให้ หรือคนเลือกเอง — ต้องแยกให้ออกเวลาไล่ตรวจ */
  matchedBy: 'system' | 'manual' | 'none';
  matchConfidence: 'high' | 'medium' | 'ambiguous' | 'none' | null;
  matchReason: string | null;
  candidates: Candidate[];
  warnings: string[];

  unit: number | null;
  confidence: number | null;
  confirmHighUsage: boolean;

  status: RowStatus;
  error: string | null;
  billId: number | null;
}

/**
 * สแกนมิเตอร์หลายรูปพร้อมกัน
 *
 * งานหนักทั้งหมดอยู่ที่ POST /bills/scan-batch ของหลังบ้าน — อ่านเลขทุกใบ
 * แล้วจับคู่กับบ้านจาก **เลขมิเตอร์** (ยอดสะสมที่แต่ละบ้านห่างกันมาก)
 * ไม่ใช่ GPS ซึ่งแยกบ้านที่ห่างกัน 8–20 ม. ไม่ได้จริง
 *
 * หน้านี้ทำแค่ 3 อย่าง: ส่งรูปไปให้วิเคราะห์ · ให้คนตรวจ/แก้ · ยิงออกบิลทีละใบ
 *
 * ⚠️ ห้ามออกบิลเองอัตโนมัติเด็ดขาด ทุกแถวต้องผ่านตาคนก่อน เพราะเดิมพันคือ
 *    เงินที่ลูกบ้านต้องจ่าย และมีเคสที่เลขมิเตอร์อย่างเดียวแยกไม่ออกจริง ๆ
 */
@Component({
  selector: 'app-batch-scan',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './batch-scan.html',
  styleUrls: ['./batch-scan.css']
})
export class BatchScanComponent implements OnInit, OnDestroy {
  private meterReadingService = inject(MeterReadingService);
  private memberService = inject(MemberService);
  private villageService = inject(VillageService);
  private auth = inject(AuthService);
  private print = inject(BillPrintService);
  private cdr = inject(ChangeDetectorRef);

  /** เพดานของหลังบ้าน (ScanBatchService.MAX_FILES) — ส่งเกินนี้โดนตีกลับทั้งชุด */
  readonly maxFiles = 30;

  members: any[] = [];
  villages: Village[] = [];
  rows: ScanRow[] = [];
  readonly billingMonths = this.print.monthOptions(6);

  /** ทั้งกองใช้รอบบิลเดียวกัน — หลังบ้านคิดเลขตั้งต้นของทุกบ้านจากเดือนนี้ */
  billingKey = this.billingMonths[0].key;
  /** จำกัดบ้านที่เอามาจับคู่ให้เหลือหมู่บ้านเดียว ลดโอกาสจับคู่ผิดโดยไม่จำเป็น */
  villagesId: number | null = null;

  isAnalyzing = false;
  isSaving = false;
  progress = { done: 0, total: 0 };
  replaceExisting = false;

  membersFailed = false;
  isLoadingMembers = true;
  pendingRestore: StoredQueue | null = null;

  private stopRequested = false;
  private seq = 0;
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** ปิดแท็บกลางคิว = บิลออกไปครึ่งกองแล้วไม่มีใครรู้ว่าถึงใบไหน */
  private readonly warnBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!this.isBusy) return;
    event.preventDefault();
    event.returnValue = '';
  };

  ngOnInit(): void {
    if (!this.isBrowser) return;

    window.addEventListener('beforeunload', this.warnBeforeUnload);
    this.pendingRestore = loadQueue(this.auth.admin()?.id ?? null);
    this.loadMembers();

    this.villageService.getVillages().subscribe({
      next: (villages) => {
        this.villages = villages ?? [];
        // มีหมู่บ้านเดียว (กรณีปกติ) เลือกให้เลย จะได้ไม่ต้องกดเอง
        if (this.villages.length === 1) this.villagesId = this.villages[0].id;
        this.cdr.detectChanges();
      },
      error: (err) => console.error('โหลดรายชื่อหมู่บ้านไม่สำเร็จ:', err)
    });
  }

  ngOnDestroy(): void {
    if (this.isBrowser) window.removeEventListener('beforeunload', this.warnBeforeUnload);
    this.rows.forEach((row) => this.releasePreview(row));
  }

  private releasePreview(row: ScanRow): void {
    if (row.previewUrl) URL.revokeObjectURL(row.previewUrl);
  }

  loadMembers(): void {
    this.isLoadingMembers = true;
    this.membersFailed = false;

    this.memberService.getMembers().subscribe({
      next: (members) => {
        this.members = members ?? [];
        this.isLoadingMembers = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('ดึงรายชื่อลูกบ้านไม่สำเร็จ:', err);
        this.isLoadingMembers = false;
        this.membersFailed = true;
        this.cdr.detectChanges();
        toast.error(extractErrorMessage(err, 'โหลดรายชื่อบ้านไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), { id: 'member-load-error' });
      }
    });
  }

  stopQueue(): void {
    if (!this.isSaving) return;
    this.stopRequested = true;
    toast.success('จะหยุดหลังออกบิลใบที่ค้างอยู่เสร็จนะครับ', { id: 'batch-stop' });
  }

  // ==========================================
  // เลือกรูป
  // ==========================================

  onFilesPicked(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const picked = Array.from(input?.files ?? []);
    // ล้างค่าใน input ไม่งั้นเลือกโฟลเดอร์เดิมซ้ำจะไม่มี event ให้จับ
    if (input) input.value = '';

    // เลือกทั้งโฟลเดอร์จะมีไฟล์อื่นติดมาด้วย (.txt, .DS_Store) คัดเฉพาะรูป
    const images = picked.filter((file) => file.type.startsWith('image/'));
    const skipped = picked.length - images.length;
    if (!images.length) {
      if (picked.length) toast.error('ไม่พบไฟล์รูปในที่ที่เลือกครับ', { id: 'batch-no-image' });
      return;
    }

    // เลือกโฟลเดอร์เดิมซ้ำเป็นเรื่องปกติมาก ถ้าไม่กันจะได้รูปเดิมสองแถวแล้วชนกันเอง
    const known = new Set(this.rows.map((row) => row.fileKey));
    const fresh = images.filter((file) => !known.has(this.keyOf(file)));
    const duplicated = images.length - fresh.length;

    const room = this.maxFiles - this.rows.length;
    if (room <= 0) {
      toast.error(`ใส่ได้ครั้งละไม่เกิน ${this.maxFiles} รูปครับ`, { id: 'batch-limit' });
      return;
    }

    const taking = fresh.slice(0, room);
    taking.forEach((file) => this.rows.push(this.buildRow(file)));
    this.persist();
    this.cdr.detectChanges();

    if (skipped > 0) toast.success(`ข้ามไฟล์ที่ไม่ใช่รูป ${skipped} ไฟล์ครับ`, { id: 'batch-skipped' });
    if (duplicated > 0) toast.success(`ข้ามรูปที่อยู่ในคิวอยู่แล้ว ${duplicated} รูปครับ`, { id: 'batch-dup-file' });
    if (fresh.length > taking.length) {
      toast.error(`ใส่ได้อีกแค่ ${room} รูป ส่วนที่เหลือยังไม่ได้ใส่ครับ`, { id: 'batch-limit' });
    }
  }

  private keyOf(file: File): string {
    return `${file.name}|${file.size}|${file.lastModified}`;
  }

  private buildRow(file: File): ScanRow {
    return {
      seq: ++this.seq,
      file,
      fileKey: this.keyOf(file),
      fileName: file.name,
      previewUrl: URL.createObjectURL(file),
      brokenImage: false,
      capturedAt: null,
      latitude: null,
      longitude: null,
      memberId: null,
      matchedBy: 'none',
      matchConfidence: null,
      matchReason: null,
      candidates: [],
      warnings: [],
      unit: null,
      confidence: null,
      confirmHighUsage: false,
      status: 'pending',
      error: null,
      billId: null
    };
  }

  removeRow(row: ScanRow): void {
    if (this.isBusy) return;
    this.releasePreview(row);
    this.rows = this.rows.filter((r) => r !== row);
    this.persist();
  }

  clearAll(): void {
    if (this.isBusy) return;
    this.rows.forEach((r) => this.releasePreview(r));
    this.rows = [];
    this.progress = { done: 0, total: 0 };
    clearQueue();
  }

  onImageError(row: ScanRow): void {
    row.brokenImage = true;
  }

  onMemberChanged(row: ScanRow): void {
    row.matchedBy = row.memberId ? 'manual' : 'none';
    this.persist();
  }

  onRowEdited(): void {
    this.persist();
  }

  // ==========================================
  // ส่งให้หลังบ้านอ่านเลข + จับคู่บ้าน
  // ==========================================

  get analyzableRows(): ScanRow[] {
    // ต้องมีตัวไฟล์ด้วย — แถวที่กู้มาจากคิวเก่าไม่มีรูปให้ส่งแล้ว
    return this.rows.filter((row) => !!row.file && (row.status === 'pending' || row.status === 'read_failed'));
  }

  analyze(): void {
    if (this.isBusy) return;

    const queue = this.analyzableRows;
    if (!queue.length) {
      toast.success('ไม่มีรูปที่ต้องอ่านเลขแล้วครับ', { id: 'batch-read-none' });
      return;
    }

    const billing = this.selectedBilling;
    const form = new FormData();
    // ชื่อ field ต้องเป็น 'files' ให้ตรงกับ FilesInterceptor ของหลังบ้าน
    queue.forEach((row) => form.append('files', row.file!, row.fileName));
    form.append('billing_month', billing.month);
    form.append('billing_year', billing.year);
    if (this.villagesId) form.append('villages_id', String(this.villagesId));

    this.isAnalyzing = true;
    this.progress = { done: 0, total: queue.length };
    this.cdr.detectChanges();

    this.meterReadingService.scanBatch(form).subscribe({
      next: (res: any) => {
        this.isAnalyzing = false;
        this.applyResults(queue, res?.results ?? []);
        this.progress.done = queue.length;
        this.persist();
        this.cdr.detectChanges();

        const summary = res?.summary;
        toast.success(
          summary
            ? `อ่านครบ ${queue.length} รูป — มั่นใจสูง ${summary.high} · ต้องตรวจ ${summary.medium + summary.ambiguous + summary.none}`
            : `อ่านครบ ${queue.length} รูปแล้วครับ`,
          { id: 'batch-read-done' }
        );
      },
      error: (err) => {
        this.isAnalyzing = false;
        console.error('วิเคราะห์รูปไม่สำเร็จ:', err);
        // ทั้งชุดล้มพร้อมกัน (คนละแบบกับตอนออกบิลที่ล้มทีละใบ) เพราะยิงไปครั้งเดียว
        queue.forEach((row) => {
          row.status = 'read_failed';
          row.error = 'อ่านเลขไม่สำเร็จ ลองใหม่หรือกรอกเลขเองได้ครับ';
        });
        this.cdr.detectChanges();
        toast.error(extractErrorMessage(err, 'อ่านรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), { id: 'batch-read-error' });
      }
    });
  }

  /** ผลลัพธ์อ้างอิงด้วย index ของไฟล์ที่ส่งไป ไม่ใช่ลำดับแถวบนจอ */
  private applyResults(queue: ScanRow[], results: any[]): void {
    for (const result of results) {
      const row = queue[Number(result?.index)];
      if (!row) continue;

      row.unit = this.toUnit(result?.reading?.meter_unit);
      row.confidence = this.toPercent(result?.reading?.confidence);
      row.matchConfidence = result?.confidence ?? 'none';
      row.matchReason = result?.reason ?? null;
      row.warnings = Array.isArray(result?.warnings) ? result.warnings : [];
      row.candidates = Array.isArray(result?.candidates) ? result.candidates : [];

      const taken = result?.photo_taken;
      row.capturedAt = taken?.captured_at ? new Date(taken.captured_at) : null;
      row.latitude = Number.isFinite(Number(taken?.latitude)) ? Number(taken.latitude) : null;
      row.longitude = Number.isFinite(Number(taken?.longitude)) ? Number(taken.longitude) : null;

      // คนแก้บ้านเองไว้แล้วต้องไม่ให้ผลจากหลังบ้านทับ
      if (row.matchedBy !== 'manual') {
        const suggested = result?.suggestion?.members_id ?? null;
        row.memberId = suggested;
        row.matchedBy = suggested ? 'system' : 'none';
      }

      row.status = row.unit === null ? 'read_failed' : 'ready';
      row.error = row.unit === null ? (result?.reason ?? 'อ่านเลขจากรูปนี้ไม่ได้ กรอกเองได้ครับ') : null;
    }
  }

  private toUnit(raw: unknown): number | null {
    const value = typeof raw === 'string' ? parseFloat(raw) : raw;
    return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
  }

  private toPercent(raw: unknown): number | null {
    const value = typeof raw === 'string' ? parseFloat(raw) : raw;
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    // หลังบ้านส่งมาได้ทั้ง 0–1 และ 0–100
    return Math.max(0, Math.min(100, Math.round(value <= 1 ? value * 100 : value)));
  }

  // ==========================================
  // ตรวจความพร้อมของแต่ละแถว
  // ==========================================

  get selectedBilling() {
    return this.billingMonths.find((m) => m.key === this.billingKey) ?? this.billingMonths[0];
  }

  memberLabel(id: number | null): string {
    const member = this.members.find((m) => m.id === Number(id));
    return member ? `${member.house_no} — ${member.fname ?? ''} ${member.lname ?? ''}`.trim() : '—';
  }

  dateLabel(value: Date | null): string {
    return this.print.dateLabel(value);
  }

  confidenceLabel(row: ScanRow): string {
    switch (row.matchConfidence) {
      case 'high': return 'มั่นใจสูง';
      case 'medium': return 'ควรตรวจก่อน';
      case 'ambiguous': return 'แยกไม่ออก เลือกเอง';
      case 'none': return 'เดาไม่ได้ เลือกเอง';
      default: return '';
    }
  }

  /**
   * รูปหลายใบที่ชี้บ้านเดียวกันในกองเดียวกัน — 1 บ้านมีบิลได้เดือนละใบเดียว
   * ถ้าปล่อยผ่าน ใบหลังจะไปทับใบหน้าเงียบ ๆ เหลือบิลจากรูปสุดท้ายใบเดียว
   */
  isDuplicate(row: ScanRow): boolean {
    if (!row.memberId) return false;
    return this.rows.some(
      (other) => other !== row && other.status !== 'saved' && other.memberId === row.memberId
    );
  }

  blockingIssue(row: ScanRow): string | null {
    if (row.status === 'saved') return null;
    if (!row.memberId) return 'ยังไม่รู้ว่าเป็นบ้านหลังไหน กรุณาเลือกเองครับ';
    if (row.unit === null) return 'ยังไม่มีเลขมิเตอร์ กรุณากรอกเองครับ';
    if (row.unit < 0) return 'เลขมิเตอร์ติดลบไม่ได้ครับ';
    if (this.isDuplicate(row)) return 'ซ้ำกับอีกรูปที่เป็นบ้านเดียวกันครับ';
    return null;
  }

  /** เรื่องที่ควรรู้แต่ไม่ถึงกับห้ามบันทึก (รวมคำเตือนที่หลังบ้านส่งมาด้วย) */
  notes(row: ScanRow): string[] {
    const notes = [...row.warnings];
    if (!row.file) notes.push('แถวที่กู้มาจากคิวเก่า ไม่มีรูปให้เทียบแล้ว');
    if (row.brokenImage) notes.push('เปิดรูปนี้ไม่ขึ้น เทียบเลขกับหน้าปัดด้วยตาไม่ได้');
    if (row.file && row.file.size > 12 * 1024 * 1024) notes.push('ไฟล์ใหญ่มาก อัปโหลดอาจช้าหรือหลุด');
    if (row.status === 'unknown') {
      notes.push('ค้างอยู่ตอนออกบิลรอบก่อน กดออกบิลซ้ำได้ ถ้ามีบิลอยู่แล้วระบบจะบอกเอง');
    }
    if (row.confidence !== null && row.confidence < 85) notes.push(`AI อ่านได้ไม่ค่อยชัด (${row.confidence}%)`);
    return notes;
  }

  get savableRows(): ScanRow[] {
    return this.rows.filter((row) => row.status !== 'saved' && this.blockingIssue(row) === null);
  }

  get savedCount(): number {
    return this.rows.filter((row) => row.status === 'saved').length;
  }

  get needsAttention(): number {
    return this.rows.filter((row) => row.status !== 'saved' && this.blockingIssue(row) !== null).length;
  }

  get isBusy(): boolean {
    return this.isAnalyzing || this.isSaving;
  }

  get progressPercent(): number {
    if (!this.progress.total) return 0;
    return Math.min(100, (this.progress.done / this.progress.total) * 100);
  }

  needsHighUsageConfirm(row: ScanRow): boolean {
    return row.status === 'save_failed' && !row.confirmHighUsage && !!row.error?.includes('หน่วย');
  }

  confirmHighUsage(row: ScanRow): void {
    if (this.isBusy) return;
    row.confirmHighUsage = true;
    row.error = null;
    row.status = 'ready';
    this.persist();
  }

  // ==========================================
  // ออกบิลทีละใบ
  // ==========================================

  saveAll(): void {
    if (this.isBusy) return;

    const queue = this.savableRows;
    if (!queue.length) {
      toast.error('ยังไม่มีแถวไหนพร้อมออกบิลครับ', { id: 'batch-save-none' });
      return;
    }

    this.isSaving = true;
    this.stopRequested = false;
    this.progress = { done: 0, total: queue.length };

    // ดึงเรทค่าน้ำครั้งเดียวใช้ทั้งกอง ไม่ต้องถามซ้ำทุกใบ
    this.meterReadingService.getActiveWaterRate().subscribe({
      next: (rate) => {
        if (!rate?.id) {
          this.isSaving = false;
          this.cdr.detectChanges();
          toast.error('ยังไม่มีเรทค่าน้ำที่เปิดใช้งาน กรุณาตั้งเรทค่าน้ำก่อนครับ', { id: 'batch-no-rate' });
          return;
        }
        this.saveNext(queue, 0, rate.id);
      },
      error: (err) => {
        this.isSaving = false;
        this.cdr.detectChanges();
        toast.error(extractErrorMessage(err, 'ดึงเรทค่าน้ำไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), { id: 'batch-no-rate' });
      }
    });
  }

  private saveNext(queue: ScanRow[], index: number, rateId: number): void {
    if (index >= queue.length || this.stopRequested) {
      this.isSaving = false;
      this.cdr.detectChanges();

      const done = queue.slice(0, index);
      const failed = done.filter((row) => row.status === 'save_failed').length;

      if (this.stopRequested) {
        this.stopRequested = false;
        toast.success(`หยุดแล้วครับ ออกบิลไปทั้งหมด ${done.length - failed} ใบ`, { id: 'batch-save-done' });
        return;
      }

      toast.success(
        failed ? `ออกบิลสำเร็จ ${done.length - failed} ใบ ไม่สำเร็จ ${failed} ใบครับ` : `ออกบิลครบ ${queue.length} ใบแล้วครับ`,
        { id: 'batch-save-done' }
      );
      return;
    }

    const row = queue[index];
    // ปัดเศษด้วย เพราะเลขที่คนพิมพ์เองไม่ได้ผ่าน toUnit() มาเหมือนเลขที่ AI อ่าน
    const currentUnit = Math.round(Number(row.unit));

    row.status = 'saving';
    row.error = null;
    this.cdr.detectChanges();

    const billing = this.selectedBilling;

    /**
     * ถามเลขตั้งต้นก่อนเขียนจริง — ในโหมดกองไม่มีใครนั่งดูทีละใบ
     * ถ้าเลือกบ้านผิดแล้วเลขบังเอิญผ่านด่าน จะได้บิลผิดบ้านโดยไม่มีใครทัน
     */
    this.meterReadingService.getPreviousUnit(Number(row.memberId), billing.month, billing.year).subscribe({
      next: (res: any) => {
        const previous = Number(res?.previous_unit);
        if (Number.isFinite(previous) && currentUnit < previous) {
          row.status = 'save_failed';
          row.error = `เลข ${currentUnit} น้อยกว่าเลขตั้งต้นของบ้านนี้ (${previous}) มิเตอร์ไม่เดินถอยหลัง — ตรวจว่าเลือกบ้านถูกไหมครับ`;
          this.progress.done = index + 1;
          this.persist();
          this.saveNext(queue, index + 1, rateId);
          return;
        }
        this.postBill(queue, index, rateId, currentUnit, billing);
      },
      // ถามไม่ได้ก็ไม่ควรบล็อกทั้งกอง หลังบ้านตรวจซ้ำอยู่แล้วตอนออกบิล
      error: () => this.postBill(queue, index, rateId, currentUnit, billing)
    });
  }

  private postBill(
    queue: ScanRow[],
    index: number,
    rateId: number,
    currentUnit: number,
    billing: { month: string; year: string }
  ): void {
    const row = queue[index];

    this.meterReadingService
      .saveBillFromScan({
        members_id: Number(row.memberId),
        water_rates_id: rateId,
        current_unit: currentUnit,
        reading_date: this.print.isoDate(row.capturedAt ?? new Date()),
        create_by: this.auth.admin()?.id,
        replace: this.replaceExisting,
        // ข้ามด่านหน่วยผิดปกติได้เฉพาะแถวที่คนกดยืนยันเองแล้ว
        confirm_high_usage: row.confirmHighUsage,
        billing_month: billing.month,
        billing_year: billing.year,
        // ส่งพิกัด/เวลาที่ถ่ายไปเก็บด้วย หลังบ้านเอาไปเรียนรู้ตำแหน่งมิเตอร์ของบ้านหลังนี้
        latitude: row.latitude ?? undefined,
        longitude: row.longitude ?? undefined,
        captured_at: row.capturedAt ? row.capturedAt.toISOString() : undefined
      })
      .subscribe({
        next: (bill: any) => {
          row.status = 'saved';
          row.billId = bill?.id ?? null;
          this.progress.done = index + 1;
          // เก็บทุกใบ — ไฟดับตอนใบที่ 12 ต้องรู้ว่า 11 ใบแรกออกไปแล้ว
          this.persist();
          this.saveNext(queue, index + 1, rateId);
        },
        error: (err) => {
          console.error('ออกบิลไม่สำเร็จ:', err);
          row.status = 'save_failed';
          row.error = extractErrorMessage(err, 'ออกบิลไม่สำเร็จ');
          this.progress.done = index + 1;
          this.persist();
          // ใบนี้ไม่ผ่านก็ข้ามไปทำใบอื่นต่อ แล้วค่อยกลับมาแก้ทีหลัง
          this.saveNext(queue, index + 1, rateId);
        }
      });
  }

  // ==========================================
  // คิวที่ค้างจากครั้งก่อน (ไฟดับ/ปิดแท็บ)
  // ==========================================

  get pendingRestoreLeft(): number {
    return this.pendingRestore?.rows.filter((row) => row.status !== 'saved').length ?? 0;
  }

  resumeQueue(): void {
    const stored = this.pendingRestore;
    if (!stored) return;

    this.rows = stored.rows.filter((row) => row.status !== 'saved').map((row) => this.fromStored(row));
    this.seq = Math.max(0, ...this.rows.map((row) => row.seq));
    if (stored.rows[0]?.billingKey) this.billingKey = stored.rows[0].billingKey;
    this.pendingRestore = null;
    this.cdr.detectChanges();

    toast.success(`กู้คิวเก่ากลับมา ${this.rows.length} ใบแล้วครับ`, { id: 'batch-restore' });
  }

  discardQueue(): void {
    this.pendingRestore = null;
    clearQueue();
  }

  private fromStored(row: StoredRow): ScanRow {
    return {
      seq: row.seq,
      file: null,
      fileKey: `restored|${row.seq}`,
      fileName: row.fileName,
      previewUrl: null,
      brokenImage: false,
      capturedAt: row.capturedAt ? new Date(row.capturedAt) : null,
      latitude: row.latitude,
      longitude: row.longitude,
      memberId: row.memberId,
      matchedBy: (row.matchedBy as ScanRow['matchedBy']) ?? 'none',
      matchConfidence: null,
      matchReason: null,
      candidates: [],
      warnings: [],
      unit: row.unit,
      confidence: row.confidence,
      confirmHighUsage: row.confirmHighUsage,
      // ค้างตอนกำลังยิง = ไม่รู้ผล ส่วนค้างตอนกำลังอ่าน = รูปไม่อยู่แล้ว ต้องกรอกเอง
      status: row.status === 'saving' ? 'unknown' : row.status === 'reading' ? 'read_failed' : (row.status as RowStatus),
      error: row.status === 'reading' ? 'รูปไม่ได้ถูกเก็บไว้ กรุณากรอกเลขเองครับ' : row.error,
      billId: row.billId
    };
  }

  /** เก็บคิวลงเครื่องทุกครั้งที่มีอะไรเปลี่ยน จุดที่พังคือไฟดับกลางคิว */
  private persist(): void {
    if (!this.isBrowser) return;

    const unfinished = this.rows.filter((row) => row.status !== 'saved');
    if (!unfinished.length) {
      clearQueue();
      return;
    }

    saveQueue({
      savedAt: Date.now(),
      adminId: this.auth.admin()?.id ?? null,
      rows: this.rows.map((row) => this.toStored(row))
    });
  }

  private toStored(row: ScanRow): StoredRow {
    return {
      seq: row.seq,
      fileName: row.fileName,
      capturedAt: row.capturedAt ? row.capturedAt.toISOString() : null,
      latitude: row.latitude,
      longitude: row.longitude,
      memberId: row.memberId,
      matchedBy: row.matchedBy,
      matchMeters: null,
      billingKey: this.billingKey,
      billingFromPhoto: false,
      unit: row.unit,
      confidence: row.confidence,
      confirmHighUsage: row.confirmHighUsage,
      status: row.status,
      error: row.error,
      billId: row.billId
    };
  }
}
