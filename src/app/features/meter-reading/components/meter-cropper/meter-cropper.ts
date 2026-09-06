import { ChangeDetectorRef, Component, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ImageCropperComponent, ImageTransform, OutputFormat } from 'ngx-image-cropper';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { forkJoin, switchMap, throwError } from 'rxjs';
import { toast } from 'ngx-sonner';
import { MeterReadingService } from '../../services/meter-reading.service';
import { MemberService } from '../../../member/services/member.service';
import { AuthService } from '../../../auth/services/auth.service';
import { extractErrorMessage } from '../../../auth/services/auth-error';
import {
  CAPTURE_TIPS,
  OCR_ACCURACY_BY_CONFIDENCE,
  OCR_CONFIDENCE_THRESHOLD
} from '../../../../core/measurement.constants';

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

  // เลขมิเตอร์ครั้งก่อนของบ้านที่เลือก — โหลดไว้ล่วงหน้าเพื่อคำนวณ/เตือน "ก่อน" กดบันทึก
  previousReading: number | null = null;
  isLoadingPrevious = false;
  // หน่วยที่ใช้ครั้งก่อน (ไว้เทียบว่าครั้งนี้กระโดดผิดปกติไหม) — ต้องมีประวัติ ≥ 2 ครั้งถึงคำนวณได้
  private previousUsage: number | null = null;

  // บิลที่เพิ่งสร้าง — เก็บไว้ให้กด "ยกเลิก" ย้อนได้ทันทีถ้าบันทึกผิด
  savedBill: any = null;
  isUndoing = false;

  // จากการทดลอง: ภาพที่ค่าความเชื่อมั่นต่ำกว่าเกณฑ์อ่านถูกเพียง 30.5% และภาพที่ระบบ
  // ไม่ให้ค่าความเชื่อมั่นเลยอ่านถูก 0% — สองกลุ่มนี้จึงต้องให้เจ้าหน้าที่ติ๊กยืนยัน
  // ว่าเทียบเลขกับหน้าปัดแล้ว ก่อนจะกดบันทึกได้
  verifiedByStaff = false;
  readonly captureTips = CAPTURE_TIPS;

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

  // เลือกบ้านแล้วรีบไปถามเลขมิเตอร์ครั้งก่อน เอาไว้คำนวณและเตือนก่อนบันทึก
  onMemberChange(): void {
    this.previousReading = null;
    this.previousUsage = null;
    if (!this.selectedMemberId) return;

    this.isLoadingPrevious = true;
    this.meterReadingService.getReadingsByMember(Number(this.selectedMemberId)).subscribe({
      next: (readings) => {
        this.isLoadingPrevious = false;
        // หลังบ้านเรียงครั้งล่าสุดมาก่อน — ตัวแรกคือเลขเดือนที่แล้ว
        this.previousReading = readings?.length ? Number(readings[0].meter_unit) : 0;
        // ถ้ามีอย่างน้อย 2 ครั้ง คำนวณว่าเดือนก่อนใช้ไปเท่าไร ไว้เทียบความผิดปกติ
        this.previousUsage =
          readings && readings.length >= 2
            ? Number(readings[0].meter_unit) - Number(readings[1].meter_unit)
            : null;
        this.cdr?.detectChanges();
      },
      error: (err) => {
        this.isLoadingPrevious = false;
        console.error('ดึงเลขมิเตอร์ครั้งก่อนไม่สำเร็จ:', err);
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

  /**
   * ผ่านเกณฑ์บันทึกอัตโนมัติไหม — หลังบ้านตัดสินมาให้แล้วใน auto_savable
   * (ถ้า API เวอร์ชันเก่ายังไม่ส่งฟิลด์นี้ ค่อยเทียบกับเกณฑ์เองเป็นตัวสำรอง)
   */
  get autoSavable(): boolean {
    if (typeof this.aiResult?.auto_savable === 'boolean') {
      return this.aiResult.auto_savable;
    }
    const percent = this.confidencePercent;
    return percent !== null && percent >= OCR_CONFIDENCE_THRESHOLD * 100;
  }

  // ชัดเจน = เขียว, ที่เหลือ (รวมถึงกรณีไม่รู้ค่า) = เหลือง ให้เจ้าหน้าที่ตรวจซ้ำ
  get isConfident(): boolean {
    return this.autoSavable;
  }

  get confidenceLabel(): string {
    const percent = this.confidencePercent;
    if (percent === null) return 'ระบบไม่ได้ให้ค่าความเชื่อมั่น โปรดตรวจสอบตัวเลขกับหน้าปัด';
    if (this.autoSavable) return `อ่านได้ชัดเจน (${percent}%)`;
    return `อ่านได้ไม่ค่อยชัด (${percent}%) โปรดตรวจสอบ`;
  }

  /** ความแม่นยำที่วัดได้จริงของกลุ่มนี้ ใช้บอกเจ้าหน้าที่ว่าควรเชื่อผลแค่ไหน */
  get expectedAccuracyPercent(): number {
    const fromApi = this.aiResult?.expected_accuracy;
    if (typeof fromApi === 'number' && !isNaN(fromApi)) return Math.round(fromApi * 100);
    if (this.autoSavable) return Math.round(OCR_ACCURACY_BY_CONFIDENCE.atOrAboveThreshold * 100);
    if (this.confidencePercent === null) {
      return Math.round(OCR_ACCURACY_BY_CONFIDENCE.withoutConfidence * 100);
    }
    return Math.round(OCR_ACCURACY_BY_CONFIDENCE.belowThreshold * 100);
  }

  /** ต้องให้เจ้าหน้าที่ติ๊กยืนยันก่อนบันทึกไหม */
  get needsManualVerify(): boolean {
    return !this.autoSavable;
  }

  /** เงื่อนไขครบพร้อมบันทึกหรือยัง (ใช้ทั้งปุ่มและตอนกดจริง ให้ตรงกันเสมอ) */
  get canSave(): boolean {
    if (this.isSaving) return false;
    if (!this.aiResult?.read_unit || !this.selectedMemberId) return false;
    if (this.isBelowPrevious) return false;
    if (this.needsManualVerify && !this.verifiedByStaff) return false;
    return true;
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
    // สแกนรูปใหม่ = ต้องยืนยันใหม่ ห้ามให้การติ๊กครั้งก่อนค้างมาใช้กับเลขชุดใหม่
    this.verifiedByStaff = false;

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
  confirmAndSave() {
    const currentUnit = Math.round(Number(this.aiResult?.read_unit));
    if (!this.aiResult || !currentUnit || isNaN(currentUnit)) return;

    if (!this.selectedMemberId) {
      toast.error('กรุณาเลือกบ้านเลขที่ก่อนบันทึกนะครับ', { id: 'need-member' });
      return;
    }

    if (this.needsManualVerify && !this.verifiedByStaff) {
      toast.error('ค่าความเชื่อมั่นต่ำกว่าเกณฑ์ กรุณาเทียบเลขกับหน้าปัดแล้วติ๊กยืนยันก่อนบันทึก', {
        id: 'need-verify'
      });
      return;
    }

    const memberId = Number(this.selectedMemberId);
    const adminId = this.auth.admin()?.id;

    this.isSaving = true;
    this.saveSuccess = false;

    forkJoin({
      rate: this.meterReadingService.getActiveWaterRate(),
      readings: this.meterReadingService.getReadingsByMember(memberId)
    })
      .pipe(
        switchMap(({ rate, readings }) => {
          if (!rate?.id) {
            return throwError(() => new Error('ยังไม่มีเรทค่าน้ำที่เปิดใช้งานในระบบ กรุณาตั้งเรทค่าน้ำก่อน'));
          }

          // หลังบ้านเรียงครั้งล่าสุดมาก่อน เลยหยิบตัวแรกเป็นเลขมิเตอร์เดือนที่แล้ว
          const previousUnit = readings?.length ? Number(readings[0].meter_unit) : 0;
          if (currentUnit < previousUnit) {
            return throwError(
              () => new Error(`เลขมิเตอร์ (${currentUnit}) น้อยกว่าครั้งก่อน (${previousUnit}) กรุณาตรวจสอบตัวเลขอีกครั้ง`)
            );
          }

          return this.meterReadingService
            .createMeterReading({
              reading_date: new Date().toISOString().slice(0, 10),
              meter_unit: currentUnit,
              members_id: memberId,
              create_by: adminId
            })
            .pipe(
              switchMap((reading) =>
                this.meterReadingService.saveBill({
                  meter_readings_id: reading.id,
                  water_rates_id: rate.id,
                  previous_unit: previousUnit,
                  current_unit: currentUnit,
                  create_by: adminId
                })
              )
            );
        })
      )
      .subscribe({
        next: (bill) => {
          this.isSaving = false;
          this.saveSuccess = true;
          this.savedBill = bill; // เก็บไว้ให้กดยกเลิกย้อนได้
          this.cdr?.detectChanges();
          toast.success('บันทึกเลขมิเตอร์และสร้างบิลเรียบร้อยแล้ว', { id: 'save-success' });
        },
        error: (err) => {
          this.isSaving = false;
          console.error('Save error:', err);
          this.cdr?.detectChanges();
          toast.error(extractErrorMessage(err, 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), { id: 'save-error' });
        }
      });
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
        // โหลดเลขเดือนก่อนใหม่ เพราะการจดครั้งนี้ถูกลบไปแล้ว
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
