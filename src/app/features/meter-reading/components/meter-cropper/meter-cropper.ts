import { ChangeDetectorRef, Component, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ImageCropperComponent, ImageTransform, OutputFormat } from 'ngx-image-cropper';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { switchMap, throwError } from 'rxjs';
import { toast } from 'ngx-sonner';
import { MeterReadingService } from '../../services/meter-reading.service';
import { MemberService } from '../../../member/services/member.service';
import { AuthService } from '../../../auth/services/auth.service';
import { extractErrorMessage } from '../../../auth/services/auth-error';
import { BillPrintService } from '../../services/bill-print.service';
import { PhotoMetadata, parseCaptureDate, readPhotoMetadata } from '../../services/exif';
import { LatLng, distanceMeters, pickNearest, toCoords } from '../../services/geo';

@Component({
  selector: 'app-meter-cropper',
  standalone: true,
  // eslint-disable-next-line @angular-eslint/no-unused-standalone-imports
  imports: [CommonModule, FormsModule, ImageCropperComponent, RouterLink],
  templateUrl: './meter-cropper.html',
  styleUrls: ['./meter-cropper.css']
})
export class MeterCropperComponent implements OnInit {
  // ==========================================
  // โซนประกาศตัวแปร
  // ==========================================
  imageChangedEvent: Event | null = null;
  /** วันถ่าย/พิกัดที่อ่านจากไฟล์ต้นฉบับตอนเลือกรูป — ครอปแล้วข้อมูลนี้หายไปจากภาพ */
  private photoMeta: PhotoMetadata = {};
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
    return this.print
      .monthOptions(6)
      .map((m, i) => ({ ...m, label: m.label + (i === 0 ? ' (เดือนนี้)' : '') }));
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
  /** ข้อความเตือนจำนวนหลักบนหน้าปัดไม่ตรงกับที่บ้านนี้เคยอ่านได้ */
  digitChangeWarning: string | null = null;

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
    this.digitChangeWarning = null;
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
    this.photoMeta = {};
    this.resetImage();

    // ต้องอ่าน EXIF จากไฟล์ต้นฉบับตอนนี้ ก่อนครอป — ภาพที่ครอปแล้วออกมาจาก canvas
    // ซึ่งเก็บแต่พิกเซล วันถ่ายกับพิกัดหายไปหมด ถ้ารอไปอ่านทีหลังจะไม่เหลืออะไรแล้ว
    const file = (event.target as HTMLInputElement | null)?.files?.[0];
    if (!file) return;

    readPhotoMetadata(file).then((meta) => {
      this.photoMeta = meta;
      this.cdr?.detectChanges();
    });
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
  // โซนข้อมูลที่ติดมากับรูป (EXIF) — วันถ่าย + พิกัด
  // ==========================================

  /**
   * วันที่ถ่ายรูปจริง — ใช้เป็นวันจดมิเตอร์แทนวันที่กดบันทึก เพราะเจ้าหน้าที่
   * มักเดินจดทั้งหมู่บ้านก่อนแล้วค่อยมานั่งบันทึกทีหลัง
   *
   * ค่าที่ได้มาเชื่อไม่ได้ ต้องกรองก่อนเสมอ:
   *   - EXIF มาตรฐานเป็น 'YYYY:MM:DD HH:mm:ss' แต่ถ้าวันหลังหลังบ้านส่ง ISO
   *     ('2026-08-14T22:08:11Z') มาแทน การตัดด้วยช่องว่างแล้วแทน ':' เป็น '-'
   *     จะได้สตริงเพี้ยนส่งขึ้นไปเป็น reading_date โดยไม่มี error ให้เห็น
   *   - ถ้าไม่ใช่สตริง (timestamp ตัวเลข) การเรียก .split() จะโยน error
   *     กลางฟังก์ชันบันทึก ปุ่มจะกดแล้วเงียบไปเฉย ๆ
   *   - รูปจากแกลเลอรีอาจเก่าข้ามปี หรือนาฬิกาเครื่องเพี้ยนจนได้วันในอนาคต
   *
   * อ่านไม่ออกหรือดูไม่สมเหตุสมผล → คืน null แล้วถอยไปใช้วันที่วันนี้
   */
  get capturedAt(): Date | null {
    return parseCaptureDate(this.metadata?.captureDate);
  }

  /**
   * ข้อมูลติดรูปที่ใช้อยู่ตอนนี้ — หลังอ่านเลขเสร็จใช้ก้อนที่ผสมกับของหลังบ้านแล้ว
   * ก่อนหน้านั้นใช้ที่อ่านเองตอนเลือกรูป จะได้ช่วยเลือกบ้านได้ตั้งแต่ยังไม่ทันกดอ่านเลข
   */
  private get metadata(): PhotoMetadata {
    return this.aiResult?.metadata ?? this.photoMeta;
  }

  /** มีวันถ่ายติดมาแต่แปลงไม่ได้ — ต้องบอกว่าระบบจะใช้วันนี้แทน ไม่ใช่เงียบ */
  get hasUnreadableCaptureDate(): boolean {
    const raw = this.metadata?.captureDate;
    return raw !== null && raw !== undefined && raw !== '' && this.capturedAt === null;
  }

  get captureDateLabel(): string {
    return this.print.dateLabel(this.capturedAt);
  }

  /**
   * รูปถ่ายคนละเดือนกับบิลที่กำลังจะออก — เตือนอย่างเดียวไม่บล็อก เพราะจดปลายเดือน
   * แล้วมาบันทึกต้นเดือนถัดไปเป็นเรื่องปกติ แต่อีกความเป็นไปได้คือหยิบรูปเก่า
   * จากแกลเลอรีมาผิดใบ ซึ่งจะกลายเป็นบิลผิดบ้านผิดเดือนโดยไม่มีใครทันสังเกต
   */
  get isCaptureOutsideBillingMonth(): boolean {
    const captured = this.capturedAt;
    if (!captured) return false;

    const billing = this.selectedBilling;
    return (
      captured.getFullYear() !== Number(billing.year) ||
      captured.getMonth() + 1 !== Number(billing.month)
    );
  }

  /**
   * พิกัดจาก EXIF — ต้องแปลงเป็นตัวเลขเองก่อนส่งเข้า template
   * ถ้าโยนสตริงที่ไม่ใช่ตัวเลขเข้า pipe `number` ตรง ๆ DecimalPipe จะโยน error
   * แล้วทั้งหน้าจอดับ ทั้งที่พิกัดเป็นแค่ข้อมูลประกอบ
   */
  get captureCoords(): LatLng | null {
    return toCoords(this.metadata?.latitude, this.metadata?.longitude);
  }

  // ==========================================
  // โซนจับคู่รูปกับบ้าน — เรียงบ้านตามระยะห่างและเตือนเวลาเลือกไม่ตรง
  // ==========================================

  /**
   * ระยะที่ถือว่า "น่าจะคนละบ้าน" — GPS มือถือคลาดเคลื่อน 5–20 ม. อยู่แล้ว
   * ตั้งต่ำกว่านี้จะเตือนพร่ำเพรื่อจนเจ้าหน้าที่เลิกอ่าน
   */
  private readonly farMeters = 50;

  /** พิกัดที่บ้านหลังนี้เคยเก็บไว้ — ยังไม่เคยจด (หรือหลังบ้านยังไม่มีคอลัมน์นี้) = null */
  private memberCoords(member: any): LatLng | null {
    return toCoords(member?.latitude, member?.longitude);
  }

  /**
   * รายชื่อบ้านสำหรับ dropdown พร้อมระยะห่างจากจุดที่ถ่ายรูป
   * มีพิกัดครบเมื่อไหร่จะเรียงบ้านที่ใกล้ที่สุดขึ้นก่อน — บ้านที่ถูกจะลอยมาอันดับแรก
   * ลดทั้งโอกาสเลือกผิดและเวลาที่ต้องเลื่อนหาในลิสต์ยาว ๆ
   * ถ้ารูปไม่มีพิกัดหรือยังไม่มีบ้านไหนเก็บไว้ ก็เรียงตามเดิมเหมือนไม่มีอะไรเกิดขึ้น
   */
  get memberOptions(): { member: any; meters: number | null }[] {
    const photo = this.captureCoords;
    const rows = this.members.map((member) => {
      const coords = photo ? this.memberCoords(member) : null;
      return { member, meters: coords ? distanceMeters(photo!, coords) : null };
    });

    // บ้านที่ยังไม่มีพิกัดต้องไปต่อท้าย ไม่ใช่ถูกมองว่าอยู่ไกลสุดหรือใกล้สุด
    return rows.sort((a, b) => {
      if (a.meters === null && b.meters === null) return 0;
      if (a.meters === null) return 1;
      if (b.meters === null) return -1;
      return a.meters - b.meters;
    });
  }

  /**
   * ระยะที่บ้านอันดับ 1 ต้องทิ้งห่างอันดับ 2 ถึงจะกล้าเสนอ
   * ใกล้พอ ๆ กันสองหลัง = GPS แยกไม่ออก ต้องให้คนเลือกเอง
   */
  private readonly minMarginMeters = 15;

  /** บ้านที่ใกล้จุดถ่ายรูปที่สุดแบบมั่นใจพอ — เดาไม่ได้คืน null ดีกว่าเสนอผิด */
  get nearestMember(): { member: any; meters: number } | null {
    const photo = this.captureCoords;
    if (!photo) return null;

    const match = pickNearest(photo, this.members, (m) => this.memberCoords(m), {
      maxMeters: this.farMeters,
      minMargin: this.minMarginMeters
    });
    return match ? { member: match.item, meters: match.meters } : null;
  }

  /** ระยะจากจุดถ่ายรูปถึงบ้านที่เลือกไว้ — null ถ้าฝั่งใดฝั่งหนึ่งไม่มีพิกัด */
  get selectedMemberDistance(): number | null {
    const photo = this.captureCoords;
    if (!photo || !this.selectedMemberId) return null;

    const member = this.members.find((m) => m.id === Number(this.selectedMemberId));
    const coords = member ? this.memberCoords(member) : null;
    return coords ? distanceMeters(photo, coords) : null;
  }

  /** เลือกบ้านที่อยู่ไกลจากจุดถ่ายรูป — เตือนอย่างเดียว เพราะพิกัดที่เก็บไว้อาจเพี้ยนเองก็ได้ */
  get isSelectedFarFromPhoto(): boolean {
    const meters = this.selectedMemberDistance;
    return meters !== null && meters > this.farMeters;
  }

  /** เลือกบ้านที่ระบบเดาให้จากพิกัด */
  useNearestMember(): void {
    const nearest = this.nearestMember;
    if (!nearest) return;

    this.selectedMemberId = nearest.member.id;
    this.onMemberChange();
  }

  /**
   * บ้านหลังนี้ยังไม่มีพิกัด แต่รูปที่เพิ่งจดมี — เก็บไว้เลย ครั้งหน้าจะช่วยเรียงบ้านให้
   *
   * ยิงแยกและกลืน error ทุกกรณี เพราะเป็นของแถม บิลออกสำเร็จไปแล้ว
   * ห้ามให้ความล้มเหลวของเรื่องนี้ไปทำให้เจ้าหน้าที่คิดว่าออกบิลไม่สำเร็จ
   */
  private rememberMemberLocation(memberId: number): void {
    const coords = this.captureCoords;
    if (!coords) return;

    const member = this.members.find((m) => m.id === memberId);
    // มีพิกัดอยู่แล้วไม่ทับ — ของเดิมผ่านตาคนมาแล้ว เชื่อถือได้กว่ารูปใบล่าสุด
    if (!member || this.memberCoords(member)) return;

    // ส่งข้อมูลเดิมไปครบทุกช่อง เผื่อหลังบ้านเขียนทับทั้งแถว ไม่งั้นชื่อ/เบอร์จะหายไป
    this.memberService
      .updateMember({ ...member, latitude: coords.lat, longitude: coords.lng })
      .subscribe({
        next: () => {
          member.latitude = coords.lat;
          member.longitude = coords.lng;
        },
        error: (err) => console.warn('เก็บพิกัดบ้านไม่สำเร็จ ข้ามไปก่อน:', err)
      });
  }

  // ==========================================
  // โซนคำนวณสด + เตือนก่อนบันทึก (เทียบกับเลขเดือนก่อน)
  // ==========================================

  /**
   * เลขที่ AI อ่านมาตอนแรก + จำนวนหลักที่นับได้ — เก็บแยกจากช่องที่คนแก้ได้
   *
   * ด่านจำนวนหลักของหลังบ้านเทียบกับ "จำนวนหลักที่ AI เห็น" ถ้าคนแก้เลขเองแล้วยังส่ง
   * ค่าเดิมไป ด่านจะตรวจกับเลขที่ไม่ได้บันทึกจริง กลายเป็นบล็อกมั่วหรือปล่อยผ่านมั่ว
   */
  private ocrUnit: number | null = null;
  private ocrDigits: number | null = null;

  /** จำนวนหลักที่ควรส่งไปให้ด่านตรวจ — null เมื่อคนแก้เลขเอง (ตาคนเชื่อถือได้กว่า) */
  private get digitsToSend(): number | undefined {
    if (this.ocrDigits === null || this.ocrUnit === null) return undefined;
    const current = this.currentUnitValue;
    return current !== null && Math.round(current) === this.ocrUnit ? this.ocrDigits : undefined;
  }

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
        // ผสมข้อมูลจากไฟล์ต้นฉบับเข้าไปด้วย เพราะรูปที่ส่งไปเป็นรูปครอปที่ไม่มี EXIF แล้ว
        // ถ้าวันหลังหลังบ้านอ่านเองได้ ให้ค่าจากหลังบ้านชนะ (ทับทีหลัง)
        this.aiResult = { ...(res ?? {}), metadata: { ...this.photoMeta, ...(res?.metadata ?? {}) } };

        // จำเลขกับจำนวนหลักที่ AI อ่านมาไว้ ก่อนที่ช่องกรอกจะถูกคนแก้
        const digits = Number(res?.meter_digits);
        this.ocrUnit = this.currentUnitValue === null ? null : Math.round(this.currentUnitValue);
        this.ocrDigits = Number.isInteger(digits) && digits > 0 ? digits : null;

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
  confirmAndSave(confirmHighUsage = false, confirmDigitChange = false) {
    // เช็ค null อย่างเดียว ห้ามใช้ !unit — มิเตอร์ที่เพิ่งติดใหม่อ่านได้ 0 ซึ่งต้องออกบิลได้
    // และห้าม return เงียบ ๆ เพราะเจ้าหน้าที่จะเห็นแค่ปุ่มกดแล้วไม่มีอะไรเกิดขึ้น
    const rawUnit = this.currentUnitValue;
    if (rawUnit === null) {
      toast.error('ยังไม่ได้กรอกเลขมิเตอร์ กรุณาใส่เลขที่อ่านได้ก่อนนะครับ', { id: 'need-unit' });
      return;
    }
    if (rawUnit < 0) {
      toast.error('เลขมิเตอร์ติดลบไม่ได้ กรุณาตรวจสอบตัวเลขอีกครั้งนะครับ', { id: 'need-unit' });
      return;
    }

    if (!this.selectedMemberId) {
      toast.error('กรุณาเลือกบ้านเลขที่ก่อนบันทึกนะครับ', { id: 'need-member' });
      return;
    }

    const currentUnit = Math.round(rawUnit);
    const memberId = Number(this.selectedMemberId);
    const adminId = this.auth.admin()?.id;
    const billing = this.selectedBilling;

    // วันถ่ายรูปคือวันที่จดมิเตอร์จริง อ่านจากรูปไม่ได้ค่อยถอยมาใช้วันนี้
    const readingDate = this.print.isoDate(this.capturedAt ?? new Date());

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
            billing_year: billing.year,
            // ด่านกันอ่านหลักหาย/หลักเกิน — ส่งเฉพาะตอนเลขยังเป็นค่าที่ AI อ่านมา
            meter_digits: this.digitsToSend,
            confirm_digit_change: confirmDigitChange
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
          this.digitChangeWarning = null;
          this.cdr?.detectChanges();
          toast.success('บันทึกเลขมิเตอร์และสร้างบิลเรียบร้อยแล้ว', { id: 'save-success' });

          // จำไว้ว่าบ้านหลังนี้อยู่ตรงไหน เพื่อช่วยเรียงบ้านให้ในการจดครั้งถัดไป
          this.rememberMemberLocation(memberId);
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

          // จำนวนหลักบนหน้าปัดไม่ตรงกับที่บ้านนี้เคยอ่านได้ — ส่วนใหญ่คือ AI อ่านหลักหาย
          // ซึ่งทำให้ยอดคลาดสิบเท่า ต้องให้คนเทียบกับรูปก่อน ไม่ใช่ให้กดผ่านไปเฉย ๆ
          if (err?.status === 409 && !confirmDigitChange && this.isDigitChangeBlock(err)) {
            this.digitChangeWarning = extractErrorMessage(err, '');
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

  /** เคสจำนวนหลักไม่ตรง — ข้อความของหลังบ้านพูดถึง "หลัก" ส่วนด่านหน่วยน้ำไม่มีคำนี้ */
  private isDigitChangeBlock(err: any): boolean {
    return typeof err?.error?.message === 'string' && err.error.message.includes('หลัก');
  }

  /** ตรวจแล้วว่าเลขถูก — ส่งใหม่พร้อมธงยืนยัน */
  confirmHighUsageAndSave(): void {
    this.highUsageWarning = null;
    this.confirmAndSave(true);
  }

  /** เทียบกับรูปหน้าปัดแล้วว่าจำนวนหลักถูกต้องจริง (เช่นเพิ่งเปลี่ยนมิเตอร์) */
  confirmDigitChangeAndSave(): void {
    this.digitChangeWarning = null;
    this.confirmAndSave(false, true);
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
