import { ChangeDetectorRef, Component, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ImageCropperComponent, ImageTransform, OutputFormat } from 'ngx-image-cropper';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { switchMap, throwError } from 'rxjs';
import { toast } from 'ngx-sonner';
import { MeterReadingService } from '../../services/meter-reading.service';
import { MemberService } from '../../../member/services/member.service';
import { AuthService } from '../../../auth/services/auth.service';
import { extractErrorMessage } from '../../../auth/services/auth-error';
import { BillPrintService } from '../../services/bill-print.service';

@Component({
  selector: 'app-meter-cropper',
  standalone: true,
  // eslint-disable-next-line @angular-eslint/no-unused-standalone-imports
  imports: [CommonModule, FormsModule, ImageCropperComponent],
  templateUrl: './meter-cropper.html',
  styleUrls: ['./meter-cropper.css']
})
export class MeterCropperComponent implements OnInit {
  // ==========================================
  // โซนประกาศตัวแปร
  // ==========================================
  imageChangedEvent: Event | null = null;
  croppedImage: SafeUrl = '';
  croppedBlob: Blob | null | undefined = null;
  aiResult: any = null;
  isLoading = false;
  isSaving = false;
  saveSuccess = false;
  maintainAspectRatio = false;
  aspectRatio = 3 / 1;
  transform: ImageTransform = {};
  private rotation = 0;
  private scale = 1;

  // 🌟 บ้านที่กำลังจดมิเตอร์ — บิลต้องผูกกับบ้าน ถ้าไม่เลือกจะบันทึกไม่ได้
  members: any[] = [];
  selectedMemberId: number | null = null;

  /**
   * บิลนี้เป็นของเดือนไหน — ให้เลือกเอง ไม่ผูกกับวันที่กดบันทึก
   *
   * ถ้าคิดจาก new Date() ตอนกดบันทึก จะพังเวลาไปจดมิเตอร์สิ้นเดือนแล้วมาบันทึกวันที่ 1
   * ของเดือนถัดไป บิลจะไปลงเดือนใหม่ เดือนที่ใช้น้ำจริงเลยไม่มีบิล แถมไปกินโควตา
   * "1 บ้าน 1 บิลต่อเดือน" ของเดือนที่ยังไม่ได้จดอีก
   *
   * ⚠️ print ต้องประกาศก่อน billingMonths — field initializer ทำงานตามลำดับที่เขียน
   *    ถ้าสลับที่ จะเรียก this.print ตอนที่ยังเป็น undefined โดย TypeScript ไม่เตือน
   */
  private print = inject(BillPrintService);
  readonly billingMonths = this.buildMonthOptions();
  billingKey = this.billingMonths[0].key;

  /** เดือนปัจจุบันย้อนหลัง 6 เดือน — ครอบคลุมการจดย้อนหลังโดยไม่ให้เลือกมั่วไปไกล */
  private buildMonthOptions(): { key: string; month: string; year: string; label: string }[] {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = String(d.getFullYear());
      return {
        key: `${year}-${month}`,
        month,
        year,
        // ใช้ monthLabel ตัวเดียวกับใบเสร็จ ชื่อเดือน/ปี พ.ศ. จะได้ตรงกันทั้งระบบ
        label: this.print.monthLabel(month, year) + (i === 0 ? ' (เดือนนี้)' : '')
      };
    });
  }

  /** ตัวเลือกเดือนที่กำลังเลือกอยู่ — ใช้ตอนส่งบิลและตอนเช็คบิลซ้ำ */
  get selectedBilling() {
    return this.billingMonths.find((m) => m.key === this.billingKey) ?? this.billingMonths[0];
  }

  // เลขตั้งต้นของบ้าน+เดือนที่เลือก — โหลดไว้ล่วงหน้าเพื่อคำนวณ/เตือน "ก่อน" กดบันทึก
  previousReading: number | null = null;
  isLoadingPrevious = false;
  /** เลขตั้งต้นมาจากไหน — เจ้าหน้าที่ควรรู้ว่าคิดจากบิลเดือนก่อน หรือเลขตอนลงทะเบียนบ้าน */
  previousSource: 'bill' | 'registration' | 'none' = 'none';
  // หน่วยที่ใช้เดือนก่อน (ไว้เทียบว่าครั้งนี้กระโดดผิดปกติไหม)
  private previousUsage: number | null = null;

  // บิลที่เพิ่งสร้าง — เก็บไว้ให้กด "ยกเลิก" ย้อนได้ทันทีถ้าบันทึกผิด
  savedBill: any = null;
  isUndoing = false;

  // บิลของเดือนที่เลือกที่ออกไปแล้ว (null = ยังไม่เคยออก) — 1 บ้านมีบิลได้เดือนละใบเดียว
  existingBill: any = null;
  /** บิลที่เพิ่งบันทึกไปทับใบเดิมมา — กดยกเลิกแล้วบ้านหลังนี้จะไม่เหลือบิลของเดือนนั้นเลย */
  didReplace = false;
  /** ข้อความเตือนหน่วยน้ำผิดปกติจากหลังบ้าน (null = ยังไม่โดนเตือน) */
  highUsageWarning: string | null = null;

  private auth = inject(AuthService);

  constructor(
    private sanitizer: DomSanitizer,
    private meterReadingService: MeterReadingService,
    private memberService: MemberService,
    private cdr: ChangeDetectorRef
  ) {}

  // ตอน prerender (SSR) ยังไม่มี token ใน localStorage ยิง API ไปก็ได้ 401 เปล่า ๆ
  // ต้องข้ามไปก่อน แล้วให้ฝั่ง browser โหลดจริง ไม่งั้น build จะพังตอน prerender
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  ngOnInit(): void {
    if (!this.isBrowser) return;

    this.memberService.getMembers().subscribe({
      next: (members) => {
        this.members = members ?? [];
        this.cdr?.detectChanges();
      },
      error: (err) => {
        console.error('ดึงรายชื่อลูกบ้านไม่สำเร็จ:', err);
        toast.error(extractErrorMessage(err, 'โหลดรายชื่อบ้านไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), { id: 'member-load-error' });
      }
    });
  }

  // เลือกบ้านแล้วรีบไปถามเลขตั้งต้น เอาไว้คำนวณและเตือนก่อนบันทึก
  onMemberChange(): void {
    this.resetLookups();
    if (!this.selectedMemberId) return;
    this.loadForSelection();
  }

  /** เปลี่ยนเดือนบิลแล้วต้องเช็คใหม่ — คนละเดือนคือคนละใบ และเลขตั้งต้นก็คนละตัว */
  onBillingMonthChange(): void {
    this.resetLookups();
    if (!this.selectedMemberId) return;
    this.loadForSelection();
  }

  private resetLookups(): void {
    this.previousReading = null;
    this.previousUsage = null;
    this.previousSource = 'none';
    this.existingBill = null;
    this.highUsageWarning = null;
  }

  /**
   * ถามหลังบ้าน 2 อย่างพร้อมกันสำหรับบ้าน+เดือนที่เลือก
   *   1. เดือนนี้ออกบิลไปแล้วหรือยัง (กันออกซ้ำ)
   *   2. เลขตั้งต้นที่จะใช้คิดหน่วยน้ำ
   *
   * เช็คตั้งแต่ตอนเลือก ไม่รอไปเตือนตอนกดบันทึก ไม่งั้นเจ้าหน้าที่จะเสียเวลา
   * ถ่าย-ครอป-รอ AI อ่านเลขไปฟรี ๆ ก่อนโดนปฏิเสธ
   */
  private loadForSelection(): void {
    const memberId = Number(this.selectedMemberId);
    const billing = this.selectedBilling;

    this.meterReadingService.getBillForMonth(memberId, billing.month, billing.year).subscribe({
      next: (bill) => {
        this.existingBill = bill ?? null;
        this.cdr?.detectChanges();
      },
      error: (err) => console.error('เช็คบิลของเดือนที่เลือกไม่สำเร็จ:', err)
    });

    this.isLoadingPrevious = true;
    this.meterReadingService.getPreviousUnit(memberId, billing.month, billing.year).subscribe({
      next: (res) => {
        this.isLoadingPrevious = false;
        this.previousReading = Number(res?.previous_unit ?? 0);
        this.previousSource = res?.source ?? 'none';
        this.previousUsage = res?.bill ? Number(res.bill.usage_unit) : null;
        this.cdr?.detectChanges();
      },
      error: (err) => {
        this.isLoadingPrevious = false;
        console.error('ดึงเลขตั้งต้นของเดือนที่เลือกไม่สำเร็จ:', err);
        this.cdr?.detectChanges();
      }
    });
  }

  // ==========================================
  // โซนฟังก์ชันจัดการรูปภาพ (เลือกรูป & ครอปรูป)
  // ==========================================
  fileChangeEvent(event: Event): void {
    this.imageChangedEvent = event;
    // รีเซ็ตค่าผลลัพธ์เก่าทิ้งเวลาเลือกรูปใหม่
    this.aiResult = null;
    this.saveSuccess = false;
    this.resetImage();
  }

  imageCropped(event: any) {
    this.croppedImage = this.sanitizer.bypassSecurityTrustUrl(event.objectUrl);
    this.croppedBlob = event.blob;
  }

  // ==========================================
  // โซนฟังก์ชันปรับแต่งรูปภาพ (หมุน, สลับ, ซูม)
  // ==========================================
  rotateLeft(): void {
    this.rotation -= 90;
    this.updateTransform();
  }

  rotateRight(): void {
    this.rotation += 90;
    this.updateTransform();
  }

  flipHorizontal(): void {
    this.transform = {
      ...this.transform,
      flipH: !this.transform.flipH
    };
  }

  flipVertical(): void {
    this.transform = {
      ...this.transform,
      flipV: !this.transform.flipV
    };
  }

  zoomIn(): void {
    this.scale += 0.1;
    this.updateTransform();
  }

  zoomOut(): void {
    this.scale = Math.max(0.1, this.scale - 0.1);
    this.updateTransform();
  }

  resetImage(): void {
    this.rotation = 0;
    this.scale = 1;
    this.transform = {};
  }

  private updateTransform(): void {
    this.transform = {
      ...this.transform,
      rotate: this.rotation,
      scale: this.scale
    };
  }

  // ==========================================
  // โซนแสดงความมั่นใจของการอ่านเลข (เอาไว้ทำแถบสีบนหน้าจอ)
  // ==========================================

  // อ่านค่าความมั่นใจจากหลังบ้าน ถ้าไม่ได้ส่งมาก็คืน null (หน้าจอจะขึ้นเป็นสีเหลืองให้ตรวจสอบเอง)
  get confidencePercent(): number | null {
    const raw = this.aiResult?.confidence ?? this.aiResult?.score ?? null;
    const value = typeof raw === 'string' ? parseFloat(raw) : raw;
    if (typeof value !== 'number' || isNaN(value)) return null;

    // หลังบ้านอาจส่งมาเป็น 0–1 หรือ 0–100 ก็ได้ รองรับทั้งสองแบบ
    const percent = value <= 1 ? value * 100 : value;
    return Math.max(0, Math.min(100, Math.round(percent)));
  }

  // ชัดเจน = เขียว, ที่เหลือ (รวมถึงกรณีไม่รู้ค่า) = เหลือง ให้เจ้าหน้าที่ตรวจซ้ำ
  get isConfident(): boolean {
    const percent = this.confidencePercent;
    return percent !== null && percent >= 85;
  }

  get confidenceLabel(): string {
    const percent = this.confidencePercent;
    if (percent === null) return 'โปรดตรวจสอบตัวเลขอีกครั้ง';
    if (percent >= 85) return `อ่านได้ชัดเจน (${percent}%)`;
    return `อ่านได้ไม่ค่อยชัด (${percent}%) โปรดตรวจสอบ`;
  }

  // ==========================================
  // โซนคำนวณสด + เตือนก่อนบันทึก (เทียบกับเลขเดือนก่อน)
  // ==========================================

  /** เลขที่กรอกในช่อง (แปลงเป็นตัวเลข) — null ถ้ายังว่างหรือไม่ใช่ตัวเลข */
  get currentUnitValue(): number | null {
    const raw = this.aiResult?.read_unit;
    const value = typeof raw === 'string' ? parseFloat(raw) : raw;
    return typeof value === 'number' && !isNaN(value) ? value : null;
  }

  /** หน่วยที่ใช้เดือนนี้ = เลขนี้ − เลขเดือนก่อน (โชว์ให้เห็นสด ๆ ขณะแก้เลข) */
  get usageUnit(): number | null {
    if (this.currentUnitValue === null || this.previousReading === null) return null;
    return this.currentUnitValue - this.previousReading;
  }

  /** เลขน้อยกว่าเดือนก่อน = ผิดแน่ (มิเตอร์ไม่เดินถอยหลัง) — กันไว้ก่อนบันทึก */
  get isBelowPrevious(): boolean {
    return this.usageUnit !== null && this.usageUnit < 0;
  }

  /** ใช้น้ำมากผิดปกติ = กระโดดเกิน 3 เท่าของเดือนก่อน และต่างกันเยอะพอ (กันเตือนพร่ำเพรื่อกับเลขน้อย ๆ) */
  get isAbnormalJump(): boolean {
    if (this.usageUnit === null || this.previousUsage === null || this.previousUsage <= 0) return false;
    return this.usageUnit > this.previousUsage * 3 && this.usageUnit - this.previousUsage >= 30;
  }

  // ==========================================
  // โซนฟังก์ชันคุยกับหลังบ้าน (NestJS)
  // ==========================================

  // 1. ส่งรูปไปสแกนเลข
  uploadToBackend() {
    if (!this.croppedBlob) return;

    this.isLoading = true;
    this.aiResult = null;
    this.saveSuccess = false;

    const formData = new FormData();
    // ตั้งชื่อไฟล์จำลองให้ NestJS รับไปใช้งาน
    formData.append('file', this.croppedBlob, 'meter-cropped.jpg');

    this.meterReadingService.uploadCroppedImage(formData).subscribe({
      next: (res) => {
        this.isLoading = false;
        this.aiResult = res; // เก็บผลลัพธ์ที่ได้จาก AI มาแสดงหน้าจอ
        this.cdr?.detectChanges();
      },
      error: (err) => {
        this.isLoading = false;
        console.error('Error:', err);
        this.cdr?.detectChanges();
        toast.error(extractErrorMessage(err, 'อ่านเลขมิเตอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), { id: 'api-error' });
      }
    });
  }

  // 2. กดยืนยันบันทึก — ต้องทำ 3 ขั้นตามลำดับ ไม่งั้นหลังบ้านจะหา id ที่อ้างถึงไม่เจอ
  //    (1) หาเรทค่าน้ำที่ใช้อยู่ + เลขมิเตอร์ครั้งก่อนของบ้านหลังนี้
  //    (2) บันทึกการจดมิเตอร์ครั้งนี้ เพื่อให้ได้ meter_readings_id จริง
  //    (3) สร้างบิลจาก id จริงทั้งหมด
  confirmAndSave(confirmHighUsage = false) {
    const currentUnit = Math.round(Number(this.aiResult?.read_unit));
    if (!this.aiResult || !currentUnit || isNaN(currentUnit)) return;

    if (!this.selectedMemberId) {
      toast.error('กรุณาเลือกบ้านเลขที่ก่อนบันทึกนะครับ', { id: 'need-member' });
      return;
    }

    const memberId = Number(this.selectedMemberId);
    const adminId = this.auth.admin()?.id;
    const billing = this.selectedBilling;

    let readingDate = new Date().toISOString().slice(0, 10);
    const captureDate = this.aiResult?.metadata?.captureDate;
    if (captureDate) {
      const datePart = captureDate.split(' ')[0];
      if (datePart) readingDate = datePart.replace(/:/g, '-');
    }

    this.isSaving = true;
    this.saveSuccess = false;

    // ไม่ส่ง previous_unit ไปแล้ว — หลังบ้านหาเลขตั้งต้นเองจากบิลเดือนก่อน (ไม่มีก็ใช้เลขตอนลงทะเบียน)
    // หน้าเว็บรู้แค่ "การจดครั้งล่าสุด" ซึ่งผิดทันทีที่จดย้อนหลัง เคยทำให้คิดเงินซ้ำมาแล้ว
    this.meterReadingService
      .getActiveWaterRate()
      .pipe(
        switchMap((rate) => {
          if (!rate?.id) {
            return throwError(() => new Error('ยังไม่มีเรทค่าน้ำที่เปิดใช้งานในระบบ กรุณาตั้งเรทค่าน้ำก่อน'));
          }

          // ยิงครั้งเดียวจบ — หลังบ้านตรวจให้ผ่านก่อนแล้วค่อยเขียนทั้ง meter_reading และบิล
          // แยกยิงสองรอบแบบเดิม พอรอบสองโดนปฏิเสธจะเหลือแถวที่จดไว้ค้างเป็นขยะ
          return this.meterReadingService.saveBillFromScan({
            members_id: memberId,
            water_rates_id: rate.id,
            current_unit: currentUnit,
            reading_date: readingDate,
            create_by: adminId,
            // เจ้าหน้าที่เห็นคำเตือนบนหน้าจอแล้วว่าจะทับของเดิม ถึงได้กดปุ่มนี้
            replace: !!this.existingBill,
            confirm_high_usage: confirmHighUsage,
            billing_month: billing.month,
            billing_year: billing.year
          });
        })
      )
      .subscribe({
        next: (bill) => {
          this.isSaving = false;
          this.saveSuccess = true;
          this.savedBill = bill; // เก็บไว้ให้กดยกเลิกย้อนได้
          // ทับใบเดิมไปแล้ว = ใบเก่าถูกลบถาวร กด "ยกเลิก" ต่อจากนี้จะไม่ได้ใบเดิมคืน
          // ต้องจำไว้เพื่อเปลี่ยนคำเตือน ไม่งั้นเจ้าหน้าที่จะเข้าใจว่ากดแล้วย้อนกลับไปใบเก่า
          this.didReplace = !!this.existingBill;
          this.existingBill = bill;
          this.highUsageWarning = null;
          this.cdr?.detectChanges();
          toast.success('บันทึกเลขมิเตอร์และสร้างบิลเรียบร้อยแล้ว', { id: 'save-success' });
        },
        error: (err) => {
          this.isSaving = false;
          console.error('Save error:', err);

          // หลังบ้านบล็อกเพราะหน่วยน้ำสูงผิดปกติ — ไม่ใช่ error แต่ต้องให้คนตรวจก่อน
          // เอาข้อความมาโชว์พร้อมปุ่มยืนยัน แทนที่จะเด้ง toast แดงแล้วจบ
          if (err?.status === 409 && !confirmHighUsage && this.isHighUsageBlock(err)) {
            this.highUsageWarning = extractErrorMessage(err, '');
            this.cdr?.detectChanges();
            return;
          }

          this.cdr?.detectChanges();
          toast.error(extractErrorMessage(err, 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), { id: 'save-error' });
        }
      });
  }

  /** 409 มีได้หลายสาเหตุ (บิลซ้ำเดือน / มีบิลใหม่กว่า) เอาเฉพาะเคสหน่วยน้ำสูงผิดปกติ */
  private isHighUsageBlock(err: any): boolean {
    return typeof err?.error?.message === 'string' && err.error.message.includes('หน่วย');
  }

  /** ตรวจแล้วว่าเลขถูก — ส่งใหม่พร้อมธงยืนยัน */
  confirmHighUsageAndSave(): void {
    this.highUsageWarning = null;
    this.confirmAndSave(true);
  }

  // 3. ยกเลิกบิลที่เพิ่งสร้าง (undo) — เผื่อกดบันทึกผิด ลบทิ้งแล้วเริ่มจดใหม่ได้เลย
  undoSave(): void {
    if (!this.savedBill?.id || this.isUndoing) return;

    this.isUndoing = true;
    this.meterReadingService.deleteBill(this.savedBill.id).subscribe({
      next: () => {
        this.isUndoing = false;
        this.savedBill = null;
        this.saveSuccess = false;
        this.didReplace = false;
        // โหลดเลขตั้งต้นใหม่ เพราะบิลกับการจดของรอบนี้ถูกลบไปแล้ว
        this.onMemberChange();
        this.cdr?.detectChanges();
        toast.success('ยกเลิกบิลเรียบร้อยแล้ว จดใหม่ได้เลยครับ', { id: 'undo-success' });
      },
      error: (err) => {
        this.isUndoing = false;
        console.error('Undo error:', err);
        this.cdr?.detectChanges();
        toast.error(extractErrorMessage(err, 'ยกเลิกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), { id: 'undo-error' });
      }
    });
  }
}
