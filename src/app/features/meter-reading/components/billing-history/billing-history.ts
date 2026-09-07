import { Component, OnInit, ChangeDetectorRef, inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { toast } from 'ngx-sonner';
import { ImageCropperComponent, ImageTransform } from 'ngx-image-cropper';
import { MeterReadingService } from '../../services/meter-reading.service';
import { extractErrorMessage } from '../../../auth/services/auth-error';
import { BillPrintService } from '../../services/bill-print.service';
import { photoBlob } from '../../services/photo-file';
import { AuthService } from '../../../auth/services/auth.service';
import { AuditService, ReadingLog } from '../../../audit/services/audit.service';
import { API_BASE_URL } from '../../../../core/api.config';

@Component({
  selector: 'app-billing-history',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, ImageCropperComponent],
  templateUrl: './billing-history.html',
  styleUrls: ['./billing-history.css']
})
export class BillingHistoryComponent implements OnInit {
  private print = inject(BillPrintService);
  private auth = inject(AuthService);
  private audit = inject(AuditService);

  bills: any[] = [];
  isLoading = true;
  isFetching = false;

  // 🌟 บิลที่กำลังจะลบ — ใช้เปิดหน้าต่างยืนยันก่อนลบจริง
  billToDelete: any = null;

  // 🌟 บิลที่กำลังเปิดดูรายละเอียดเต็ม (ข้อมูลลูกบ้าน + การจดมิเตอร์ + การคิดเงิน)
  selectedBill: any = null;

  openDetail(bill: any) {
    this.selectedBill = bill;
    this.photoBroken = false;
    this.photoZoomed = false;
    this.detail = this.buildDetail(bill);
    this.loadEditLogs(bill.id);
  }

  closeDetail() {
    this.selectedBill = null;
    this.photoZoomed = false;
    this.detail = null;
    this.editLogs = [];
  }

  // ==========================================
  // แก้ไขเลขมิเตอร์ของบิลที่ออกไปแล้ว
  // ==========================================

  /**
   * บิลที่กำลังแก้อยู่ (null = ยังไม่ได้กด)
   *
   * แยกจาก selectedBill เพราะหน้าต่างแก้ไขซ้อนอยู่บนหน้ารายละเอียด ปิดแล้วต้องกลับมา
   * ที่ใบเดิมโดยไม่เสียตำแหน่ง เหมือนที่รูปเต็มจอทำอยู่
   */
  editBill: any = null;
  editUnit: number | null = null;
  editReason = '';
  isSavingEdit = false;

  /** รูปใหม่ที่ครอปแล้ว — null = ไม่ได้เปลี่ยนรูป หลังบ้านจะเก็บรูปเดิมไว้ */
  editPhoto: Blob | null = null;
  /** ไฟล์ที่เพิ่งเลือกและกำลังครอปอยู่ (ยังไม่ยืนยัน) */
  editPhotoFile: File | null = null;
  editCropTransform: ImageTransform = {};
  private editCropRotation = 0;
  private editCropBlob: Blob | null = null;

  /**
   * ด่านของหลังบ้านที่ตีกลับมา ('high_usage' | 'meter_reset')
   *
   * ธง confirm_* ไม่เคยถูกส่งเป็น true เอง — ต้องให้คนอ่านคำเตือนแล้วกดยืนยันก่อนเสมอ
   * เหมือนหน้าจดมิเตอร์ ปุ่มยืนยันจึงโผล่หลังโดนตีกลับเท่านั้น ไม่ใช่ติ๊กค้างไว้ล่วงหน้า
   */
  editBlocker: 'high_usage' | 'meter_reset' | null = null;
  editBlockerMessage = '';

  /** ประวัติการแก้ของบิลใบที่เปิดดูอยู่ — โชว์ในหน้ารายละเอียดเพื่อให้ยอดที่เปลี่ยนมีที่มา */
  editLogs: ReadingLog[] = [];

  /**
   * ปุ่มแก้ไขควรขึ้นไหม
   *
   * ⚠️ เป็นแค่การซ่อนปุ่ม ไม่ใช่ด่าน — หลังบ้านต้องตรวจสิทธิ์กับเวลาเองซ้ำทุกครั้ง
   *    เงื่อนไขตรงนี้เขียนให้ตรงกับของหลังบ้านเพื่อไม่ให้คนกดแล้วเจอ error เปล่า ๆ
   */
  canEdit(bill: any): boolean {
    if (!bill) return false;
    // จ่ายเงินแล้วห้ามแก้ทุกกรณี — ยอดที่ลูกบ้านจ่ายไปรวมบิลค้างเก่าที่ถูกปิดไปพร้อมกัน
    // แก้ยอดทีหลังจะได้บัญชีที่ไม่ตรงกับเงินสดในมือ ต้องกดกลับเป็นรอชำระเงินก่อน
    if (bill.payment_status === 'Paid') return false;
    if (this.auth.isOwner()) return true;

    // เจ้าหน้าที่จดมิเตอร์: เฉพาะที่จดวันนี้ หรือบิลที่ยังไม่ชำระ
    const raw = bill.meter_reading?.reading_date ?? bill.create_date;
    const readAt = raw ? new Date(raw) : null;
    const isToday = readAt !== null && !isNaN(readAt.getTime())
      && readAt.toDateString() === new Date().toDateString();

    return isToday || bill.payment_status === 'Pending';
  }

  openEdit(bill: any): void {
    if (!this.canEdit(bill)) return;

    this.editBill = bill;
    this.editUnit = this.toNumber(bill.meter_reading?.meter_unit);
    this.editReason = '';
    this.editPhoto = null;
    this.editPhotoFile = null;
    this.editCropBlob = null;
    this.editCropRotation = 0;
    this.editCropTransform = {};
    this.editBlocker = null;
    this.editBlockerMessage = '';
  }

  closeEdit(): void {
    // กำลังยิงอยู่ห้ามปิด ไม่งั้นจะไม่รู้ว่าตกลงยอดเปลี่ยนไปแล้วหรือยัง
    if (this.isSavingEdit) return;
    this.editBill = null;
    this.editPhotoFile = null;
    this.editPhoto = null;
    this.editCropBlob = null;
  }

  /** เลือกรูปใหม่ → เข้ากล่องครอปทันที รูปเต็มใบยังไม่ถูกใช้จนกว่าจะกดยืนยันกรอบ */
  onEditPhotoPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = ''; // เลือกไฟล์เดิมซ้ำต้องให้ event ยิงอีกรอบ

    if (!file) return;
    this.editPhotoFile = file;
    this.editPhoto = null;
    this.editCropBlob = null;
    this.editCropRotation = 0;
    this.editCropTransform = {};
  }

  onEditCropped(event: any): void {
    this.editCropBlob = event?.blob ?? null;
  }

  rotateEditCrop(direction: -1 | 1): void {
    this.editCropRotation += direction * 90;
    this.editCropTransform = { ...this.editCropTransform, rotate: this.editCropRotation };
  }

  /** ยืนยันกรอบที่ครอป แล้วย่อ/บีบอัดให้พร้อมส่ง (คนละบันไดกับทาง JSON — ดู photoBlob) */
  async useEditCrop(): Promise<void> {
    if (!this.editCropBlob) return;

    this.editPhoto = (await photoBlob(this.editCropBlob)) ?? this.editCropBlob;
    this.editPhotoFile = null;
    this.editCropBlob = null;
    this.cdr.detectChanges();
  }

  cancelEditCrop(): void {
    this.editPhotoFile = null;
    this.editCropBlob = null;
  }

  clearEditPhoto(): void {
    this.editPhoto = null;
  }

  saveEdit(): void {
    const bill = this.editBill;
    if (!bill || this.isSavingEdit) return;

    const unit = this.toNumber(this.editUnit);
    if (unit === null) {
      toast.error('กรุณากรอกเลขมิเตอร์ใหม่ครับ', { id: 'edit-reading' });
      return;
    }

    // เหตุผลบังคับกรอก — log ที่ไม่มีเหตุผลตอบไม่ได้ว่าทำไมยอดถึงเปลี่ยน
    // ซึ่งเป็นคำถามเดียวที่ตารางประวัติมีไว้ตอบ
    const reason = this.editReason.trim();
    if (reason.length < 3) {
      toast.error('กรุณาระบุเหตุผลที่แก้ไขครับ', { id: 'edit-reading' });
      return;
    }

    this.isSavingEdit = true;
    this.cdr.detectChanges();

    this.meterReadingService.editReading(bill.id, {
      current_unit: unit,
      reason,
      photo: this.editPhoto,
      confirm_high_usage: this.editBlocker === 'high_usage',
      confirm_meter_reset: this.editBlocker === 'meter_reset'
    }).subscribe({
      next: (res: any) => {
        this.isSavingEdit = false;
        this.editBill = null;
        this.editPhoto = null;

        // โหลดใหม่ทั้งกอง ไม่แก้ค่าในก้อนเดิมบนจอ — หลังบ้านคิดหน่วยน้ำ ยอดรวม และยอดค้าง
        // ที่ทบไว้ใหม่หมด การเดาว่าอะไรเปลี่ยนบ้างแล้วแก้เองคือทางที่ตัวเลขบนจอเพี้ยนจากของจริง
        this.loadBillingHistory();
        this.loadEditLogs(bill.id);
        this.cdr.detectChanges();

        const total = this.toNumber(res?.total_amount);
        toast.success(
          total === null
            ? 'แก้ไขเรียบร้อยครับ'
            : `แก้เป็น ${unit} แล้ว ยอดใหม่ ${total.toFixed(2)} บาทครับ`,
          { id: 'edit-reading' }
        );
      },
      error: (err) => {
        this.isSavingEdit = false;
        console.error('Edit reading error:', err);

        // หลังบ้านตีกลับเพราะติดด่าน → เปิดปุ่มยืนยันให้คนอ่านแล้วตัดสินใจ ไม่ใช่ยิงซ้ำให้เอง
        const code = err?.error?.code;
        this.editBlocker = code === 'high_usage' || code === 'meter_reset' ? code : null;
        this.editBlockerMessage = this.editBlocker
          ? extractErrorMessage(err, 'ข้อมูลนี้ต้องยืนยันก่อนบันทึก')
          : '';

        this.cdr.detectChanges();
        if (!this.editBlocker) {
          toast.error(extractErrorMessage(err, 'แก้ไขไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), { id: 'edit-reading' });
        }
      }
    });
  }

  private loadEditLogs(billId: number): void {
    if (!this.isBrowser) return;

    this.audit.readingLogs({ bills_id: billId, limit: 20 }).subscribe({
      next: (logs) => {
        this.editLogs = Array.isArray(logs) ? logs : [];
        this.cdr.detectChanges();
      },
      // ประวัติการแก้เปิดไม่ขึ้นไม่ควรบังหน้ารายละเอียดที่เหลือ ปล่อยว่างไว้เงียบ ๆ
      error: () => {
        this.editLogs = [];
        this.cdr.detectChanges();
      }
    });
  }

  editorName(log: ReadingLog): string {
    const name = `${log.editor?.fname ?? ''} ${log.editor?.lname ?? ''}`.trim();
    return name || `ผู้ใช้ #${log.edited_by}`;
  }

  logUnit(value: string | number | null): string {
    const num = this.toNumber(value);
    return num === null ? '—' : String(num);
  }

  // ==========================================
  // รูปหน้าปัดที่จดไว้ + ข้อมูลตอนถ่าย
  // ==========================================

  /** รูปเปิดไม่ขึ้น (ไฟล์หาย/หลังบ้านย้ายที่เก็บ) — บอกให้เห็นดีกว่าปล่อยกรอบว่าง */
  photoBroken = false;

  /** กดรูปแล้วขยายเต็มจอ — บนมือถือรูปในการ์ดเล็กเกินกว่าจะอ่านเลขบนหน้าปัดซ้ำได้ */
  photoZoomed = false;

  /**
   * ข้อมูลการจดของใบที่เปิดดูอยู่ คิดครั้งเดียวตอนกดเปิด
   *
   * ไม่คิดสดใน template เพราะ confidence เป็น 0 ได้ (AI อ่านไม่ออกเลย) ซึ่งเป็นเคส
   * ที่ต้องเห็นที่สุด แต่ `@if (...; as x)` มองว่า falsy แล้วซ่อนทิ้ง
   */
  detail: {
    photo: string | null;
    captured: string;
    confidence: number | null;
    coords: string;
    mapsUrl: string;
    /** รูปถูกลบตามอายุแล้ว (ไม่ใช่ไม่เคยถ่าย) — ต้องแยกให้ออกตอนย้อนไปตรวจ */
    photoPurged: boolean;
  } | null = null;

  private buildDetail(bill: any) {
    const reading = bill?.meter_reading;
    const coords = this.photoCoords(reading);

    return {
      photo: this.photoUrl(reading),
      captured: this.capturedLabel(reading),
      confidence: this.confidencePercent(reading),
      coords: coords ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` : '',
      mapsUrl: coords ? `https://www.google.com/maps?q=${coords.lat},${coords.lng}` : '',
      // หลังบ้านลบไฟล์รูปของบิลที่จ่ายแล้วและเก่าเกิน 1 ปีทิ้งตามนโยบาย แต่ไม่ล้าง
      // path ออกจากฐานข้อมูล เพราะ path ที่ยังอยู่คือหลักฐานว่า "เคยมีรูป"
      // ถ้าไม่เช็คตรงนี้ หน้าเว็บจะพยายามโหลดไฟล์ที่ถูกลบแล้วได้กรอบรูปแตกแทน
      photoPurged: Boolean(reading?.photo_purged_at)
    };
  }

  /**
   * ที่อยู่รูปหน้าปัดของบิลใบนี้
   *
   * หลังบ้านเก็บรูปเป็นไฟล์แล้วคืน path มา (เช่น 'uploads/xxx.jpg') จึงต้องต่อกับ
   * API_BASE_URL เอง — ต่อจาก hostname ปัจจุบันเหมือน request อื่น ไม่งั้นเปิดจากมือถือ
   * ในวงแลนแล้วรูปจะวิ่งไป localhost ของเครื่องตัวเอง
   * (เผื่อบิลเก่าที่เก็บเป็น data URL หรือ URL เต็มไว้ ให้ใช้ค่านั้นตรง ๆ)
   */
  private photoUrl(reading: any): string | null {
    const raw = String(reading?.meter_photo ?? '').trim();
    if (!raw) return null;
    if (/^(data:|https?:\/\/)/i.test(raw)) return raw;
    return `${API_BASE_URL}/${raw.replace(/^\/+/, '')}`;
  }

  /**
   * วันเวลาที่กดชัตเตอร์ (จาก EXIF ของรูป) — ต้องมีเวลาด้วย ไม่ใช่แค่วันที่
   * เพราะใช้ยันกับลูกบ้านว่าไปจดตอนไหน ส่วน dateLabel() ให้มาแค่วันที่
   */
  private capturedLabel(reading: any): string {
    const raw = reading?.captured_at;
    if (!raw) return '';

    const d = new Date(raw);
    if (isNaN(d.getTime())) return '';

    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `${this.dateLabel(d)} เวลา ${time} น.`;
  }

  /** ความมั่นใจตอน AI อ่านเลข — หลังบ้านเก็บเป็น 0–1 และเป็น NULL เมื่อคนพิมพ์เลขเอง */
  private confidencePercent(reading: any): number | null {
    const value = this.toNumber(reading?.read_confidence);
    return value === null ? null : Math.round(value * 100);
  }

  /** ตัวเลขที่หลังบ้านคืนมาเป็น string ได้ ('14.98') — ค่าว่างต้องเป็น null ไม่ใช่ 0 */
  private toNumber(raw: any): number | null {
    if (raw === null || raw === undefined || raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  /** พิกัดจาก EXIF ของรูปใบนี้ — คนละค่ากับพิกัดที่ลงทะเบียนไว้ในทะเบียนบ้าน */
  private photoCoords(reading: any): { lat: number; lng: number } | null {
    // Number(null) = 0 — ถ้าไม่กันก่อน ด้านที่ว่างจะกลายเป็นพิกัด 0 องศาแล้วชี้ผิดทวีป
    const lat = this.toNumber(reading?.latitude);
    const lng = this.toNumber(reading?.longitude);
    if (lat === null || lng === null) return null;
    // 0,0 คือค่าที่หลุดมาตอนอ่าน EXIF ไม่ได้ ไม่ใช่พิกัดกลางมหาสมุทรจริง ๆ
    if (lat === 0 && lng === 0) return null;
    return { lat, lng };
  }

  onPhotoError() {
    this.photoBroken = true;
    this.cdr.detectChanges();
  }

  openPhoto() {
    if (this.photoBroken) return;
    this.photoZoomed = true;
  }

  closePhoto() {
    this.photoZoomed = false;
  }


  // สั่งพิมพ์ผ่านศูนย์กลาง เอกสารถูก render ที่ <app-bill-print> ใน app.html
  printSingleBill(bill: any): void {
    this.print.printSingle(bill);
  }

  printBills(bills: any[]): void {
    this.print.printMany(bills);
  }



  constructor(
    private meterReadingService: MeterReadingService,
    private cdr: ChangeDetectorRef
  ) { }

  // ข้อความ/รูปแบบทั้งหมดใช้ตัวเดียวกับที่พิมพ์ลงกระดาษ (ดู BillPrintService)
  statusLabel(status: string): string {
    return this.print.statusLabel(status);
  }

  ownerName(bill: any): string {
    return this.print.ownerName(bill);
  }

  monthLabel(month: string | number, year: string | number): string {
    return this.print.monthLabel(month, year);
  }

  bahtText(amount: number): string {
    return this.print.bahtText(amount);
  }

  dueDate(bill: any): Date | null {
    return this.print.dueDate(bill);
  }

  dateLabel(value: string | Date | null | undefined): string {
    return this.print.dateLabel(value);
  }

  /** ช่วงวันจริงที่บิลใบนี้คิดค่าน้ำ — ว่างเมื่อเป็นใบแรกของบ้าน (ไม่มีรอบก่อนให้เทียบ) */
  cycleLabel(bill: any): string {
    return this.print.cycleLabel(bill);
  }

  // ==========================================
  // จัดบิลเป็นกลุ่มตามเดือน (เดือนล่าสุดอยู่บนสุด)
  // ==========================================
  billGroups: any[] = [];

  // เดือนที่กำลังดูอยู่ และคำค้นหาบ้าน/ชื่อเจ้าของ
  selectedMonthKey = '';
  searchTerm = '';

  // กลุ่มของเดือนที่เลือกอยู่
  get selectedGroup(): any | null {
    return this.billGroups.find(g => g.key === this.selectedMonthKey) ?? null;
  }

  // บิลที่จะแสดงจริง = เฉพาะเดือนที่เลือก แล้วกรองด้วยคำค้นหาอีกชั้น
  get visibleBills(): any[] {
    const bills: any[] = this.selectedGroup?.bills ?? [];
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) return bills;

    return bills.filter(bill =>
      String(bill.member?.house_no ?? '').toLowerCase().includes(term) ||
      this.ownerName(bill).toLowerCase().includes(term)
    );
  }


  // รวมบิลเป็นกลุ่มรายเดือน พร้อมยอดรวมและจำนวนที่ยังไม่ชำระของเดือนนั้น
  private buildBillGroups(): void {
    const groups = new Map<string, any>();

    for (const bill of this.bills) {
      const month = String(bill.billing_month ?? '').padStart(2, '0');
      const year = String(bill.billing_year ?? '');
      const key = `${year}-${month}`;

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label: this.monthLabel(bill.billing_month, bill.billing_year),
          bills: [],
          total: 0,
          unpaid: 0
        });
      }

      const group = groups.get(key);
      group.bills.push(bill);
      group.total += Number(bill.total_amount) || 0;
      if (bill.payment_status !== 'Paid') group.unpaid++;
    }

    // เรียงเดือนล่าสุดขึ้นก่อน
    this.billGroups = [...groups.values()].sort((a, b) => b.key.localeCompare(a.key));

    // เปิดหน้ามาให้เห็นเดือนล่าสุดเลย (หรือถ้าเดือนที่ดูอยู่หายไปแล้วก็เด้งกลับมาเดือนล่าสุด)
    if (!this.billGroups.some(g => g.key === this.selectedMonthKey)) {
      this.selectedMonthKey = this.billGroups[0]?.key ?? '';
    }
  }

  // ==========================================
  // เปลี่ยนสถานะการชำระ — ต้องยืนยันก่อนเสมอ
  // ==========================================

  /**
   * บิลที่กำลังจะเปลี่ยนสถานะ (null = ยังไม่ได้กด)
   *
   * ปุ่มสถานะเป็นชิปเล็ก ๆ ที่อยู่ติดปุ่มอื่นในแถวเดียวกัน แตะพลาดบนมือถือได้ง่ายมาก
   * และการกดพลาดมีผลจริงทั้งสองทาง: เป็น "ชำระแล้ว" แล้วจะจดมิเตอร์ทับไม่ได้อีก
   * ส่วนการกดกลับเป็น "รอชำระเงิน" ทำให้ยอดค้างของเดือนนั้นเพี้ยนทันที
   */
  billToToggle: any = null;
  isTogglingStatus = false;

  /** สถานะที่บิลจะกลายเป็นถ้ายืนยัน — ใช้ทั้งตอนถามและตอนส่งขึ้นหลังบ้าน */
  get toggleTargetStatus(): string {
    return this.billToToggle?.payment_status === 'Paid' ? 'Pending' : 'Paid';
  }

  askToggleStatus(bill: any) {
    this.billToToggle = bill;
  }

  cancelToggleStatus() {
    // กำลังยิงอยู่ห้ามปิด ไม่งั้นจะไม่รู้ว่าตกลงเปลี่ยนสำเร็จไหม
    if (this.isTogglingStatus) return;
    this.billToToggle = null;
  }

  // ยอดเงินใช้สูตรเดียวกับที่พิมพ์ลงกระดาษ (เหมือน statusLabel/bahtText ข้างบน)
  // ตัวเลขบนจอกับบนใบเสร็จต้องตรงกันเสมอ ไม่งั้นเถียงกับลูกบ้านไม่จบ

  /** ยอดที่ต้องเก็บจริง = ค่าน้ำเดือนนี้ + ยอดค้างที่ทบมา */
  payable(bill: any): number {
    return this.print.payable(bill);
  }

  /** ยอดค้างเก่าที่ถูกทบเข้าใบนี้ — 0 = ตอนออกใบนี้ไม่มีบิลค้าง */
  arrears(bill: any): number {
    return this.print.arrears(bill);
  }

  hasArrears(bill: any): boolean {
    return this.print.hasArrears(bill);
  }

  confirmToggleStatus() {
    const bill = this.billToToggle;
    if (!bill || this.isTogglingStatus) return;

    const newStatus = this.toggleTargetStatus;
    this.isTogglingStatus = true;

    // ═══ รับเงินกับแก้ที่กดผิด เดินคนละทาง ═══
    //
    // รับเงิน (→ Paid) ต้องยิง /pay เพราะยอดที่ลูกบ้านจ่ายคือ grand_total ซึ่งรวม
    // ยอดค้างของบิลเก่าไว้แล้ว หลังบ้านจะปิดใบเก่าที่ถูกทบให้ทั้งชุดในทีเดียว
    // ถ้าใช้ /status ใบเก่าจะค้างอยู่ แล้วเดือนหน้าทบซ้ำ = เก็บเงินซ้ำ
    //
    // ส่วนการกดกลับเป็น Pending คือการแก้ที่กดผิด ไม่ใช่ธุรกรรมการเงิน ใช้ /status ตามเดิม
    const request$ =
      newStatus === 'Paid'
        ? this.meterReadingService.payBill(bill.id)
        : this.meterReadingService.updatePaymentStatus(bill.id, newStatus);

    request$.subscribe({
      next: (res: any) => {
        bill.payment_status = newStatus;
        this.isTogglingStatus = false;
        this.billToToggle = null;

        // ใบเก่าที่ถูกปิดไปพร้อมกันต้องอัปเดตบนจอด้วย ไม่งั้นตารางจะโชว์ว่ายังค้าง
        // ทั้งที่ปิดไปแล้ว แล้วมีคนไปกดรับเงินซ้ำอีกใบ
        const settled: number[] = Array.isArray(res?.settled_bill_ids) ? res.settled_bill_ids : [];
        for (const other of this.bills) {
          if (settled.includes(other.id)) other.payment_status = 'Paid';
        }

        this.buildBillGroups(); // ยอดค้างชำระของเดือนนั้นเปลี่ยน ต้องคำนวณใหม่
        this.cdr.detectChanges();

        if (newStatus === 'Paid') {
          toast.success(
            settled.length
              ? `รับชำระเงินเรียบร้อย — ปิดบิลค้างเก่าให้อีก ${settled.length} ใบ`
              : 'รับชำระเงินเรียบร้อย',
            { id: 'status-updated' }
          );
        } else {
          toast.success('เปลี่ยนเป็น "รอชำระเงิน" เรียบร้อย', { id: 'status-updated' });
        }
      },
      error: (err) => {
        console.error('Update status error:', err);
        this.isTogglingStatus = false;
        // ไม่ปิดหน้าต่าง เพื่อให้กดลองใหม่ได้ทันทีโดยไม่ต้องหาบิลใบเดิมอีกรอบ
        this.cdr.detectChanges();
        toast.error(extractErrorMessage(err, 'เปลี่ยนสถานะไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), { id: 'status-error' });
      }
    });
  }

  // 🌟 ปรับ ngOnInit ให้เรียกตรงๆ ไม่ต้องใช้ setTimeout ป้องกันปัญหา Scope หลุด
  // ตอน prerender (SSR) ยังไม่มี token ใน localStorage ยิง API ไปก็ได้ 401 เปล่า ๆ
  // ต้องข้ามไปก่อน แล้วให้ฝั่ง browser โหลดจริง ไม่งั้น build จะพังตอน prerender
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  ngOnInit(): void {
    if (!this.isBrowser) return;

    this.loadBillingHistory();
  }

  loadBillingHistory() {
    if (this.isFetching) return;

    this.isFetching = true;
    this.isLoading = true;

    this.meterReadingService.getBills().subscribe({
      next: (data) => {
        this.bills = data;
        this.buildBillGroups(); // จัดกลุ่มรายเดือนใหม่ทุกครั้งที่โหลดข้อมูล
        // รอบของบิลใบหนึ่งต้องรู้วันจดของใบก่อนหน้า จึงคิดได้เฉพาะตอนมีบิลครบทั้งกอง
        this.print.indexCycles(this.bills);
        this.isLoading = false;
        this.isFetching = false;

        // 🌟 ใส่เครื่องหมาย ? ดักไว้ (Optional Chaining) ป้องกันระเบิด
        this.cdr?.detectChanges();
      },
      error: (err) => {
        console.error('Fetch history error:', err);
        this.isLoading = false;
        this.isFetching = false;

        // 🌟 ใส่เครื่องหมาย ? ดักไว้เช่นกันครับ
        this.cdr?.detectChanges();
        toast.error(extractErrorMessage(err, 'ดึงประวัติบิลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), { id: 'history-error' });
      }
    });
  }

  // --- 🗑️ ถามยืนยันก่อนลบ (แทน confirm() ของเบราว์เซอร์) ---
  askDelete(bill: any) {
    this.billToDelete = bill;
  }

  cancelDelete() {
    this.billToDelete = null;
  }

  confirmDelete() {
    if (!this.billToDelete) return;

    const id = this.billToDelete.id;
    this.billToDelete = null;
    this.deleteBill(id);
  }

  // 🌟 ฟังก์ชันลบข้อมูล
  deleteBill(id: number) {
    this.meterReadingService.deleteBill(id).subscribe({
      next: () => {
        toast.success('ลบบิลเรียบร้อยแล้ว', { id: 'delete-success' });
        // พอลบสำเร็จ ก็สั่งโหลดข้อมูลใหม่ให้หน้าจอตารางรีเฟรชทันที
        this.loadBillingHistory();
      },
      error: (err) => {
        console.error('Delete error:', err);
        this.cdr?.detectChanges();
        toast.error(extractErrorMessage(err, 'ลบข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), { id: 'delete-error' });
      }
    });
  }
}
