import { ChangeDetectorRef, Component, OnDestroy, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ImageCropperComponent, ImageTransform } from 'ngx-image-cropper';
import { toast } from 'ngx-sonner';
import { MeterReadingService } from '../../services/meter-reading.service';
import { MemberService } from '../../../member/services/member.service';
import { AuthService } from '../../../auth/services/auth.service';
import { extractErrorCode, extractErrorMessage } from '../../../auth/services/auth-error';
import { BillPrintService } from '../../services/bill-print.service';
import { LatLng, distanceMeters, isFarFrom, medianCoords, pickNearest, toCoords } from '../../services/geo';
import { logAmbiguousMatch, logCoordsMismatch } from '../../services/coords-log';
import { parseCaptureDate, readPhotoMetadata } from '../../services/exif';
import { suggestBillingMonth } from '../../services/billing-cycle';
import { photoDataUrl } from '../../services/photo-file';
import { Village, VillageService } from '../../../village/services/village.service';
import { StoredQueue, StoredRow, clearQueue, loadQueue, saveQueue } from '../../services/batch-queue.store';
import { DeviceLocationComponent } from '../device-location/device-location';
import { PHOTO_COORDS_HINT } from '../../services/photo-coords-help';

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

/**
 * ด่านของหลังบ้านที่ "คนดูแล้วยืนยันได้" — ตีกลับมาพร้อมรหัส แล้วขึ้นปุ่มให้กดยืนยันในแถว
 *
 * ทุกด่านที่ไม่อยู่ในตารางนี้ (รูปถูกใช้ไปแล้ว · บิลจ่ายเงินแล้ว · มีบิลของรอบถัดไปแล้ว)
 * ตั้งใจไม่มีปุ่มให้กด — เป็นเรื่องที่ต้องไปแก้ที่ต้นทาง ไม่ใช่กดข้ามแล้วออกบิลทับ
 *
 * `legacy` คือทางถอยไว้อ่านจากข้อความ ระหว่างที่หลังบ้านยังส่งรหัสมาไม่ครบทุกด่าน
 * ใช้ต่อเมื่อ **ไม่มีรหัสติดมาเลย** เท่านั้น ใบที่มีรหัสแล้วต้องตัดสินจากรหัสอย่างเดียว
 * ไม่งั้นข้อความของด่านที่ห้ามข้ามอาจไปเข้าเงื่อนไขของด่านที่มีปุ่ม แล้วได้ปุ่มข้ามมาฟรี ๆ
 * ลบ legacy ทิ้งได้เมื่อหลังบ้านส่งรหัสครบแล้ว
 */
interface ConfirmStep {
  code: string;
  legacy: RegExp | null;
  /** ธงใน ScanRow ที่จะถูกตั้งเป็น true เมื่อคนกดยืนยัน */
  flag: 'confirmHighUsage' | 'confirmDigitChange' | 'confirmLowConfidence' | 'confirmDuplicateLocation' | 'confirmStalePhoto';
  label: string;
}

const CONFIRM_STEPS: readonly ConfirmStep[] = [
  {
    code: 'HIGH_USAGE',
    legacy: /หน่วย/,
    flag: 'confirmHighUsage',
    label: 'ตรวจแล้ว เลขถูกต้อง — ให้ออกบิลรอบหน้า'
  },
  {
    code: 'DIGIT_CHANGE',
    legacy: /หลัก/,
    flag: 'confirmDigitChange',
    label: 'เทียบกับหน้าปัดแล้ว จำนวนหลักถูกต้อง — ให้ออกบิลรอบหน้า'
  },
  {
    code: 'LOW_CONFIDENCE',
    // หลังบ้านส่งรหัสของด่านนี้มาแล้ว จึงไม่ต้องเดาจากข้อความ
    legacy: null,
    flag: 'confirmLowConfidence',
    label: 'เทียบกับรูปแล้ว เลขถูกต้อง — ให้ออกบิลรอบหน้า'
  },
  {
    code: 'DUPLICATE_LOCATION',
    legacy: /เป๊ะทุกทศนิยม/,
    flag: 'confirmDuplicateLocation',
    label: 'ยืนยันว่าถ่ายใหม่จริง — ให้ออกบิลรอบหน้า'
  },
  {
    code: 'STALE_PHOTO',
    legacy: /ไม่ใช่เลขของรอบนี้/,
    flag: 'confirmStalePhoto',
    label: 'ยืนยันว่าใช้รูปถูกใบ — ให้ออกบิลรอบหน้า'
  }
];

/** บ้านหนึ่งหลังที่ยกมาให้กดเลือกในแถว พร้อมเหตุผลว่าทำไมกดไม่ได้ (ถ้ากดไม่ได้) */
interface NearbyChoice {
  member: any;
  meters: number;
  /**
   * เลขมิเตอร์เดือนที่แล้วของบ้านหลังนี้ — ดึงเฉพาะแถวที่ไม่มีรูปให้เทียบแล้ว
   * (ดู loadNearbyPreviousUnits) เพราะตอนนั้นเลขสะสมคือหลักฐานเดียวที่เหลือ
   * ว่ากำลังจดหน้าปัดของบ้านหลังไหน — null = ยังไม่ได้ค่า หรือหลังบ้านไม่มีให้
   */
  previousUnit: number | null;
  /**
   * แถวอื่นในกองเลือกบ้านหลังนี้ไปแล้ว — 1 บ้านมีบิลได้รอบละใบเดียว (ดู isDuplicate)
   * เก็บลำดับรูปไว้ด้วย เพื่อให้คนไล่ขึ้นไปดูได้ว่ารูปไหนไปทับ ถ้าเห็นว่ารูปนั้นเลือกผิด
   */
  takenBySeq: number | null;
}

/**
 * รหัสประจำการจดหนึ่งครั้ง — ใช้กันบิลซ้ำเวลายิงซ้ำ
 *
 * `crypto.randomUUID` ไม่มีในทุกที่ (เบราว์เซอร์เก่า / หน้าที่เปิดผ่าน http ที่ไม่ใช่
 * localhost ซึ่งไม่ใช่ secure context) จึงต้องมีทางถอย — รหัสที่สุ่มเองก็ทำหน้าที่
 * เดียวกันได้ครบ เพราะมันแค่ต้องไม่ซ้ำกับของแถวอื่น ไม่ได้ต้องปลอดภัยเชิงรหัสลับ
 */
function newClientUuid(): string {
  const uuid = (globalThis.crypto as Crypto | undefined)?.randomUUID;
  if (typeof uuid === 'function') return uuid.call(globalThis.crypto);
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

interface ScanRow {
  seq: number;
  /**
   * รหัสประจำการจดของแถวนี้ สร้าง**ตอนแถวเกิด** ไม่ใช่ตอนจะยิง
   *
   * หลังบ้านใช้กันบิลซ้ำ: ยิงซ้ำด้วยรหัสเดิมจะได้บิลใบเดิมกลับมา (200) ไม่ใช่บิลใบที่สอง
   * ซึ่งเป็นสิ่งที่ต้องมีเมื่อเน็ตหลุดตอนกำลังยิง — สถานะ 'unknown' ของแถวที่ค้าง
   * แปลว่า "ไม่รู้ว่าออกไปแล้วหรือยัง" และคนจะกดออกบิลซ้ำเสมอ
   *
   * ⚠️ ต้องติดไปกับแถวข้ามการกู้คิวด้วย ถ้าสร้างใหม่ตอนกู้ = กันอะไรไม่ได้เลย
   */
  clientUuid: string;
  /** null = แถวที่กู้มาจากคิวเก่า ตัวรูปไม่ได้ถูกเก็บไว้ */
  file: File | null;
  fileKey: string;
  fileName: string;
  previewUrl: string | null;
  brokenImage: boolean;

  capturedAt: Date | null;
  latitude: number | null;
  longitude: number | null;
  /**
   * รูปย่อพร้อมส่ง (data URL) — เตรียมไว้ตั้งแต่ตอนเลือกไฟล์ เพราะถ้าไปแปลงตอนกดออกบิล
   * คิวจะสะดุดทีละใบ และห้ามเก็บลง localStorage เด็ดขาด (ก้อนใหญ่จนเต็มโควตา)
   */
  photoData: string | null;

  memberId: number | null;
  /** ระบบเสนอให้ หรือคนเลือกเอง — ต้องแยกให้ออกเวลาไล่ตรวจ */
  matchedBy: 'system' | 'manual' | 'none';
  /**
   * บ้านหลังนี้ได้มาจากพิกัดในรูป (ไม่ใช่จากเลขมิเตอร์หรือคนเลือก)
   * ต้องรู้ เพราะห้ามเอาพิกัดในรูปไปทับพิกัดของบ้านที่ตัวมันเองเป็นคนชี้มา — วนเป็นงูกินหาง
   */
  matchedByCoords: boolean;
  matchConfidence: 'high' | 'medium' | 'ambiguous' | 'none' | null;
  matchReason: string | null;
  candidates: Candidate[];
  /** บ้านที่มิเตอร์อยู่ใกล้จุดถ่ายรูปใบนี้ เรียงจากใกล้ไปไกล (ดู refreshNearby) */
  nearby: NearbyChoice[];
  warnings: string[];

  unit: number | null;
  /** ความมั่นใจของ AI เป็นเปอร์เซ็นต์ (0–100) ไว้แสดงบนจอเท่านั้น — ที่ส่งขึ้นไปคือค่าดิบ */
  confidence: number | null;
  confirmHighUsage: boolean;
  /** ยืนยันแล้วว่าจำนวนหลักที่เปลี่ยนไปถูกต้อง (เช่นเปลี่ยนมิเตอร์รุ่นคนละหลัก) */
  confirmDigitChange: boolean;
  /** ยืนยันแล้วว่าเลขที่ AI อ่านมาไม่ชัดนั้นตรงกับหน้าปัดจริง */
  confirmLowConfidence: boolean;
  /** ยืนยันแล้วว่าเป็นรูปที่ถ่ายใหม่ ไม่ใช่รูปเดิมที่ส่งซ้ำ */
  confirmDuplicateLocation: boolean;
  /** ยืนยันแล้วว่าเลขที่ต่ำลงเกิดจากเปลี่ยนมิเตอร์ใหม่ ไม่ใช่ไปอ่านหน้าปัดของหลังข้าง ๆ มา */
  confirmMeterReset: boolean;
  /**
   * เลขปิดของมิเตอร์ตัวเก่า ณ วันที่ถอดออก — ต้องมีคู่กับ confirmMeterReset เสมอ
   *
   * ขาดตัวนี้แล้วหน่วยของรอบที่เปลี่ยนมิเตอร์จะหายไปทั้งก้อน (หลังบ้านคิด
   * เลขใหม่ − เลขตั้งต้น ซึ่งติดลบ) = ลูกบ้านได้ใช้น้ำฟรีหนึ่งรอบโดยไม่มีใครเห็น
   */
  oldMeterFinalUnit: number | null;
  /** ยืนยันแล้วว่าใช้รูปถูกใบ ทั้งที่วันถ่ายเก่ากว่ารอบที่ออก */
  confirmStalePhoto: boolean;
  /** เลขของแถวนี้มาจากการครอปแล้วอ่านใหม่ ไม่ใช่การอ่านรูปเต็มใบตอนแรก */
  croppedRead: boolean;

  /**
   * เลข + จำนวนหลัก + ความมั่นใจที่ AI อ่านมา เก็บแยกจาก unit ที่คนแก้เองได้
   * ด่านจำนวนหลัก/ความชัดของหลังบ้านต้องตรวจกับเลขที่ AI เห็นจริง ไม่ใช่เลขที่คนพิมพ์ทับ
   */
  ocrUnit: number | null;
  meterDigits: number | null;
  /** ค่าดิบ 0–1 ตามที่หลังบ้านใช้ (ตัดที่ 0.85) — เก็บก่อนปัดเป็นเปอร์เซ็นต์ */
  ocrConfidence: number | null;

  status: RowStatus;
  error: string | null;
  /** รหัสด่านที่หลังบ้านตีกลับมา ใช้เลือกปุ่มยืนยัน (ดู CONFIRM_STEPS) */
  errorCode: string | null;
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
 * สองอย่างแรกเดินเองตั้งแต่เลือกรูป (ดู scheduleAutoAnalyze / runAfterAnalyze)
 *
 * อ่านเลขเสร็จแล้วเดินสองจังหวะ: ใบที่**พิกัดในรูปยืนยันบ้านได้แบบตรงแปะ** (instantRows)
 * ยิงออกบิลเลยไม่ต้องถาม — จบคิวนั้นแล้วค่อยขึ้นกล่องถามเรื่องใบที่เหลือ
 *
 * ⚠️ ตามที่เจ้าของโปรเจกต์สั่ง กล่องนั้นเสนอออกบิล **ทุกใบที่เลือกบ้านแล้ว**
 *    ไม่ใช่เฉพาะใบที่ยืนยันบ้านได้ — ด่านฝั่งหน้าเว็บ (พิกัดยืนยัน · AI ≥ 85% · วันถ่าย ·
 *    หน่วยพุ่ง · คำเตือนจากหลังบ้าน) กลายเป็นแค่ "ป้ายเตือน" ไม่ได้กันคิวอีกต่อไป
 *    สิ่งเดียวที่ยังกันอยู่คือกล่องถามยืนยันก่อนคิวเริ่มเดิน (forceConfirm) กับด่านที่
 *    blockingIssue() จับได้ (ไม่มีบ้าน · ไม่มีเลข · ซ้ำในกอง · มีบิลรอบนี้แล้ว) ซึ่งยิงไปก็ไม่ผ่าน
 *
 *    ด่านฝั่งหลังบ้านยังทำงานครบทุกใบเหมือนเดิม ธง confirm_* ไม่เคยถูกส่งเป็น true เอง
 *    ใบที่ติดด่านของหลังบ้านยังตกมาให้คนกดยืนยันอยู่ — ตรงนั้นห้ามถอด
 */
@Component({
  selector: 'app-batch-scan',
  standalone: true,
  imports: [CommonModule, FormsModule, ImageCropperComponent, DeviceLocationComponent],
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

  /**
   * กล่องถามก่อนยิงทั้งกอง — null = ไม่มีอะไรค้างถาม
   *
   * เป็นจุดเดียวที่เหลือให้คนเบรกก่อนบิลออก เพราะคิวชุดนี้ไม่ได้กรองด้วย autoSavable() แล้ว
   * เก็บเป็นตัวเลข ณ ตอนอ่านเลขเสร็จไว้โชว์เฉย ๆ ส่วนคิวจริงคิดใหม่ตอนกดยืนยัน (คนแก้แถวได้
   * ระหว่างที่กล่องค้างอยู่ ถ้าใช้ตัวเลขเก่าจะยิงคนละชุดกับที่เห็นบนจอ)
   */
  forceConfirm: { total: number; skipped: number } | null = null;

  /** คิวที่กำลังเดินคือชุด "พิกัดตรงแปะ" — จบแล้วต้องถามต่อเรื่องใบที่เหลือ */
  private askAfterQueue = false;

  /** ระยะที่ถือว่าพิกัดในรูป "ยืนยัน" บ้านหลังนั้นได้ — สั้นกว่าระยะที่ใช้เดาบ้านครึ่งหนึ่ง */
  private readonly confirmMeters = 25;

  /**
   * ไกลกว่านี้ถือว่าพิกัดในรูป "ค้าน" บ้านที่จับคู่มาจากเลขมิเตอร์
   * GPS มือถือเพี้ยนได้ 5–20 ม. บวกกับพิกัดมิเตอร์ที่จดไว้เพี้ยนได้อีกพอกัน
   * เกิน 50 ม. จึงไม่ใช่ความคลาดเคลื่อนแล้ว แต่เป็นคนละบ้าน
   */
  private readonly conflictMeters = 50;

  /** ต่ำกว่านี้ถือว่า AI ยังอ่านเลขไม่ชัดพอจะปล่อยผ่านโดยไม่มีคนดู */
  private readonly trustedConfidence = 85;

  /**
   * ต่ำกว่านี้คือ "อ่านแทบไม่ออก" ต้องขึ้นเตือนสีส้มให้เห็นชัดในแถว
   * แต่ยัง**ไม่ใช่ด่าน** — คนแก้เลขเองแล้วกดออกบิลได้ตามปกติ ต่างจากใบที่ไม่มีรูป
   */
  private readonly weakConfidence = 50;

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
    if (this.autoAnalyzeTimer) clearTimeout(this.autoAnalyzeTimer);
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
        // รายชื่อบ้านมาช้ากว่าการเลือกรูปได้ (คนเปิดหน้าแล้วกดเลือกทันที) ตอนนั้น
        // matchByCoords ยังไม่มีบ้านให้เทียบเลยคืนมือเปล่า ถ้าไม่ไล่จับคู่ซ้ำตรงนี้
        // ทั้งกองจะไม่มีบ้านให้เลยทั้งที่พิกัดครบ แล้วไม่มีอะไรมาเรียกให้อีกแล้ว
        this.rows.forEach((row) => this.matchByCoords(row));
        this.refreshAllNearby();
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

  async onFilesPicked(event: Event): Promise<void> {
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
    for (const file of taking) {
      this.rows.push(await this.buildRow(file));
    }

    // จับคู่บ้านจากพิกัดในรูปได้ตั้งแต่ตอนนี้ ไม่ต้องรอหลังบ้านอ่านเลขเสร็จ
    this.rows.forEach((row) => this.matchByCoords(row));
    this.refreshAllNearby();
    // ต้องตั้งรอบบิลให้ตรงกับวันถ่าย "ก่อน" ยิงอ่าน เพราะเลขตั้งต้นที่หลังบ้านใช้จับคู่บ้าน
    // คิดจากรอบบิลที่ส่งไปด้วย — ส่งเดือนผิดคือได้เลขตั้งต้นผิดแล้วจับคู่ผิดตั้งแต่ต้นทาง
    this.syncBillingToPhotos();
    this.persist();
    this.cdr.detectChanges();

    // ย่อรูปไว้เบื้องหลัง กว่าจะไล่ตรวจเสร็จก็พร้อมส่งพอดี (ดู photoData)
    void this.preparePhotos();
    this.scheduleAutoAnalyze();

    if (skipped > 0) toast.success(`ข้ามไฟล์ที่ไม่ใช่รูป ${skipped} ไฟล์ครับ`, { id: 'batch-skipped' });
    if (duplicated > 0) toast.success(`ข้ามรูปที่อยู่ในคิวอยู่แล้ว ${duplicated} รูปครับ`, { id: 'batch-dup-file' });
    if (fresh.length > taking.length) {
      toast.error(`ใส่ได้อีกแค่ ${room} รูป ส่วนที่เหลือยังไม่ได้ใส่ครับ`, { id: 'batch-limit' });
    }
  }

  private keyOf(file: File): string {
    return `${file.name}|${file.size}|${file.lastModified}`;
  }

  // ==========================================
  // อ่านเลขเองตั้งแต่เลือกรูป
  // ==========================================

  /**
   * หน่วงก่อนยิงอ่านเอง — เลือกหลายรูปแล้วกดเลือกเพิ่มอีกชุดตามหลังเป็นเรื่องปกติ
   * (โฟลเดอร์ละซอย หรือกดพลาดแล้วเลือกใหม่) ยิงทันทีที่ input แรกเปลี่ยนจะได้สองรอบ
   * แล้วชุดหลังต้องรอชุดแรกจบก่อนเพราะ isBusy ค้างอยู่ — รวมเป็นรอบเดียวจบเร็วกว่า
   */
  private readonly autoAnalyzeDelayMs = 1200;
  private autoAnalyzeTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * เลือกรูปแล้วอ่านเลขให้เลย ไม่ต้องกดปุ่ม
   *
   * ปุ่ม "อ่านเลข" ยังอยู่ เพราะรอบที่ยิงเองอาจล้มทั้งชุด (เน็ตหลุดกลางทาง) แล้วต้องมี
   * ทางกดซ้ำ — แต่ทางปกติต้องไม่ต้องกด เจ้าหน้าที่เลือกรูปเสร็จก็ควรได้ไปตรวจผลเลย
   */
  private scheduleAutoAnalyze(): void {
    if (!this.isBrowser) return;
    if (this.autoAnalyzeTimer) clearTimeout(this.autoAnalyzeTimer);

    this.autoAnalyzeTimer = setTimeout(() => {
      this.autoAnalyzeTimer = null;
      // กดปุ่มเองทัน หรือกำลังออกบิลค้างอยู่ → ปล่อยผ่าน ไม่แย่งคิวกัน
      if (this.isBusy || !this.analyzableRows.length) return;
      this.analyze();
    }, this.autoAnalyzeDelayMs);
  }

  /**
   * ตั้งรอบบิลตามเดือนของวันถ่ายที่พบมากที่สุดในกอง
   *
   * ค่าตั้งต้นคือ "เดือนนี้" ซึ่งผิดทันทีที่ไปจดสิ้นเดือนแล้วมานั่งอัปวันที่ 1–2 ของ
   * เดือนถัดไป (เกิดประจำ) บิลทั้งกองจะไปลงเดือนใหม่ เดือนที่ใช้น้ำจริงไม่มีบิล
   * แถมกินโควตา "1 บ้าน 1 บิลต่อเดือน" ของเดือนที่ยังไม่ได้ไปจดอีก
   *
   * ใช้เสียงข้างมากเพราะกองหนึ่งคือรอบเดินจดรอบเดียว รูปหลงมาจากวันอื่นหนึ่งสองใบ
   * ต้องไม่ลากทั้งกองตาม (ใบพวกนั้นจะโดนเตือนรายแถวเองที่ isOutsideBillingMonth)
   */
  private syncBillingToPhotos(): void {
    // ออกบิลไปแล้วบางใบ = ใบที่ออกไปใช้รอบเดิม เปลี่ยนตอนนี้จะเหลือกองที่คนละรอบกัน
    if (this.rows.some((row) => row.status === 'saved')) return;

    const votes = new Map<string, number>();
    for (const row of this.rows) {
      const key = this.suggestedBillingKey(row);
      if (key) votes.set(key, (votes.get(key) ?? 0) + 1);
    }
    if (!votes.size) return;

    const [winner] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    if (winner === this.billingKey) return;

    // เลือกได้แค่เดือนที่มีในลิสต์ (ย้อนหลัง 6 เดือน) รูปเก่ากว่านั้นปล่อยให้คนเลือกเอง
    const option = this.billingMonths.find((m) => m.key === winner);
    if (!option) return;

    this.billingKey = option.key;
    this.onBillingKeyChanged();
    toast.success(`ตั้งรอบบิลเป็น ${option.label} ตามวันถ่ายในรูปให้แล้วครับ`, { id: 'batch-billing-auto' });
  }

  /** รอบเดือนที่รูปใบนี้ควรลง ตามวันที่ถ่าย — null เมื่อรูปไม่มีวันถ่ายติดมา */
  private suggestedBillingKey(row: ScanRow): string | null {
    // ไม่มีประวัติการจดรายบ้านในหน้านี้ (ต้องยิง API ต่อบ้าน) จึงเทียบได้แค่ระดับเดือน
    // ปฏิทิน ส่วนการเลื่อนรอบตามวันจดประจำของบ้านเป็นงานของโหมดทีละหลัง
    return row.capturedAt ? suggestBillingMonth(row.capturedAt, null).key : null;
  }

  /** วันถ่ายของรูปใบนี้อยู่คนละเดือนกับรอบบิลที่ตั้งไว้ทั้งกอง */
  isOutsideBillingMonth(row: ScanRow): boolean {
    const key = this.suggestedBillingKey(row);
    return key !== null && key !== this.billingKey;
  }

  /** ชื่อรอบเดือนตามวันถ่ายของรูปใบนี้ (ภาษาไทย พ.ศ.) — ใช้ในข้อความเตือน */
  private suggestedBillingLabel(row: ScanRow): string {
    if (!row.capturedAt) return '—';

    const suggested = suggestBillingMonth(row.capturedAt, null);
    return this.print.monthLabel(suggested.month, suggested.year);
  }

  /**
   * อ่านวันถ่ายกับพิกัดจากไฟล์ต้นฉบับเองตั้งแต่ตอนเลือกรูป
   *
   * เดิมหน้านี้รอค่าจาก `photo_taken` ที่หลังบ้านส่งกลับมาอย่างเดียว พอหลังบ้าน
   * อ่านไม่ได้หรือยังไม่ได้ทำส่วนนั้น ทุกแถวจะว่างเปล่า — ไม่มีวันถ่ายให้ลง reading_date
   * (บิลไปลงวันที่กดบันทึกแทนวันที่ไปจดจริง) และไม่มีพิกัดให้จับคู่บ้าน
   * ทั้งที่ข้อมูลอยู่ในไฟล์ที่อยู่ในมือเราตั้งแต่แรกแล้ว
   */
  private async buildRow(file: File): Promise<ScanRow> {
    const meta = await readPhotoMetadata(file);
    const coords = toCoords(meta.latitude, meta.longitude);

    return {
      seq: ++this.seq,
      clientUuid: newClientUuid(),
      file,
      fileKey: this.keyOf(file),
      fileName: file.name,
      previewUrl: URL.createObjectURL(file),
      brokenImage: false,
      capturedAt: parseCaptureDate(meta.captureDate),
      latitude: coords?.lat ?? null,
      longitude: coords?.lng ?? null,
      photoData: null,
      memberId: null,
      matchedBy: 'none',
      matchedByCoords: false,
      matchConfidence: null,
      matchReason: null,
      candidates: [],
      nearby: [],
      warnings: [],
      unit: null,
      confidence: null,
      confirmHighUsage: false,
      confirmDigitChange: false,
      confirmLowConfidence: false,
      confirmDuplicateLocation: false,
      confirmStalePhoto: false,
      confirmMeterReset: false,
      oldMeterFinalUnit: null,
      croppedRead: false,
      ocrUnit: null,
      meterDigits: null,
      ocrConfidence: null,
      status: 'pending',
      error: null,
      errorCode: null,
      billId: null
    };
  }

  /** ห่อไว้เป็นเมธอดเพื่อให้เทสต์แทนได้ — jsdom เปิดรูปจริงไม่ได้ */
  private photoDataUrl(file: Blob): Promise<string | null> {
    return this.isBrowser ? photoDataUrl(file) : Promise.resolve(null);
  }

  /**
   * ย่อรูปทีละใบไว้ล่วงหน้า เพื่อแนบไปกับบิลตอนออก (หลักฐานว่าเลขมาจากหน้าปัดจริง)
   * ทำเบื้องหลังไม่บล็อกหน้าจอ ใบไหนแปลงไม่ได้ก็ปล่อยเป็น null แล้วออกบิลโดยไม่มีรูป
   */
  private async preparePhotos(): Promise<void> {
    for (const row of this.rows) {
      if (!row.file || row.photoData) continue;

      row.photoData = await this.photoDataUrl(row.file);
      this.cdr.detectChanges();
    }
  }

  /**
   * จับคู่บ้านจากพิกัดที่ติดมากับรูป — ตัวสำรองของการจับคู่ด้วยเลขมิเตอร์
   *
   * หลังบ้านจับคู่จากเลขมิเตอร์ซึ่งแม่นกว่า จึงไม่ทับของที่หลังบ้านเสนอมาแล้ว
   * แต่ตอนที่ยังไม่ได้กดอ่านเลข หรือหลังบ้านอ่านไม่ออก พิกัดในรูปคือข้อมูลเดียวที่เหลือ
   *
   * ⚠️ GPS มือถือคลาดเคลื่อน 5–20 ม. ส่วนบ้านห่างกัน 8–20 ม. — จับคู่ได้แต่ห้ามเชื่อสนิท
   *    จึงตั้งเป็น "ควรตรวจก่อน" เสมอ ไม่ใช่ "มั่นใจสูง" และคนยังต้องกดออกบิลเองอยู่ดี
   */
  private matchByCoords(row: ScanRow): void {
    if (row.matchedBy === 'manual' || row.memberId || row.status === 'saved') return;
    if (row.latitude === null || row.longitude === null) return;

    const photo = { lat: row.latitude, lng: row.longitude };
    // ใช้เพดานเดียวกับที่ใช้ตัดสินว่าพิกัด "ค้าน" บ้านที่เลือก และช่วงห่างเดียวกับที่ใช้
    // ตัดสินว่ามีหลังอื่นใกล้พอ ๆ กัน — สองที่นี้ต้องขยับพร้อมกันเสมอ ไม่งั้นป้ายบนจอ
    // กับด่านออกบิลจะตอบคนละอย่างสำหรับรูปใบเดียวกัน
    const match = pickNearest(
      photo,
      this.matchableMembers,
      (member) => toCoords(member?.latitude, member?.longitude),
      { maxMeters: this.conflictMeters, minMargin: this.rivalMarginMeters }
    );

    // ═══ ห้ามให้พิกัดแตะบ้านในกลุ่มมิเตอร์ที่ติดกันเลย ═══
    //
    // มิเตอร์ในกลุ่มห่างกัน 30 ซม. ส่วนค่าที่วัดได้แกว่งเป็นเมตร "หลังที่ใกล้ที่สุด"
    // จึงเป็นผลของเสียงรบกวน ไม่ใช่ตำแหน่งจริง — เติมให้แล้วคนจะกดยืนยันตาม เพราะมัน
    // มาพร้อมตัวเลขเป็นเมตรที่ดูน่าเชื่อถือ ทั้งที่วัดใหม่อีกรอบอาจได้อีกหลังหนึ่ง
    //
    // ต้องดักก่อนสาขา ambiguous ด้วย ไม่งั้นทุกใบของกำแพงนี้จะถูกส่งเข้า reportAmbiguous
    // ซึ่งแนะนำให้ "ไปวัดพิกัดสองหลังนี้ใหม่" — คำแนะนำที่ทำตามแล้วก็ไม่มีอะไรดีขึ้น
    // เพราะปัญหาไม่ได้อยู่ที่ค่าที่จดไว้ แต่อยู่ที่เพดานความละเอียดของ GPS เอง
    if (match.kind !== 'none' && this.clusterMembers(match.item).length) {
      row.matchConfidence = 'ambiguous';
      row.matchReason =
        `พิกัดในรูปตกอยู่ในกลุ่มมิเตอร์ที่ติดกัน (${match.item.cluster_group_id}) ` +
        'ซึ่งแต่ละตัวห่างกันราว 30 ซม. — พิกัดแยกไม่ได้ กรุณาเลือกบ้านตามลำดับตำแหน่งซ้าย→ขวาครับ';
      return;
    }

    // มีบ้านใกล้ ๆ อยู่หลายหลังจนชี้ขาดไม่ได้ — บอกให้รู้ว่าลังเลระหว่างหลังไหน
    // ห้ามหยิบ match.item มาเติมให้เด็ดขาด ตัวมันคือ "หลังที่ใกล้กว่าอีกไม่กี่เมตร"
    // ซึ่งเป็นระยะที่ GPS เพี้ยนได้อยู่แล้ว การเติมให้เท่ากับเดาแล้วให้คนเซ็นรับรอง
    if (match.kind === 'ambiguous') {
      row.matchConfidence = 'ambiguous';
      row.matchReason =
        `พิกัดในรูปอยู่ระหว่างบ้าน ${match.item.house_no} (ห่าง ${Math.round(match.meters)} ม.) ` +
        `กับ ${match.rival.house_no} (ห่าง ${Math.round(match.rivalMeters)} ม.) ` +
        `ต่างกันแค่ ${Math.round(match.rivalMeters - match.meters)} ม. ` +
        'ซึ่งน้อยกว่าที่ GPS มือถือเพี้ยนได้ — ดูรูปแล้วเลือกเองครับ';

      this.reportAmbiguous(row, photo, match.item, match.meters, match.rival, match.rivalMeters);
      return;
    }

    if (match.kind === 'none') return;

    row.memberId = match.item.id;
    row.matchedBy = 'system';
    row.matchedByCoords = true;
    row.matchConfidence = 'medium';
    row.matchReason =
      `จับคู่จากพิกัดในรูป — ห่างจากมิเตอร์ของบ้านเลขที่ ${match.item.house_no} ` +
      `ประมาณ ${Math.round(match.meters)} เมตร กรุณาเทียบกับรูปอีกครั้งครับ`;
  }

  /**
   * รูปที่ระบบชี้ขาดไม่ได้ ปล่อยลง terminal ใบละครั้ง
   *
   * matchByCoords ถูกไล่ซ้ำทั้งกองหลายรอบ (รายชื่อบ้านมาถึง · เลือกรูปเพิ่ม · หลังบ้านตอบ)
   * ถ้าไม่กันไว้ กองละ 30 รูปจะได้ log เป็นร้อยบรรทัดจนอ่านไม่ออกว่าจุดไหนซ้ำจริง
   */
  private readonly loggedAmbiguous = new Set<string>();

  private reportAmbiguous(
    row: ScanRow,
    photo: LatLng,
    nearest: any,
    meters: number,
    rival: any,
    rivalMeters: number
  ): void {
    if (this.loggedAmbiguous.has(row.fileKey)) return;
    this.loggedAmbiguous.add(row.fileKey);

    logAmbiguousMatch({
      source: 'batch-scan',
      photo,
      nearest: { houseNo: nearest?.house_no, meters },
      rival: { houseNo: rival?.house_no, meters: rivalMeters }
    });
  }

  // ==========================================
  // พิกัดบ้านที่เสีย — ต้นเหตุที่รูปกับบ้าน "พิกัดไม่ตรงกัน" สักที
  // ==========================================

  /**
   * ใจกลางหมู่บ้าน คิดจากพิกัดของบ้านทุกหลัง (ค่ากลาง ไม่ใช่ค่าเฉลี่ย — ดู medianCoords)
   * ต่ำกว่า 3 หลังยังบอกไม่ได้ว่าหลังไหนคือตัวประหลาด
   */
  private get villageCenter(): LatLng | null {
    const points = this.members
      .map((m) => toCoords(m?.latitude, m?.longitude))
      .filter((p): p is LatLng => p !== null);

    return points.length >= 3 ? medianCoords(points) : null;
  }

  /**
   * ใจกลางของกองรูปที่กำลังอ่าน — มีไว้ให้แถบเทียบตำแหน่งเครื่องวาดอย่างเดียว
   *
   * ต่างจาก villageCenter ตรงที่คิดจากพิกัดในรูป ไม่ใช่พิกัดในทะเบียน จึงตอบได้ว่า
   * "กองนี้ถ่ายมาจากแถวไหน" ไม่ใช่ "หมู่บ้านอยู่ตรงไหน" — คนละคำถามกัน
   *
   * ⚠️ ห้ามเอาไปใช้ในด่านของ autoSavable() ทุกกรณี ค่านี้ขยับตามรูปที่เลือกมาในกอง
   *    ใบที่ผ่านด่านวันนี้กับพรุ่งนี้จะไม่เหมือนกันทั้งที่รูปใบเดิม
   */
  get batchCenter(): LatLng | null {
    const points = this.rows
      .map((row) => toCoords(row.latitude, row.longitude))
      .filter((p): p is LatLng => p !== null);

    return medianCoords(points);
  }

  readonly photoCoordsHint = PHOTO_COORDS_HINT;

  /**
   * รูปในกองที่ไม่มีพิกัดติดมา — ขึ้นคำอธิบายรวมครั้งเดียว ไม่ใช่ต่อท้ายทุกแถว
   *
   * ทั้งกองมักพลาดด้วยเหตุเดียวกัน (เลือกผ่านคลังภาพของ Android ซึ่งตัดพิกัดออกให้เอง)
   * เขียนซ้ำ 30 แถวก็ไม่ได้ช่วยให้แก้ถูกขึ้น มีแต่ดันแถวที่ต้องตรวจจริงตกจอ
   */
  get rowsMissingCoords(): number {
    return this.rows.filter((row) => row.latitude === null || row.longitude === null).length;
  }

  /** พิกัดที่บ้านหลังนี้เก็บไว้ใช้ไม่ได้ — ไม่มี หรืออยู่ไกลจากหมู่บ้านคนละเรื่อง */
  private isMemberCoordsBroken(member: any): boolean {
    const coords = toCoords(member?.latitude, member?.longitude);
    if (!coords) return true;

    return isFarFrom(this.villageCenter, coords);
  }

  /** บ้านหลังนี้พิกัดเสีย และรูปใบนี้มีพิกัดที่เอาไปแก้ได้ */
  needsCoordsRepair(row: ScanRow): boolean {
    if (row.latitude === null || row.longitude === null) return false;
    // จับคู่ด้วยพิกัดมาเอง แล้วจะเอาพิกัดไปเทียบกับพิกัดไม่ได้ วนเป็นงูกินหาง
    if (row.matchedBy === 'none' || row.matchedByCoords) return false;

    const member = this.members.find((m) => m.id === Number(row.memberId));
    return !!member && this.isMemberCoordsBroken(member);
  }

  /**
   * บอกว่าบ้านหลังนี้พิกัดไม่ตรงกับรูป — รายงานอย่างเดียว ไม่เขียนทับให้เอง
   *
   * ปัญหาต้นทางคือบ้านจำนวนหนึ่งถูกลงทะเบียนตอนที่ระบบยังยอมรับพิกัดที่เครื่องเดาจากเน็ต
   * (คลาดเคลื่อนหลักสิบกิโล) รูปที่ถ่ายหน้ามิเตอร์จึงไม่มีทางตรงกับค่านั้นได้เลย
   *
   * ของเดิมหน้านี้ทับให้เงียบ ๆ หลังออกบิลผ่าน แต่การแก้ทะเบียนโดยไม่มีใครสั่งและ
   * ไม่มีใครเห็น ทำให้ตอนจับคู่ผิดหลัง (รูปถ่ายจากหน้าบ้านอื่น) พิกัดที่ถูกอยู่แล้วหายไป
   * โดยไม่เหลือร่องรอย — ตอนนี้จึงปล่อยเป็นบรรทัดรายงานลง terminal แล้วให้คนไปกดแก้
   * ที่หน้าทะเบียนลูกบ้าน ซึ่งมีทั้งปุ่มเติมพิกัดจากรูปและปุ่มยกพิกัดจากครั้งที่จดอยู่แล้ว
   */
  private reportCoordsMismatch(row: ScanRow): void {
    if (!this.needsCoordsRepair(row)) return;

    const member = this.members.find((m) => m.id === Number(row.memberId));
    if (!member) return;

    logCoordsMismatch({
      source: 'batch-scan',
      houseNo: member.house_no,
      memberId: member.id,
      saved: toCoords(member.latitude, member.longitude),
      photo: { lat: row.latitude!, lng: row.longitude! }
    });
  }

  /** บ้านที่เอามาจับคู่ได้ — ถ้าเลือกหมู่บ้านไว้ก็ตัดบ้านต่างหมู่บ้านออก ลดโอกาสจับผิด */
  private get matchableMembers(): any[] {
    if (!this.villagesId) return this.members;

    return this.members.filter((member) => {
      const villageId = member?.villages_id ?? member?.villages?.id ?? member?.village?.id;
      // บ้านที่ไม่ได้บอกหมู่บ้านมาต้องไม่ถูกตัดทิ้ง ไม่งั้นจะจับคู่ไม่ได้ทั้งที่มีพิกัดครบ
      return villageId == null || Number(villageId) === Number(this.villagesId);
    });
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
    // บ้านที่แถวนี้เพิ่งเลือก/เพิ่งปล่อย ไปเปลี่ยนตัวเลือกที่เหลือของแถวอื่นทั้งกอง
    this.refreshAllNearby();
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

    // กดเองทันก่อน → ทิ้งรอบที่ตั้งเวลาไว้ ไม่งั้นพอครบเวลาจะยิงซ้ำให้อีกกอง
    if (this.autoAnalyzeTimer) {
      clearTimeout(this.autoAnalyzeTimer);
      this.autoAnalyzeTimer = null;
    }

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

        // อ่านเลขเสร็จ → ยิงใบที่พิกัดตรงแปะเลย ที่เหลือค่อยขึ้นกล่องถาม
        this.runAfterAnalyze();
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

      // เก็บเลข/จำนวนหลัก/ความมั่นใจที่ AI อ่านมาไว้ก่อนที่ช่องกรอกจะถูกคนแก้
      // (ดู digitsToSend / confidenceToSend)
      row.ocrUnit = row.unit;
      row.ocrConfidence = this.toRawConfidence(result?.reading?.confidence);
      const digits = Number(result?.reading?.meter_digits);
      row.meterDigits = Number.isInteger(digits) && digits > 0 ? digits : null;
      row.matchConfidence = result?.confidence ?? 'none';
      row.matchReason = result?.reason ?? null;
      row.warnings = Array.isArray(result?.warnings) ? result.warnings : [];
      row.candidates = Array.isArray(result?.candidates) ? result.candidates : [];

      /**
       * ข้อมูลติดรูป — เขียนทับเฉพาะตอนที่รอบนี้อ่านได้จริง
       *
       * รูปที่ครอปแล้วส่งกลับมาอ่านใหม่ไม่มี EXIF เหลือให้หลังบ้านอ่าน (canvas เก็บแต่พิกเซล)
       * ถ้าล้างทิ้งทุกครั้ง วันถ่ายกับพิกัดที่ได้มาตอนอ่านรูปเต็มใบจะหายไป แล้วบิลจะไปลง
       * วันที่กดบันทึกแทนวันที่ไปจดจริง
       *
       * พิกัดต้องผ่าน toCoords ก่อนเสมอ — หลังบ้านส่ง null มาได้ และ Number(null) คือ 0
       * ซึ่งเป็นพิกัดกลางมหาสมุทรที่จะถูกส่งขึ้นไปเป็น "จุดที่ยืนถ่าย" ของบ้านหลังนั้น
       */
      const taken = result?.photo_taken;
      const captured = taken?.captured_at ? new Date(taken.captured_at) : null;
      if (captured && !isNaN(captured.getTime())) row.capturedAt = captured;

      const coords = toCoords(taken?.latitude, taken?.longitude);
      if (coords) {
        row.latitude = coords.lat;
        row.longitude = coords.lng;
        // พิกัดเปลี่ยน = บ้านที่อยู่ใกล้จุดถ่ายก็เปลี่ยนตาม
        this.refreshNearby(row);
      }

      // คนแก้บ้านเองไว้แล้วต้องไม่ให้ผลจากหลังบ้านทับ
      if (row.matchedBy !== 'manual') {
        const suggested = result?.suggestion?.members_id ?? null;
        row.memberId = suggested;
        row.matchedBy = suggested ? 'system' : 'none';
        // มาจากเลขมิเตอร์ ไม่ใช่จากพิกัด — พิกัดในรูปจึงเอาไปซ่อมพิกัดบ้านหลังนี้ได้
        row.matchedByCoords = false;

        // หลังบ้านจับคู่จากเลขมิเตอร์ไม่ได้ → ยังเหลือพิกัดในรูปให้ลองอีกทาง
        if (!suggested) this.matchByCoords(row);
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

  /**
   * ความมั่นใจแบบ 0–1 ตามที่หลังบ้านใช้จริง (ตัดที่ 0.85 แล้วเก็บเป็นทศนิยม 3 ตำแหน่ง)
   *
   * ห้ามส่ง toPercent() ขึ้นไปแทน — 92% จะกลายเป็น 92 ซึ่งผ่านด่านทุกใบ
   * ส่วนการปัดเศษของ toPercent ก็ทำให้ 0.849 กับ 0.854 กลายเป็นเลขเดียวกันคนละฝั่งเส้น
   */
  private toRawConfidence(raw: unknown): number | null {
    const value = typeof raw === 'string' ? parseFloat(raw) : raw;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;

    return Math.min(1, value > 1 ? value / 100 : value);
  }

  // ==========================================
  // ครอปเฉพาะช่องตัวเลขแล้วอ่านใหม่ทีละรูป
  // ==========================================

  /**
   * โหมดกองส่งรูป "เต็มใบ" ไปให้ AI ซึ่งต้องหาหน้าปัดในภาพเองก่อนถึงจะอ่านเลขได้
   * รูปที่ถ่ายไกล ถ่ายเอียง หรือมีของอื่นในเฟรมจึงพลาดง่ายกว่าโหมดทีละหลังที่คน
   * ครอบกรอบให้ตั้งแต่แรก — ปุ่มนี้คือทางกลับไปใช้วิธีที่แม่นกว่า เฉพาะใบที่อ่านมาไม่ดี
   */
  cropRow: ScanRow | null = null;
  cropBlob: Blob | null = null;
  cropTransform: ImageTransform = {};
  isRereading = false;
  private cropRotation = 0;

  /** ควรชวนให้ครอปอ่านใหม่ไหม — อ่านไม่ออก หรืออ่านออกแบบไม่ค่อยมั่นใจ */
  shouldReread(row: ScanRow): boolean {
    if (row.status === 'saved' || !row.file) return false;
    if (row.status === 'read_failed') return true;
    return row.confidence !== null && row.confidence < 85;
  }

  openCrop(row: ScanRow): void {
    // แถวที่กู้มาจากคิวเก่าไม่มีตัวรูปแล้ว ครอปไม่ได้
    if (this.isBusy || !row.file) return;
    this.cropRow = row;
    this.cropBlob = null;
    this.cropRotation = 0;
    this.cropTransform = {};
  }

  closeCrop(): void {
    if (this.isRereading) return;
    this.cropRow = null;
    this.cropBlob = null;
  }

  onCropped(event: any): void {
    this.cropBlob = event?.blob ?? null;
  }

  rotateCrop(direction: -1 | 1): void {
    this.cropRotation += direction * 90;
    this.cropTransform = { ...this.cropTransform, rotate: this.cropRotation };
  }

  /**
   * ส่งเฉพาะกรอบที่ครอปกลับไปอ่านใหม่ผ่าน /bills/scan-batch เดิม (ส่งไปใบเดียว)
   *
   * ไม่ใช้ /meter-readings/ocr-upload ที่อ่านเลขอย่างเดียว เพราะการจับคู่บ้านคิดจาก
   * เลขมิเตอร์ พออ่านเลขได้ใหม่ บ้านที่เคยเสนอไว้จากเลขตัวเก่าก็ต้องคิดใหม่ทั้งชุด
   * ไม่งั้นจะได้เลขถูกแต่บ้านผิด ซึ่งมองไม่ออกด้วยตาเพราะทุกอย่างดูเรียบร้อยดี
   */
  rereadCropped(): void {
    const row = this.cropRow;
    if (!row || !this.cropBlob || this.isRereading) return;

    const billing = this.selectedBilling;
    const form = new FormData();
    form.append('files', this.cropBlob, row.fileName);
    form.append('billing_month', billing.month);
    form.append('billing_year', billing.year);
    if (this.villagesId) form.append('villages_id', String(this.villagesId));

    this.isRereading = true;
    this.cdr.detectChanges();

    const cropped = this.cropBlob;

    this.meterReadingService.scanBatch(form).subscribe({
      next: async (res: any) => {
        this.isRereading = false;

        const results = Array.isArray(res?.results) ? res.results : [];
        // อ่านรอบนี้ยังไม่ออก → ปล่อยแถวไว้ตามเดิม ผลเก่า (บ้านที่เคยจับคู่ได้) จะได้ไม่ถูกล้างทิ้ง
        // แล้วเปิดกล่องค้างไว้ให้ลากกรอบใหม่ต่อได้เลย
        if (this.toUnit(results[0]?.reading?.meter_unit) === null) {
          this.cdr.detectChanges();
          toast.error('ยังอ่านไม่ออกครับ ลองครอปให้เหลือเฉพาะแถวตัวเลขแล้วกดอ่านใหม่อีกครั้ง', { id: 'batch-reread' });
          return;
        }

        const before = row.unit;
        // ส่งไปใบเดียว ผลจึงต้องเป็นของแถวนี้เสมอ ไม่ต้องเชื่อ index ที่หลังบ้านคืนมา
        this.applyResults([row], [{ ...results[0], index: 0 }]);
        row.croppedRead = true;
        // เลขเปลี่ยนแล้ว คำยืนยันที่คนกดให้เลขตัวเก่า (หน่วยสูงผิดปกติ / จำนวนหลักเปลี่ยน /
        // อ่านไม่ชัด ฯลฯ) ใช้ต่อไม่ได้ ต้องปล่อยให้ด่านของหลังบ้านตรวจเลขใหม่อีกรอบ ไม่ใช่ข้ามไปเลย
        if (row.unit !== before) this.clearConfirms(row);
        this.cropRow = null;
        this.cropBlob = null;
        this.persist();
        this.cdr.detectChanges();

        toast.success(`อ่านใหม่ได้ ${row.unit} ครับ`, { id: 'batch-reread' });

        // เก็บกรอบที่ครอปเป็นรูปของแถวนี้แทนรูปเต็มใบ — เลขบนหน้าปัดชัดกว่ามากในงบไบต์เท่ากัน
        // และเป็นรูปเดียวกับที่ AI อ่านเลขนี้ออกมาจริง ๆ คนที่ย้อนมาตรวจจึงเห็นสิ่งที่ระบบเห็น
        //
        // พิกัดกับวันถ่ายอ่านจากไฟล์ต้นฉบับไปตั้งแต่ตอนเลือกรูปแล้ว (canvas ทิ้ง EXIF ทั้งก้อน)
        // การทับตรงนี้จึงไม่กระทบด่านไหนเลย
        const encoded = await this.photoDataUrl(cropped);
        if (encoded) {
          row.photoData = encoded;
          this.persist();
          this.cdr.detectChanges();
        }
      },
      error: (err) => {
        this.isRereading = false;
        console.error('อ่านรูปที่ครอปไม่สำเร็จ:', err);
        this.cdr.detectChanges();
        toast.error(extractErrorMessage(err, 'อ่านเลขไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), { id: 'batch-reread' });
      }
    });
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

  /** ข้อมูลของบ้านที่แถวนี้เลือกอยู่ เท่าที่หลังบ้านส่งมาตอนจับคู่ (ไม่เจอ = คนเลือกเอง) */
  private candidateOf(row: ScanRow): Candidate | null {
    if (!row.memberId) return null;
    return row.candidates.find((c) => Number(c.members_id) === Number(row.memberId)) ?? null;
  }

  /**
   * บ้านหลังนี้มีบิลของรอบนี้อยู่แล้ว — หลังบ้านจะตีกลับถ้าไม่ได้สั่งให้ทับ
   * รู้ตั้งแต่ตอนจับคู่แล้ว จึงบอกก่อนดีกว่าปล่อยให้ยิงไปโดนปฏิเสธทีละใบ
   */
  alreadyBilled(row: ScanRow): boolean {
    return !!this.candidateOf(row)?.already_billed;
  }

  /**
   * หน่วยน้ำรอบนี้พุ่งเกินที่บ้านหลังนี้เคยใช้มาก — เกณฑ์เดียวกับโหมดทีละหลัง
   * (เกิน 3 เท่าและต่างกันตั้งแต่ 30 หน่วย กันเตือนพร่ำเพรื่อกับบ้านที่ใช้น้ำน้อย ๆ)
   *
   * ส่วนใหญ่ไม่ใช่คนใช้น้ำเยอะจริง แต่เป็นอ่านเลขหลักเกิน หรือจับคู่ผิดบ้าน
   */
  abnormalUsage(row: ScanRow): { usage: number; average: number } | null {
    const candidate = this.candidateOf(row);
    const average = Number(candidate?.average_usage);
    const usage = Number(this.liveUsage(row) ?? candidate?.usage_unit);
    if (!Number.isFinite(average) || !Number.isFinite(usage) || average <= 0) return null;

    return usage > average * 3 && usage - average >= 30 ? { usage, average } : null;
  }

  // ==========================================
  // เทียบกับเลขเดือนที่แล้ว — ด่านที่ทำงานแทน GPS ตอนมิเตอร์ติดกันเป็นแถว
  // ==========================================

  /**
   * เลขตั้งต้นของบ้านที่แถวนี้เลือกอยู่ (หลังบ้านส่งมาพร้อมตัวเลือกบ้านตอนจับคู่)
   *
   * มิเตอร์ทาวน์โฮมห่างกัน 30 ซม. — GPS ที่คลาดเคลื่อน 5–20 ม. ชี้ขาดไม่ได้แน่นอน
   * แต่ **เลขสะสมของแต่ละหลังต่างกันมาก** เลขเดือนที่แล้วจึงเป็นสิ่งเดียวที่เจ้าหน้าที่
   * กวาดตาเทียบกับหน้าปัดตรงหน้าแล้วรู้ทันทีว่ากำลังจดมิเตอร์ของบ้านหลังไหนอยู่
   */
  previousUnit(row: ScanRow): number | null {
    const raw = this.candidateOf(row)?.previous_unit;
    // Number(null) = 0 — ต้องกันก่อน ไม่งั้น "หลังบ้านไม่ได้ส่งเลขตั้งต้นมา" จะกลายเป็น
    // "เลขตั้งต้น 0" แล้วหน่วยของรอบนี้พุ่งเท่ากับเลขสะสมทั้งก้อน
    // (ส่วน 0 จริง ๆ มีได้ คือบ้านที่เพิ่งลงทะเบียนแล้วยังไม่เคยจด จึงต้องแยกจาก null)
    if (raw === null || raw === undefined || raw === ('' as unknown)) return null;

    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  /**
   * หน่วยน้ำจาก **เลขที่กรอกอยู่ตอนนี้**
   *
   * ไม่ใช้ `candidate.usage_unit` ตรง ๆ เพราะค่านั้นหลังบ้านคิดจากเลขที่ AI อ่านมาตอนจับคู่
   * พอคนแก้เลขในช่อง หรือกดครอปแล้วอ่านใหม่ ค่าเดิมก็ค้างอยู่ที่เลขตัวเก่าทันที
   */
  liveUsage(row: ScanRow): number | null {
    const previous = this.previousUnit(row);
    const unit = Number(row.unit);
    if (previous === null || !Number.isFinite(unit)) return null;

    return unit - previous;
  }

  /**
   * ผลตรวจเลขที่กรอก เทียบกับเลขเดือนที่แล้วของบ้านที่เลือกอยู่
   *
   *  - `error` เลขน้อยกว่าเลขตั้งต้น = มิเตอร์เดินถอยหลัง ซึ่งไม่เกิดขึ้นจริง
   *    เกือบทุกครั้งคือไปอ่านหน้าปัดของหลังข้าง ๆ ที่เลขน้อยกว่ามา (หลังบ้านบล็อกอยู่แล้ว
   *    แต่รู้ตอนยิงคือสายไป — เจ้าหน้าที่เดินจากจุดนั้นไปแล้ว)
   *  - `warn` หน่วยพุ่งเกิน 1.5 เท่าของค่าเฉลี่ย = สัญญาณเดียวกันในทางกลับกัน
   *    (ไปอ่านหน้าปัดหลังข้าง ๆ ที่เลขเยอะกว่า) แต่ยังเป็นการใช้น้ำจริงได้ จึงแค่เตือน
   *
   * เกิน 3 เท่าปล่อยให้เป็นหน้าที่ของ abnormalUsage() ต่อ — ข้อความแรงกว่าและกัน
   * การออกบิลอัตโนมัติด้วย ตรงนี้จึงหยุดที่ 3 เท่าเพื่อไม่ให้ขึ้นซ้อนกันสองข้อความ
   */
  unitCheck(row: ScanRow): { level: 'error' | 'warn'; message: string } | null {
    const previous = this.previousUnit(row);
    const usage = this.liveUsage(row);
    if (previous === null || usage === null) return null;

    if (usage < 0) {
      return {
        level: 'error',
        message: `เลขนี้น้อยกว่าเลขเดือนที่แล้วของบ้านหลังนี้ (${previous}) มิเตอร์ไม่เดินถอยหลัง — ` +
          'ตรวจว่าอ่านหน้าปัดของหลังข้าง ๆ มาหรือเปล่าครับ'
      };
    }

    const average = Number(this.candidateOf(row)?.average_usage);
    if (!Number.isFinite(average) || average <= 0) return null;

    // บ้านที่ใช้น้ำน้อยมาก (เฉลี่ย 4 หน่วย) ขยับนิดเดียวก็เกิน 1.5 เท่าแล้ว
    // ต้องต่างกันพอสมควรด้วยถึงจะเตือน ไม่งั้นเตือนแทบทุกแถวจนคนเลิกอ่าน
    const overshoot = usage > average * 1.5 && usage - average >= 10;
    if (!overshoot || usage > average * 3) return null;

    return {
      level: 'warn',
      message: `รอบนี้ใช้ ${usage} หน่วย มากกว่าที่บ้านหลังนี้เคยใช้ (เฉลี่ย ${Math.round(average)}) ` +
        'เทียบเลขกับหน้าปัดอีกครั้งก่อนออกบิลครับ'
    };
  }

  // ==========================================
  // เปลี่ยนมิเตอร์ใหม่ — ทางเดียวที่เลขต่ำกว่าเดือนก่อนแล้วยังออกบิลได้
  // ==========================================

  /**
   * แถวนี้ติดด่าน "เลขน้อยกว่าเลขตั้งต้น" อยู่ และยังไม่มีใครยืนยัน
   *
   * เกือบทุกครั้งคือไปอ่านหน้าปัดของหลังข้าง ๆ มา — แต่ "เปลี่ยนมิเตอร์ใหม่" ก็ให้เลขแบบนี้
   * เหมือนกัน ถ้าไม่มีทางยืนยัน บ้านที่เพิ่งเปลี่ยนมิเตอร์จะออกบิลจากหน้านี้ไม่ได้เลยทั้งรอบ
   *
   * รับทั้งด่านที่ตรวจในหน้าเว็บ (unitCheck) และที่ตีกลับมาตอนถามเลขตั้งต้นก่อนยิง (saveNext)
   */
  meterResetPending(row: ScanRow): boolean {
    if (row.status === 'saved' || row.confirmMeterReset) return false;
    if (this.unitCheck(row)?.level === 'error') return true;

    return row.errorCode === 'UNIT_BELOW_PREVIOUS' || /น้อยกว่าเลขตั้งต้น/.test(row.error ?? '');
  }

  /**
   * กรอกเลขปิดของมิเตอร์เก่าครบและสมเหตุสมผลแล้วหรือยัง
   *
   * เลขปิดต้องไม่ต่ำกว่าเลขตั้งต้น (มิเตอร์ตัวเก่าเดินต่อจากรอบที่แล้วมาจนถึงวันถอด)
   * ต่ำกว่านั้นแปลว่ากรอกมั่วหรือหยิบเลขผิดตัว ซึ่งจะทำให้หน่วยของรอบนี้ติดลบต่อไปอีก
   */
  meterResetReady(row: ScanRow): boolean {
    const final = Number(row.oldMeterFinalUnit);
    if (!Number.isFinite(final) || final < 0) return false;

    const previous = this.previousUnit(row);
    return previous === null || final >= previous;
  }

  /** ยืนยันว่าเปลี่ยนมิเตอร์ใหม่จริง — ธงกับเลขปิดจะถูกส่งไปด้วยกันตอนกดออกบิล */
  confirmMeterReset(row: ScanRow): void {
    if (this.isBusy || !this.meterResetReady(row)) return;

    row.confirmMeterReset = true;
    row.oldMeterFinalUnit = Number(row.oldMeterFinalUnit);
    row.error = null;
    row.errorCode = null;
    if (row.status === 'save_failed') row.status = 'ready';
    this.persist();
  }

  blockingIssue(row: ScanRow): string | null {
    if (row.status === 'saved') return null;
    if (!row.memberId) return 'ยังไม่รู้ว่าเป็นบ้านหลังไหน กรุณาเลือกเองครับ';
    if (row.unit === null) return 'ยังไม่มีเลขมิเตอร์ กรุณากรอกเองครับ';
    if (row.unit < 0) return 'เลขมิเตอร์ติดลบไม่ได้ครับ';
    // เลขน้อยกว่าเลขเดือนที่แล้ว — หลังบ้านตีกลับอยู่แล้วตอนยิง (ดู saveNext) กันตั้งแต่ตรงนี้
    // เพื่อให้เห็นตอนยังยืนอยู่หน้ามิเตอร์ ไม่ใช่ตอนกดออกบิลทั้งกองแล้วเดินกลับมาไม่ได้
    const check = this.unitCheck(row);
    if (check?.level === 'error' && !row.confirmMeterReset) return check.message;
    if (this.isDuplicate(row)) return 'ซ้ำกับอีกรูปที่เป็นบ้านเดียวกันครับ';
    // มิเตอร์ที่ติดกันเป็นกลุ่ม: ออกบิลข้ามลำดับ = ไม่มีอะไรยืนยันได้เลยว่าเลขนี้มาจากตัวไหน
    // (พิกัดใช้ไม่ได้ในระยะ 30 ซม. — ดู clusterLockMessage) จึงต้องกันตั้งแต่ก่อนยิง
    const clusterLock = this.clusterLockMessage(this.memberById(row.memberId));
    if (clusterLock) return clusterLock;
    // กรอกเลขเองแล้วไม่มีรูป = ไม่เหลืออะไรให้ตรวจย้อนหลังเลยแม้แต่ชิ้นเดียว
    // หลังบ้านบล็อกตายอยู่แล้ว (ไม่มีปุ่มยืนยันให้กด) กันตั้งแต่ตรงนี้ดีกว่าปล่อยให้
    // ยิงไปทั้งคิวแล้วตกกลับมาทีละใบพร้อมข้อความที่คนอ่านตอนนั้นแก้อะไรไม่ได้แล้ว
    //
    // ⚠️ ยกเว้นแถวสถานะ 'unknown' (ค้างตอนกำลังยิงรอบก่อน — ไฟดับ/เน็ตหลุด)
    //    แถวพวกนี้ยังไม่รู้ว่าบิลออกไปแล้วหรือยัง และ client_uuid ทำให้การกดซ้ำ
    //    ให้คำตอบนั้นพอดี: เคยออกแล้วจะได้บิลใบเดิมกลับมา ไม่เคยออกจะโดนหลังบ้าน
    //    ตีกลับ ซึ่งคือสิ่งที่คนกดอยากรู้ การบล็อกไว้เฉย ๆ ทำให้ไม่มีทางรู้เลย
    if (row.status !== 'unknown' && this.entryMethod(row) !== 'ocr' && !row.photoData) {
      return 'เลขนี้กรอกเอง จึงต้องมีรูปหน้าปัดแนบไปด้วยเสมอ — แถวนี้ไม่มีรูปแล้วครับ กรุณาถ่ายใหม่';
    }
    // เวลาถ่ายเป็นอนาคตแปลว่านาฬิกาของเครื่องที่ถ่ายตั้งไม่ตรง หลังบ้านบล็อกตาย
    // เผื่อ 5 นาทีเท่ากัน เพราะนาฬิกามือถือกับ server คลาดกันเป็นวินาทีเป็นปกติ
    if (row.capturedAt && row.capturedAt.getTime() > Date.now() + 5 * 60 * 1000) {
      return 'เวลาถ่ายของรูปนี้เป็นเวลาในอนาคต กรุณาตั้งนาฬิกาของเครื่องที่ถ่ายให้ตรงแล้วถ่ายใหม่ครับ';
    }
    if (!this.replaceExisting && this.alreadyBilled(row)) {
      return 'บ้านหลังนี้มีบิลของรอบนี้อยู่แล้ว ถ้าจะออกใหม่ให้ติ๊ก "ลบใบเดิมแล้วออกใหม่" ด้านล่างครับ';
    }
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
    if (row.croppedRead) notes.push('เลขนี้มาจากการครอปเฉพาะช่องตัวเลขแล้วอ่านใหม่');
    if (row.confirmMeterReset) {
      notes.push(
        `ยืนยันแล้วว่าเปลี่ยนมิเตอร์ใหม่ เลขปิดของตัวเก่าคือ ${row.oldMeterFinalUnit} — ` +
          'ใบนี้ระบบจะไม่ออกบิลให้เอง ต้องกดออกบิลเองครับ'
      );
    }

    // วันถ่ายผิดรอบ = ไม่ใช่แค่วันบนบิลเพี้ยน แต่หน่วยน้ำของรอบถัดไปจะเพี้ยนตามไปด้วย
    // เพราะรอบถัดไปนับจากวันจดครั้งนี้ และรูปหลงกองมามักแปลว่าหยิบรูปเก่ามาผิดใบ
    if (this.isOutsideBillingMonth(row)) {
      notes.push(
        `รูปนี้ถ่ายรอบ ${this.suggestedBillingLabel(row)} ซึ่งคนละเดือนกับรอบบิลที่เลือกไว้ ` +
          'ถ้าตั้งใจออกย้อนหลังก็ผ่านได้ แต่ระบบจะไม่ออกบิลให้เองใบนี้ครับ'
      );
    }
    if (row.capturedAt && row.capturedAt.getTime() > Date.now()) {
      notes.push('วันถ่ายในรูปเป็นวันในอนาคต — นาฬิกาในกล้องน่าจะตั้งไม่ตรง');
    }

    // หน่วยพุ่งแรงมักไม่ใช่คนใช้น้ำเยอะ แต่เป็นอ่านหลักเกินหรือจับคู่ผิดบ้าน
    // ต้องเห็นก่อนกดออกบิล ไม่ใช่ไปรู้ตอนโดนหลังบ้านตีกลับทีละใบ
    const jump = this.abnormalUsage(row);
    if (jump) {
      notes.push(
        `หน่วยรอบนี้ ${jump.usage} สูงกว่าที่บ้านหลังนี้เคยใช้ (เฉลี่ย ${Math.round(jump.average)}) มาก ` +
          'เทียบเลขกับหน้าปัดอีกครั้งก่อนออกบิลครับ'
      );
    }
    if (this.replaceExisting && this.alreadyBilled(row)) {
      notes.push('บ้านหลังนี้มีบิลของรอบนี้อยู่แล้ว ใบเดิมจะถูกลบทิ้งแล้วออกใหม่');
    }

    // ไม่มีรูปแล้วห้ามพูดถึงเปอร์เซ็นต์ที่ AI เคยอ่านได้เลย (ดู showConfidence)
    if (this.showConfidence(row) && (row.confidence ?? 100) < 85) {
      notes.push(`AI อ่านได้ไม่ค่อยชัด (${row.confidence}%) ครอปเฉพาะช่องตัวเลขแล้วอ่านใหม่จะแม่นขึ้นครับ`);
    }
    return notes;
  }

  /**
   * ระยะจากจุดที่ถ่ายรูป ถึงมิเตอร์ของบ้านที่แถวนี้เลือกอยู่ — null เมื่อฝั่งใดไม่มีพิกัด
   * เป็นตัวชี้ขาดของการออกบิลอัตโนมัติ และเป็นตัวเตือนเวลาเลือกบ้านไกลจากจุดถ่าย
   */
  distanceToSelected(row: ScanRow): number | null {
    if (row.latitude === null || row.longitude === null || !row.memberId) return null;

    const member = this.members.find((m) => m.id === Number(row.memberId));
    const coords = toCoords(member?.latitude, member?.longitude);
    if (!coords) return null;

    return distanceMeters({ lat: row.latitude, lng: row.longitude }, coords);
  }

  /**
   * พิกัดในรูปยืนยันได้ว่าเป็นบ้านหลังที่เลือกจริง (ยืนถ่ายอยู่หน้ามิเตอร์ของหลังนั้น)
   *
   * ใกล้อย่างเดียวไม่พอ — บ้านที่มิเตอร์ติดกันเป็นแถว (ตึกแถว/บ้านแฝด) จะเข้าเกณฑ์ 25 ม.
   * พร้อมกันหลายหลัง แล้วระบบจะออกบิลให้เองโดยเลือกหลังที่ใกล้กว่าแค่ไม่กี่เมตร ซึ่งเป็น
   * ระยะที่ GPS มือถือเพี้ยนได้อยู่แล้ว ต้องทิ้งห่างหลังรองพอสมควรถึงจะเรียกว่ายืนยันได้
   */
  isConfirmedByCoords(row: ScanRow): boolean {
    const meters = this.distanceToSelected(row);
    return meters !== null && meters <= this.confirmMeters && !this.hasCloseRival(row);
  }

  // ==========================================
  // มิเตอร์ที่อยู่ใกล้กันจน GPS แยกบ้านไม่ออก
  // ==========================================

  /** ระยะที่หยิบบ้านมาเป็นตัวเลือกให้กด — กว้างกว่าระยะยืนยัน เพราะพิกัดที่จดไว้ก็เพี้ยนได้ */
  private readonly nearbyMeters = 60;

  /** ระยะที่หลังรองต้องห่างกว่าหลังที่เลือก ถึงจะถือว่า "คนละบ้านกันชัด ๆ" */
  private readonly rivalMarginMeters = 15;

  /** เลือกให้กดสูงสุด 3 หลัง — มากกว่านี้กลายเป็นลิสต์ที่ต้องอ่าน ซึ่ง dropdown ทำอยู่แล้ว */
  private readonly maxNearby = 3;

  /**
   * บ้านที่อยู่ใกล้จุดถ่ายรูปใบนี้ เรียงจากใกล้ไปไกล — คิดใหม่เมื่อพิกัด/รายชื่อบ้านเปลี่ยน
   * เก็บไว้ที่แถวแทนที่จะคำนวณสดใน template เพราะ getter ใน @for จะถูกเรียกซ้ำทุกรอบ
   * change detection คูณจำนวนบ้านทั้งหมู่บ้าน
   */
  private refreshNearby(row: ScanRow): void {
    if (row.latitude === null || row.longitude === null) {
      row.nearby = [];
      return;
    }

    const photo = { lat: row.latitude, lng: row.longitude };
    row.nearby = this.matchableMembers
      .map((member) => {
        const coords = toCoords(member?.latitude, member?.longitude);
        return coords
          ? {
              member,
              meters: distanceMeters(photo, coords),
              takenBySeq: this.takenBySeq(row, member?.id),
              previousUnit: this.cachedPreviousUnit(member?.id)
            }
          : null;
      })
      .filter((near): near is NearbyChoice => near !== null && near.meters <= this.nearbyMeters)
      .sort((a, b) => a.meters - b.meters)
      .slice(0, this.maxNearby);

    this.loadNearbyPreviousUnits(row);
  }

  /**
   * รูปใบอื่นในกองที่เลือกบ้านหลังนี้ไปแล้ว — คืนลำดับรูปนั้น ไม่มีก็ null
   *
   * มีไว้ตัดตัวเลือกที่กดไปก็ติด "ซ้ำในกอง" อยู่ดีออกจากสายตา ในแถวที่ GPS ชี้ขาดไม่ได้
   * ตัวเลือกมักเหลือหลังเดียวที่ยังว่าง คนจึงกดจบในครั้งเดียวแทนที่จะต้องไล่เทียบเอง
   *
   * ⚠️ เป็นแค่การช่วยจัดตัวเลือกบนจอ ห้ามเอาไปเติมบ้านให้แถวนี้เอง — เหตุผลที่ "เหลือ
   *    หลังเดียว" มาจากการที่แถวอื่นเลือกไว้แบบนั้น ถ้าแถวนั้นเลือกผิด แถวนี้จะผิดตาม
   *    เป็นลูกโซ่โดยไม่มีใครทักท้วง คนต้องเป็นคนกดยืนยันเสมอ
   */
  private takenBySeq(row: ScanRow, memberId: unknown): number | null {
    if (memberId === null || memberId === undefined) return null;

    const owner = this.rows.find(
      (other) => other !== row && other.status !== 'saved' && Number(other.memberId) === Number(memberId)
    );
    return owner ? owner.seq : null;
  }

  /**
   * นับตัวเลือกที่ยังกดได้จริงในแถวนี้ — ใช้เลือกข้อความอธิบายเหนือปุ่ม
   * คืนเป็นตัวเลขไม่ใช่ array เพราะถูกเรียกจาก template ทุกรอบ change detection
   * (array ก้อนใหม่ทุกรอบจะทำให้ @for วาดปุ่มใหม่ทั้งแถบโดยไม่จำเป็น)
   */
  freeNearbyCount(row: ScanRow): number {
    return row.nearby.reduce((total, near) => total + (near.takenBySeq === null ? 1 : 0), 0);
  }

  /** เรียกใหม่ทั้งกอง — ใช้ตอนรายชื่อบ้านมาถึงช้า หรือเปลี่ยนหมู่บ้านที่จับคู่ */
  refreshAllNearby(): void {
    this.rows.forEach((row) => this.refreshNearby(row));
  }

  // ==========================================
  // แถวที่ไม่มีรูปแล้ว — เลขเดือนที่แล้วมาแทนสายตา
  // ==========================================

  /**
   * แถวนี้ยังมีรูปอยู่ไหม — ทั้งไฟล์ต้นฉบับ (ไว้ให้คนดู/ครอปอ่านใหม่) และรูปย่อที่จะแนบไปกับบิล
   * คิวที่กู้มาจากเครื่องไม่มีทั้งสองอย่าง (รูปก้อนใหญ่เกินโควตา localStorage จึงไม่ได้ถูกเก็บ)
   */
  hasPhoto(row: ScanRow): boolean {
    return row.file !== null || row.photoData !== null;
  }

  /**
   * โชว์เปอร์เซ็นต์ที่ AI อ่านได้หรือไม่
   *
   * ไม่มีรูปแล้ว = เปอร์เซ็นต์นั้นยืนยันอะไรไม่ได้อีก ไม่มีอะไรให้คนเอาไปเทียบสักอย่าง
   * เห็นแล้วเข้าใจผิดว่า "เลขในช่องมาจากการอ่านรูป" ทั้งที่มันคือเลขที่กรอกเอง
   */
  showConfidence(row: ScanRow): boolean {
    return row.confidence !== null && this.hasPhoto(row);
  }

  /** AI อ่านมาไม่ชัดจนต้องเตือน — เตือนอย่างเดียว ยังแก้เลขแล้วกดออกบิลเองได้ */
  lowConfidenceWarning(row: ScanRow): boolean {
    return this.showConfidence(row) && row.status !== 'saved' && (row.confidence ?? 100) < this.weakConfidence;
  }

  /**
   * แถวนี้ออกบิลไม่ได้จนกว่าจะมีรูปใหม่ — เลขไม่ได้มาจาก AI และไม่มีรูปเหลือให้ตรวจย้อนหลัง
   * ต้องคู่กับด่านเดียวกันใน blockingIssue() เสมอ ไม่งั้นปุ่มถ่ายใหม่จะไปโผล่คนละใบกับที่ติดด่าน
   */
  needsRetake(row: ScanRow): boolean {
    if (row.status === 'saved' || row.status === 'unknown') return false;

    return !this.hasPhoto(row) && this.entryMethod(row) !== 'ocr';
  }

  /**
   * เลขเดือนที่แล้วของบ้านใกล้เคียง คีย์ด้วย `บ้าน|รอบบิล` เพราะคนละรอบคือคนละเลข
   * เก็บที่ระดับหน้า ไม่ใช่ที่แถว — รูปหลายใบในกองมักเสนอบ้านหลังเดียวกัน
   */
  private previousUnitCache = new Map<string, number | null>();
  private previousUnitInFlight = new Set<string>();

  private previousUnitKey(memberId: unknown): string {
    return `${Number(memberId)}|${this.billingKey}`;
  }

  private cachedPreviousUnit(memberId: unknown): number | null {
    return this.previousUnitCache.get(this.previousUnitKey(memberId)) ?? null;
  }

  /**
   * ดึงเลขเดือนที่แล้วของทุกบ้านที่ยกมาเป็นตัวเลือกในแถวนี้ — เฉพาะแถวที่ไม่มีรูปแล้ว
   *
   * มิเตอร์ทาวน์โฮมห่างกัน 30 ซม. ปุ่มจึงบอกได้แค่ "ห่าง 0 ม." เท่ากันทุกหลัง และไม่มีรูปให้เทียบ
   * ด้วย เหลือทางเดียวที่คนตัดสินได้จริงคือเทียบเลขสะสมของแต่ละหลังกับเลขที่กรอกไว้ในช่อง
   *
   * ล้มแล้วเงียบไว้ — เป็นตัวช่วยตัดสิน ไม่ใช่ข้อมูลที่ขาดแล้วออกบิลไม่ได้
   */
  private loadNearbyPreviousUnits(row: ScanRow): void {
    if (!this.isBrowser || this.hasPhoto(row) || !row.nearby.length) return;

    const billing = this.selectedBilling;
    for (const near of row.nearby) {
      const memberId = Number(near.member?.id);
      if (!Number.isFinite(memberId)) continue;

      const key = this.previousUnitKey(memberId);
      if (this.previousUnitCache.has(key) || this.previousUnitInFlight.has(key)) continue;

      this.previousUnitInFlight.add(key);
      this.meterReadingService.getPreviousUnit(memberId, billing.month, billing.year).subscribe({
        next: (result: any) => {
          this.previousUnitInFlight.delete(key);
          const value = Number(result?.previous_unit);
          // Number(null) = 0 — บ้านที่หลังบ้านไม่มีเลขให้ ต้องเป็น null ไม่ใช่ 0
          const usable = result?.previous_unit !== null && result?.previous_unit !== undefined && Number.isFinite(value);
          this.previousUnitCache.set(key, usable ? value : null);
          this.applyCachedPreviousUnits();
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.previousUnitInFlight.delete(key);
          console.error('ดึงเลขเดือนที่แล้วของบ้านใกล้เคียงไม่สำเร็จ:', err);
        }
      });
    }
  }

  /** เอาค่าที่ได้มาแล้วไปติดกับปุ่มบ้านใกล้เคียงทุกแถว (รูปหลายใบใช้บ้านหลังเดียวกันได้) */
  private applyCachedPreviousUnits(): void {
    for (const row of this.rows) {
      for (const near of row.nearby) {
        near.previousUnit = this.cachedPreviousUnit(near.member?.id);
      }
    }
  }

  /** เปลี่ยนรอบบิล = เลขเดือนที่แล้วเป็นคนละตัว ต้องดึงใหม่ ไม่ใช่โชว์ของรอบเก่าค้างไว้ */
  onBillingKeyChanged(): void {
    this.applyCachedPreviousUnits();
    this.rows.forEach((row) => this.loadNearbyPreviousUnits(row));
  }

  /**
   * แนบรูปใหม่ให้แถวที่ไม่มีรูปแล้ว (คิวที่กู้มา / รูปเปิดไม่ขึ้น)
   *
   * ไม่สั่งอ่านเลขใหม่ให้เอง เพราะเลขในช่องมักถูกกรอกมือไปแล้ว การอ่านทับจะกลบของที่คนพิมพ์
   * ทิ้งโดยไม่มีใครทัน — พอมีไฟล์แล้วปุ่มครอปอ่านใหม่จะโผล่ให้กดเองอยู่แล้ว
   */
  async onRetakePicked(event: Event, row: ScanRow): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;
    // ล้างค่าใน input ไม่งั้นเลือกไฟล์เดิมซ้ำจะไม่มี event ให้จับ
    if (input) input.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('ไฟล์นี้ไม่ใช่รูปครับ', { id: 'batch-retake' });
      return;
    }

    const meta = await readPhotoMetadata(file);
    const coords = toCoords(meta.latitude, meta.longitude);
    const capturedAt = parseCaptureDate(meta.captureDate);

    this.releasePreview(row);
    row.file = file;
    row.fileKey = this.keyOf(file);
    row.fileName = file.name;
    row.previewUrl = URL.createObjectURL(file);
    row.brokenImage = false;
    // รูปใหม่คือความจริงล่าสุด แต่ถ้าไฟล์ไม่มี EXIF ติดมา ของเดิมของแถวยังดีกว่าไม่มีอะไรเลย
    if (capturedAt) row.capturedAt = capturedAt;
    if (coords) {
      row.latitude = coords.lat;
      row.longitude = coords.lng;
    }
    // ข้อความเดิมพูดถึงรูปที่หายไปแล้ว ค้างไว้จะขัดกับสิ่งที่เห็นบนจอ
    row.error = null;
    row.errorCode = null;
    if (row.status === 'save_failed') row.status = 'ready';
    this.cdr.detectChanges();

    row.photoData = await this.photoDataUrl(file);
    this.matchByCoords(row);
    this.refreshAllNearby();
    this.persist();
    this.cdr.detectChanges();

    toast.success('แนบรูปใหม่ให้แถวนี้แล้วครับ ออกบิลต่อได้เลย', { id: 'batch-retake' });
  }

  /** มีบ้านหลังอื่นอยู่ใกล้พอ ๆ กับหลังที่เลือก — GPS ชี้ขาดไม่ได้ ต้องให้คนดู */
  hasCloseRival(row: ScanRow): boolean {
    const mine = this.distanceToSelected(row);
    if (mine === null) return false;

    return row.nearby.some(
      (near) => Number(near.member.id) !== Number(row.memberId) && near.meters - mine < this.rivalMarginMeters
    );
  }

  /**
   * ควรโชว์ปุ่มบ้านใกล้เคียงให้กดเลือกไหม — โชว์เมื่อพิกัดชี้ไม่ขาด
   * (ยังไม่รู้ว่าบ้านไหน หรือมีหลังอื่นใกล้พอ ๆ กัน) ส่วนใบที่ชัดแล้วไม่ต้องรก
   */
  showNearbyChoices(row: ScanRow): boolean {
    if (row.status === 'saved' || row.nearby.length === 0) return false;

    return !row.memberId || this.hasCloseRival(row);
  }

  /** กดเลือกบ้านจากปุ่มลัด — ถือเป็นคนเลือกเอง ผลจากหลังบ้านจะไม่มาทับทีหลัง */
  pickNearby(row: ScanRow, member: any): void {
    if (this.isBusy) return;

    // มิเตอร์ในกลุ่มที่ติดกันต้องจดไล่ตามลำดับ ห้ามข้ามไปหยิบตัวขวาก่อน
    const locked = this.clusterLockMessage(member);
    if (locked) {
      toast.error(locked, { id: 'batch-cluster-lock' });
      return;
    }

    row.memberId = member.id;
    this.onMemberChanged(row);
  }

  // ==========================================
  // กลุ่มมิเตอร์ที่ติดกันจนพิกัดแยกไม่ออก
  // ==========================================

  /**
   * ═══ ทำไมหน้านี้ต้องมีโหมดไล่ลำดับ ═══
   *
   * มิเตอร์ทาวน์โฮมเรียงติดกันบนกำแพงเดียวกัน ห่างกันราว 30 ซม. ส่วน GPS มือถือ
   * คลาดเคลื่อน 3-5 ม. ในที่โล่ง และ 10-30 ม. ใต้ชายคา — ความคลาดเคลื่อนกว้างกว่า
   * ระยะจริงเป็นสิบเท่า พิกัดจึงตอบไม่ได้เลยว่ากำลังถ่ายตัวซ้ายหรือตัวขวา
   * และคำตอบที่ได้จะ "ดูน่าเชื่อถือ" เพราะมันมาพร้อมตัวเลขเป็นเมตร
   *
   * สิ่งเดียวที่ไม่แกว่งคือ**ลำดับตำแหน่งที่จดไว้ล่วงหน้า** (sequence_index)
   * หน้านี้จึงพาไล่จดจากซ้ายไปขวาทีละหลัง แล้วล็อกหลังถัดไปไว้จนกว่าหลังก่อนหน้า
   * จะมีเลขแล้ว — คนที่ยืนอยู่หน้ากำแพงรู้เสมอว่า "ตัวถัดไปคือตัวที่อยู่ทางขวามือ"
   */
  private memberById(id: unknown): any | null {
    if (id === null || id === undefined) return null;
    return this.members.find((m) => Number(m.id) === Number(id)) ?? null;
  }

  /** บ้านทุกหลังในกลุ่มเดียวกัน เรียงตามตำแหน่งซ้าย→ขวา ([] = บ้านเดี่ยว) */
  clusterMembers(member: any): any[] {
    const cluster = member?.cluster_group_id ?? null;
    if (!cluster) return [];

    return this.members
      .filter((m) => m?.cluster_group_id === cluster)
      .sort((a, b) => Number(a.sequence_index ?? 0) - Number(b.sequence_index ?? 0));
  }

  /**
   * ป้ายบอกตำแหน่งบนกำแพง — null เมื่อบ้านหลังนี้ไม่ได้อยู่ในกลุ่ม
   *
   * ⚠️ ข้อความต้องตรงกับ BillsService.positionLabel() ของหลังบ้านคำต่อคำ
   *    ไม่งั้นข้อความที่หลังบ้านตีกลับมาจะเรียกตำแหน่งเดียวกันคนละชื่อกับที่คนเห็นบนจอ
   */
  positionLabel(member: any): string | null {
    const group = this.clusterMembers(member);
    if (!group.length) return null;

    const index = Number(member?.sequence_index ?? 0);
    if (!index) return 'ยังไม่ได้ระบุตำแหน่ง';
    if (index === 1) return 'ซ้ายสุด';
    if (index === group.length) return 'ขวาสุด';
    return group.length === 3 ? 'ตรงกลาง' : `ตัวที่ ${index} จากซ้าย`;
  }

  /** บ้านหลังนี้จดเสร็จแล้วหรือยัง — นับทั้งใบในกองนี้และบิลที่ออกไปแล้วในรอบนี้ */
  private isClusterHouseDone(membersId: unknown): boolean {
    const id = Number(membersId);

    const inBatch = this.rows.some(
      (row) => Number(row.memberId) === id && (row.status === 'saved' || row.unit !== null)
    );
    if (inBatch) return true;

    // หลังบ้านบอกมาแล้วว่าบ้านหลังนี้มีบิลของรอบนี้อยู่ — ถือว่าจดไปแล้วเหมือนกัน
    // ไม่งั้นรอบที่จดค้างไว้ครึ่งกลุ่มเมื่อวานจะกลับมาล็อกตัวที่เหลือทั้งแถบ
    return this.rows.some((row) =>
      row.candidates.some(
        (candidate) => Number(candidate.members_id) === id && candidate.already_billed
      )
    );
  }

  /** หลังก่อนหน้าในกลุ่มที่ยังไม่ได้จด — null = จดหลังนี้ได้แล้ว */
  clusterBlocker(member: any): any | null {
    const group = this.clusterMembers(member);
    if (!group.length) return null;

    const index = Number(member?.sequence_index ?? 0);
    // ยังไม่ได้กรอกลำดับให้บ้านหลังนี้ = ไม่รู้ว่ามันอยู่ตรงไหนของกำแพง
    // ปล่อยผ่านดีกว่าล็อกทั้งกลุ่มไว้เฉย ๆ (ข้อมูลที่ขาดต้องไปเติมที่หน้าทะเบียน)
    if (!index) return null;

    return (
      group.find(
        (other) =>
          Number(other.sequence_index ?? 0) > 0 &&
          Number(other.sequence_index) < index &&
          !this.isClusterHouseDone(other.id)
      ) ?? null
    );
  }

  /** ข้อความบอกว่าทำไมหลังนี้ยังกดไม่ได้ — null = กดได้ */
  clusterLockMessage(member: any): string | null {
    const blocker = this.clusterBlocker(member);
    if (!blocker) return null;

    return (
      `ต้องจดบ้าน ${blocker.house_no} (ตำแหน่ง: ${this.positionLabel(blocker)}) ให้เสร็จก่อนครับ — ` +
      'มิเตอร์กลุ่มนี้ติดกันจนพิกัดแยกไม่ออก ต้องไล่จดจากซ้ายไปขวาทีละตัว'
    );
  }

  /** บ้านที่แถวนี้เลือกอยู่ พร้อมป้ายตำแหน่ง — ใช้โชว์บนปุ่มเลือกบ้าน */
  houseLabelWithPosition(row: ScanRow): string {
    const member = this.memberById(row.memberId);
    const label = this.memberLabel(row.memberId);
    const position = member ? this.positionLabel(member) : null;

    return position ? `${label} (ตำแหน่ง: ${position})` : label;
  }

  /** หลังถัดไปที่ต้องจดในกลุ่มของแถวนี้ — null เมื่อไม่ได้อยู่ในกลุ่ม หรือจดครบแล้ว */
  nextInCluster(row: ScanRow): any | null {
    const member = this.memberById(row.memberId);
    const group = this.clusterMembers(member);
    if (!group.length) return null;

    return group.find((other) => !this.isClusterHouseDone(other.id)) ?? null;
  }

  // ==========================================
  // เลือกบ้าน — ปุ่มเปิดรายชื่อทั้งจอ แทน dropdown
  // ==========================================

  /**
   * ทำไมไม่ใช้ <select>
   *
   * หมู่บ้านหนึ่งมีบ้านเป็นร้อยหลัง dropdown ของมือถือจึงกลายเป็นรายการยาวที่เลื่อนหาเอง
   * ทั้งที่ตอนยืนอยู่หน้าบ้าน คนรู้อยู่แล้วว่าจะเลือกหลังไหน — และที่แย่กว่านั้นคือ
   * dropdown ไม่มีที่ให้แสดง "ห่างกี่เมตร / รอบก่อนใช้กี่หน่วย / รูปใบอื่นจองไปแล้ว"
   * ซึ่งเป็นข้อมูลทั้งหมดที่ใช้ตัดสินว่าหลังไหนถูก แถวที่ GPS แยกไม่ออกจึงเดาไม่ได้เลย
   */
  housePickerRow: ScanRow | null = null;
  houseSearch = '';

  openHousePicker(row: ScanRow): void {
    if (this.isBusy || row.status === 'saved') return;

    this.housePickerRow = row;
    this.houseSearch = '';
  }

  closeHousePicker(): void {
    this.housePickerRow = null;
  }

  /**
   * รายชื่อบ้านของกล่องเลือก เรียงตาม "ใกล้จุดถ่ายรูปก่อน"
   *
   * บ้านที่รูปใบอื่นในกองจองไปแล้วยังอยู่ในรายการแต่กดไม่ได้ (เหตุผลเดียวกับปุ่มบ้านใกล้เคียง
   * — กดไปก็ติดด่าน "ซ้ำในกอง" อยู่ดี แต่ต้องเห็นว่ามันมีอยู่ ไม่ใช่หายไปเฉย ๆ)
   */
  housePickerOptions(): {
    member: any;
    meters: number | null;
    usage: number | null;
    takenBySeq: number | null;
    position: string | null;
    locked: string | null;
  }[] {
    const row = this.housePickerRow;
    if (!row) return [];

    const photo = row.latitude !== null && row.longitude !== null
      ? { lat: row.latitude, lng: row.longitude }
      : null;

    const term = this.houseSearch.trim().toLowerCase();

    return this.matchableMembers
      .filter((member) => {
        if (!term) return true;
        const name = `${member.house_no ?? ''} ${member.fname ?? ''} ${member.lname ?? ''}`.toLowerCase();
        return name.includes(term);
      })
      .map((member) => {
        const coords = toCoords(member?.latitude, member?.longitude);
        const candidate = row.candidates.find((c) => Number(c.members_id) === Number(member.id));

        return {
          member,
          meters: photo && coords ? distanceMeters(photo, coords) : null,
          usage: candidate ? Number(candidate.usage_unit) : null,
          takenBySeq: this.takenBySeq(row, member.id),
          position: this.positionLabel(member),
          // ล็อกไว้เพราะยังไม่ได้จดตัวที่อยู่ทางซ้ายของมัน (ไม่ใช่เพราะบ้านนี้ผิดอะไร)
          locked: this.clusterLockMessage(member)
        };
      })
      .sort((a, b) => {
        // บ้านที่ไม่มีพิกัดไม่ได้แปลว่าอยู่ไกล แค่เทียบไม่ได้ — ต่อท้ายไว้ ไม่ใช่ตัดทิ้ง
        if (a.meters === null && b.meters === null) {
          return String(a.member.house_no).localeCompare(String(b.member.house_no), 'th');
        }
        if (a.meters === null) return 1;
        if (b.meters === null) return -1;
        return a.meters - b.meters;
      });
  }

  /** เลือกบ้านจากกล่อง — เดินทางเดียวกับปุ่มบ้านใกล้เคียง แล้วปิดกล่องให้เลย */
  pickHouse(member: any): void {
    const row = this.housePickerRow;
    if (!row) return;

    this.pickNearby(row, member);
    this.closeHousePicker();
  }

  /** ปล่อยบ้านที่เลือกไว้ — ใช้ตอนกดผิดหลัง ต้องมีทางถอยที่ไม่ต้องรีเฟรชหน้า */
  clearHouse(): void {
    const row = this.housePickerRow;
    if (!row || this.isBusy) return;

    row.memberId = null;
    this.onMemberChanged(row);
    this.closeHousePicker();
  }

  /**
   * พิกัดในรูป "ค้าน" บ้านที่เลือกอยู่ — เทียบได้แล้วห่างเกินที่ GPS เพี้ยนได้
   * ไม่มีพิกัดฝั่งใดฝั่งหนึ่งไม่นับว่าค้าน (เทียบไม่ได้ ≠ ขัดแย้ง)
   */
  private coordsDisagree(row: ScanRow): boolean {
    const meters = this.distanceToSelected(row);
    return meters !== null && meters > this.conflictMeters;
  }

  /**
   * หลังบ้านชี้บ้านหลังนี้จาก **เลขมิเตอร์** แบบมั่นใจสูง
   *
   * เลขมิเตอร์เป็นยอดสะสมที่แต่ละบ้านห่างกันมาก จึงแม่นกว่า GPS ที่แยกบ้านห่างกัน
   * 8–20 ม. ไม่ออก — ทางนี้จึงเชื่อได้พอ ๆ กับพิกัด และเป็นทางเดียวที่เหลือสำหรับ
   * รูปจากมือถือที่ปิด GPS หรือบ้านที่ยังไม่เคยเก็บพิกัดไว้ (ก่อนหน้านี้ตกไปทั้งกอง)
   *
   * ต้องเป็นข้อเสนอจากหลังบ้านเท่านั้น (matchedByCoords = จับคู่จากพิกัด ซึ่งตั้งเป็น
   * "ควรตรวจก่อน" อยู่แล้ว) และถ้ามีพิกัดครบทั้งสองฝั่งก็ต้องไม่ค้างกันด้วย
   */
  private isConfirmedByMeterUnit(row: ScanRow): boolean {
    if (row.matchedBy !== 'system' || row.matchedByCoords) return false;
    if (row.matchConfidence !== 'high') return false;

    return !this.coordsDisagree(row);
  }

  /**
   * แถวที่ระบบออกบิลให้เองทันทีหลังอ่านเลขเสร็จ
   *
   * ต้อง "ยืนยันบ้านได้" ด้วยทางใดทางหนึ่ง:
   *   ก. พิกัดในรูปห่างจากมิเตอร์ของบ้านไม่เกิน 25 ม. — สั้นกว่าระยะที่ใช้เดาบ้าน (50 ม.)
   *      ครึ่งหนึ่ง เพราะตรงนี้ไม่มีคนมาตรวจซ้ำแล้ว บ้านที่พิกัดในทะเบียนเพี้ยนตกด่านนี้เอง
   *   ข. หลังบ้านจับคู่จากเลขมิเตอร์แบบมั่นใจสูง และพิกัด (ถ้ามี) ไม่ค้าน
   *
   * แล้วต้องไม่มีอะไรน่าสงสัยเลยสักอย่าง:
   *   1. ไม่ติดด่านปกติ (มีเลขมิเตอร์ · ไม่ติดลบ · ไม่ซ้ำในกอง · ไม่มีบิลของรอบนี้อยู่แล้ว)
   *   2. AI อ่านเลขชัด ≥ 85% — อ่านมั่ว ๆ แล้วบ้านถูกก็ยังเป็นบิลผิดยอด และเลขที่เพี้ยน
   *      ไม่กี่หน่วยลอดด่านหน่วยน้ำ/จำนวนหลักของหลังบ้านไปได้สบาย
   *   3. รูปมีวันถ่าย และวันถ่ายอยู่ในรอบเดือนที่กำลังออก — ไม่มีวันถ่ายแปลว่าบิลจะไปลง
   *      วันที่กดอัปโหลด ซึ่งเพี้ยนตั้งแต่วันจดไปจนถึงจำนวนวันของรอบถัดไป
   *   4. หลังบ้านไม่ได้แนบคำเตือนมา และหน่วยน้ำไม่พุ่งผิดปกติ
   *
   * ⚠️ ด่านของหลังบ้านยังทำงานเต็มที่ทุกใบและไม่เคยถูกข้ามให้: เลขน้อยกว่าเลขตั้งต้น
   *    (เช็คก่อนยิง) · หน่วยน้ำสูงผิดปกติ · จำนวนหลักบนหน้าปัดเปลี่ยน — ธง confirm_*
   *    ไม่เคยถูกส่งเป็น true เอง ใบที่ติดด่านตกมาให้คนกดยืนยันเสมอ
   */
  autoSavable(row: ScanRow): boolean {
    if (row.status === 'saved') return false;
    if (this.blockingIssue(row) !== null) return false;

    if (row.confidence === null || row.confidence < this.trustedConfidence) return false;
    if (row.capturedAt === null || this.isOutsideBillingMonth(row)) return false;
    if (row.warnings.length > 0) return false;
    if (this.abnormalUsage(row)) return false;
    // เปลี่ยนมิเตอร์คือรอบที่ยอดคิดจากเลขสองตัวคนละก้อน ผิดแล้วมองไม่ออกจากยอดบนบิล
    // ใบแบบนี้ต้องผ่านตาคนตอนกดออกบิลเสมอ ไม่ใช่ไหลออกไปเองพร้อมกองที่พิกัดตรงแปะ
    if (row.confirmMeterReset) return false;

    return this.isConfirmedByCoords(row) || this.isConfirmedByMeterUnit(row);
  }

  /**
   * ใบที่ยังไม่เสร็จลอยขึ้นบนสุด ใบที่ออกบิลแล้วจมลงล่าง
   *
   * กองหนึ่งมีได้ถึง 30 ใบ ถ้าเรียงตามลำดับรูปเฉย ๆ ใบที่ติดด่านจะกระจายแทรกอยู่กลาง
   * กองใบที่เขียวหมดแล้ว คนต้องเลื่อนไล่ดูทีละใบว่าเหลืออะไรต้องแก้ — ซึ่งจุดนี้แหละที่คนเลิกไล่
   * แล้วปิดหน้าไปทั้งที่ยังมีใบค้าง
   *
   * เลข #seq ยังเป็นลำดับรูปเดิมเสมอ ย้อนกลับไปหาว่ารูปไหนอยู่ตรงไหนในกองได้
   * และ sort ของ JS เสถียรตามสเปก ใบในกลุ่มเดียวกันจึงไม่สลับที่กันเอง
   */
  private floatUnfinished(): void {
    this.rows.sort((a, b) => Number(a.status === 'saved') - Number(b.status === 'saved'));
  }

  get savableRows(): ScanRow[] {
    return this.rows.filter((row) => row.status !== 'saved' && this.blockingIssue(row) === null);
  }

  get autoSavableRows(): ScanRow[] {
    return this.rows.filter((row) => this.autoSavable(row));
  }

  get savedCount(): number {
    return this.rows.filter((row) => row.status === 'saved').length;
  }

  get needsAttention(): number {
    return this.rows.filter((row) => row.status !== 'saved' && this.blockingIssue(row) !== null).length;
  }

  get isBusy(): boolean {
    return this.isAnalyzing || this.isSaving || this.isRereading;
  }

  get progressPercent(): number {
    if (!this.progress.total) return 0;
    return Math.min(100, (this.progress.done / this.progress.total) * 100);
  }

  /**
   * ด่านที่แถวนี้ติดอยู่และคนกดยืนยันเองได้ — null เมื่อไม่มีปุ่มให้กด
   *
   * ตัดสินจากรหัสที่หลังบ้านแนบมาเป็นหลัก ใบที่มีรหัสแล้วแต่ไม่อยู่ในตาราง (รูปถูกใช้ไปแล้ว ·
   * บิลจ่ายเงินแล้ว) ต้องไม่มีปุ่มโผล่มาเลย จึงไม่ถอยไปเดาจากข้อความต่อ
   */
  pendingConfirm(row: ScanRow): ConfirmStep | null {
    if (row.status !== 'save_failed') return null;

    const step = row.errorCode
      ? CONFIRM_STEPS.find((s) => s.code === row.errorCode)
      : CONFIRM_STEPS.find((s) => s.legacy !== null && s.legacy.test(row.error ?? ''));

    // กดยืนยันไปแล้วแต่ยังไม่ผ่าน = ติดด่านอื่นซ้อนอยู่ ปุ่มเดิมจึงต้องไม่ค้างให้กดวนอีก
    return step && !row[step.flag] ? step : null;
  }

  /** กดยืนยันแล้วเข้าคิวใหม่ — ธงจะถูกส่งไปกับใบนี้ตอนกดออกบิลรอบหน้า */
  confirmStep(row: ScanRow, step: ConfirmStep): void {
    if (this.isBusy) return;

    row[step.flag] = true;
    row.error = null;
    row.errorCode = null;
    row.status = 'ready';
    this.persist();
  }

  /** ล้างคำยืนยันทั้งหมดของแถว — ใช้ตอนเลขเปลี่ยน คำยืนยันของเลขตัวเก่าใช้ต่อไม่ได้ */
  private clearConfirms(row: ScanRow): void {
    row.confirmHighUsage = false;
    row.confirmDigitChange = false;
    row.confirmLowConfidence = false;
    row.confirmDuplicateLocation = false;
    row.confirmStalePhoto = false;
    row.confirmMeterReset = false;
    row.oldMeterFinalUnit = null;
  }

  /**
   * จำนวนหลักที่ส่งไปให้ด่านตรวจ — undefined เมื่อคนแก้เลขเอง
   * เลขที่ผ่านตาคนมาแล้วเชื่อถือได้กว่าที่ AI นับไว้ และหลังบ้านจะข้ามด่านนี้ให้เอง
   */
  private digitsToSend(row: ScanRow): number | undefined {
    if (row.meterDigits === null || row.ocrUnit === null) return undefined;
    return row.unit === row.ocrUnit ? row.meterDigits : undefined;
  }

  /**
   * เลขของแถวนี้มาจากไหน — หลังบ้านใช้ตัดสินว่าจะบังคับให้มีรูปไหม
   *
   *   'ocr'                   เลขยังเป็นค่าที่ AI อ่านมาเป๊ะ ๆ
   *   'manual_after_ocr_fail' AI อ่านไม่ออกเลย (ocrUnit ว่าง) คนพิมพ์แทน
   *   'manual'                AI อ่านได้ แต่คนแก้ทับ
   *
   * แยกสองแบบหลังออกจากกันเพราะความหมายต่างกันเวลาไล่ตรวจย้อนหลัง: แบบแรกคือรูป
   * ที่โมเดลอ่านไม่ได้ (หน้าปัดฝ้า/โคลนบัง) แบบหลังคือคนเห็นว่าโมเดลอ่านผิดแล้วแก้
   */
  private entryMethod(row: ScanRow): 'ocr' | 'manual' | 'manual_after_ocr_fail' {
    if (row.ocrUnit !== null && row.unit === row.ocrUnit) return 'ocr';
    return row.ocrUnit === null ? 'manual_after_ocr_fail' : 'manual';
  }

  /**
   * ความมั่นใจที่ส่งไปให้ด่านตรวจ — เงื่อนไขเดียวกับ digitsToSend
   * คนแก้เลขเองแล้วยังส่งไป จะกลายเป็นบล็อกเลขที่เทียบกับหน้าปัดมาแล้วด้วยคะแนนของเลขตัวเก่า
   */
  private confidenceToSend(row: ScanRow): number | undefined {
    if (row.ocrConfidence === null || row.ocrUnit === null) return undefined;
    return row.unit === row.ocrUnit ? row.ocrConfidence : undefined;
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

    this.runQueue(queue);
  }

  /**
   * ใบที่จะถูกยิงทั้งที่ยังไม่ผ่านด่านฝั่งหน้าเว็บ — ไว้บอกจำนวนในกล่องถามยืนยัน
   * คนต้องเห็นตัวเลขนี้ก่อนกด ไม่งั้น "ยืนยัน" กลายเป็นการกดผ่านของที่ไม่รู้ว่ามีอยู่
   */
  get forcedRows(): ScanRow[] {
    return this.savableRows.filter((row) => !this.autoSavable(row));
  }

  /**
   * ใบที่พิกัดในรูปชี้บ้านได้แบบไม่ต้องถาม — ยิงเองทันทีตั้งแต่อ่านเลขเสร็จ
   *
   * "ตรงแปะ" = จุดถ่ายรูปห่างมิเตอร์ของบ้านนั้นไม่เกิน 25 ม. และไม่มีบ้านหลังอื่นใกล้พอ ๆ กัน
   * (isConfirmedByCoords) บวกกับด่านที่เหลือของ autoSavable ครบทุกข้อ — ชุดนี้คือของเดิม
   * ที่เคยยิงเองอยู่แล้ว จึงไม่ต้องเสียเวลาให้คนกดซ้ำ
   *
   * ใบที่หลังบ้านชี้จากเลขมิเตอร์ (ไม่มีพิกัดมายืนยัน) ตกไปอยู่ในกล่องถาม — ไม่ใช่ "พิกัดตรงแปะ"
   */
  get instantRows(): ScanRow[] {
    return this.rows.filter((row) => this.autoSavable(row) && this.isConfirmedByCoords(row));
  }

  /**
   * อ่านเลขเสร็จแล้วเดินต่อเอง: ยิงใบที่พิกัดตรงแปะก่อน จบคิวแล้วค่อยถามเรื่องที่เหลือ
   *
   * แยกสองจังหวะเพราะคิวเดินทีละใบ ถ้าขึ้นกล่องถามคาไว้ระหว่างที่บิลกำลังทยอยออก
   * ตัวเลขในกล่องจะเป็นของก่อนคิวเดิน แล้วคนจะกดยืนยันชุดที่ไม่ตรงกับที่เห็น
   */
  private runAfterAnalyze(): void {
    if (this.isBusy) return;

    const instant = this.instantRows;
    if (!instant.length) {
      this.askForceSave();
      return;
    }

    this.askAfterQueue = true;
    toast.success(`พิกัดตรง ออกบิลให้เลย ${instant.length} ใบครับ`, { id: 'batch-auto-save' });
    this.runQueue(instant);
  }

  /**
   * ขอออกบิลใบที่เหลือทั้งกอง
   *
   * ไม่ยิงเองเงียบ ๆ เพราะชุดนี้รวมใบที่ยังไม่ยืนยันบ้าน/AI อ่านไม่ชัด/หน่วยพุ่งไว้ด้วย
   * กล่องถามคือด่านสุดท้ายที่เหลือของฝั่งหน้าเว็บ
   */
  private askForceSave(): void {
    if (this.isBusy) return;

    const queue = this.savableRows;
    if (!queue.length) return;

    this.forceConfirm = { total: queue.length, skipped: this.forcedRows.length };
    this.cdr.detectChanges();
  }

  /** กดยืนยันในกล่อง — คิวคิดใหม่ ณ ตอนกด ไม่ใช้ชุดที่จำไว้ตอนอ่านเลขเสร็จ */
  confirmForceSave(): void {
    if (this.isBusy) return;

    this.forceConfirm = null;
    const queue = this.savableRows;
    if (!queue.length) {
      toast.error('ยังไม่มีแถวไหนพร้อมออกบิลครับ', { id: 'batch-save-none' });
      return;
    }

    toast.success(`กำลังออกบิล ${queue.length} ใบครับ`, { id: 'batch-auto-save' });
    this.runQueue(queue);
  }

  /** ไม่ยืนยัน = ไม่ยิงสักใบ ปล่อยให้คนไล่ตรวจแล้วกดปุ่มออกบิลเองตามเดิม */
  cancelForceSave(): void {
    this.forceConfirm = null;
  }

  private runQueue(queue: ScanRow[]): void {
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
      // สั่งหยุดกลางคิว = ไม่ใช่จังหวะที่จะเสนอออกบิลชุดต่อไปให้
      const askNext = this.askAfterQueue && !this.stopRequested;
      this.askAfterQueue = false;

      if (this.stopRequested) {
        this.stopRequested = false;
        toast.success(`หยุดแล้วครับ ออกบิลไปทั้งหมด ${done.length - failed} ใบ`, { id: 'batch-save-done' });
        return;
      }

      toast.success(
        failed ? `ออกบิลสำเร็จ ${done.length - failed} ใบ ไม่สำเร็จ ${failed} ใบครับ` : `ออกบิลครบ ${queue.length} ใบแล้วครับ`,
        { id: 'batch-save-done' }
      );

      // ใบที่พิกัดตรงแปะออกไปแล้ว ที่เหลือ (ถ้ายังมี) ต้องผ่านการกดยืนยันของคน
      if (askNext) this.askForceSave();
      return;
    }

    const row = queue[index];
    // ปัดเศษด้วย เพราะเลขที่คนพิมพ์เองไม่ได้ผ่าน toUnit() มาเหมือนเลขที่ AI อ่าน
    const currentUnit = Math.round(Number(row.unit));

    row.status = 'saving';
    row.error = null;
    // รหัสด่านของรอบก่อนต้องไม่ค้างมาถึงรอบนี้ ไม่งั้นปุ่มยืนยันของด่านเก่าจะโผล่คู่กับ
    // ข้อความของด่านใหม่ที่ยังไม่มีรหัส
    row.errorCode = null;
    this.cdr.detectChanges();

    const billing = this.selectedBilling;

    /**
     * ถามเลขตั้งต้นก่อนเขียนจริง — ในโหมดกองไม่มีใครนั่งดูทีละใบ
     * ถ้าเลือกบ้านผิดแล้วเลขบังเอิญผ่านด่าน จะได้บิลผิดบ้านโดยไม่มีใครทัน
     */
    this.meterReadingService.getPreviousUnit(Number(row.memberId), billing.month, billing.year).subscribe({
      next: (res: any) => {
        const previous = Number(res?.previous_unit);
        // ยืนยันว่าเปลี่ยนมิเตอร์แล้วก็ต้องผ่านด่านนี้ไปได้ ไม่งั้นกดยืนยันไปก็ตกที่เดิมทุกรอบ
        // (หลังบ้านยังตรวจซ้ำเองอยู่ ธงที่ส่งไปเป็นแค่คำอนุญาต ไม่ใช่การข้ามด่าน)
        if (!row.confirmMeterReset && Number.isFinite(previous) && currentUnit < previous) {
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

  /**
   * ใบเดิมของรอบนี้มี id อะไร — ต้องรู้ "ก่อน" ยิงออกบิล เพราะหลังยิงแล้วบ้านหลังนั้นจะมี
   * บิลของเดือนเดียวกันสองใบ แล้วแยกไม่ออกว่าใบไหนคือใบเก่าที่ต้องเก็บกวาด (ดู dropReplacedBill)
   */
  private postBill(
    queue: ScanRow[],
    index: number,
    rateId: number,
    currentUnit: number,
    billing: { month: string; year: string }
  ): void {
    const row = queue[index];

    if (!this.replaceExisting || !this.alreadyBilled(row)) {
      this.sendBill(queue, index, rateId, currentUnit, billing, null);
      return;
    }

    this.meterReadingService.getBillForMonth(Number(row.memberId), billing.month, billing.year).subscribe({
      next: (bill: any) => this.sendBill(queue, index, rateId, currentUnit, billing, bill?.id ?? null),
      // ถามไม่ได้ก็ออกบิลต่อ แค่เก็บกวาดใบเก่าให้ไม่ได้เท่านั้น
      error: () => this.sendBill(queue, index, rateId, currentUnit, billing, null)
    });
  }

  private sendBill(
    queue: ScanRow[],
    index: number,
    rateId: number,
    currentUnit: number,
    billing: { month: string; year: string },
    oldBillId: number | null
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
        // ด่านกันอ่านหลักหาย/หลักเกิน — ส่งเฉพาะแถวที่เลขยังเป็นค่าที่ AI อ่านมา
        meter_digits: this.digitsToSend(row),
        confirm_digit_change: row.confirmDigitChange,
        // ด่านกันเลขที่ AI อ่านมาไม่ชัด (เช่น 1250 → 1258 ที่ลอดด่านอื่นไปได้หมด)
        read_confidence: this.confidenceToSend(row),
        confirm_low_confidence: row.confirmLowConfidence,
        // ด่านกันรูปเดิมถูกส่งซ้ำ / รูปที่ถ่ายไว้ก่อนรอบนี้
        confirm_duplicate_location: row.confirmDuplicateLocation,
        confirm_stale_photo: row.confirmStalePhoto,
        // เปลี่ยนมิเตอร์ใหม่ — ธงกับเลขปิดของตัวเก่าต้องไปด้วยกันเสมอ ส่งธงเปล่า ๆ ไป
        // หลังบ้านจะคิดหน่วยจากเลขใหม่ − เลขตั้งต้น ซึ่งติดลบ = ค่าน้ำรอบนั้นหายทั้งก้อน
        confirm_meter_reset: row.confirmMeterReset,
        old_meter_final_unit: row.confirmMeterReset ? Number(row.oldMeterFinalUnit) : undefined,
        billing_month: billing.month,
        billing_year: billing.year,
        // ส่งพิกัด/เวลาที่ถ่ายไปเก็บด้วย หลังบ้านเอาไปเรียนรู้ตำแหน่งมิเตอร์ของบ้านหลังนี้
        latitude: row.latitude ?? undefined,
        longitude: row.longitude ?? undefined,
        captured_at: row.capturedAt ? row.capturedAt.toISOString() : undefined,
        // รูปหน้าปัดติดไปกับบิลด้วย ไม่งั้นบิลจากโหมดกองจะไม่มีหลักฐานให้เปิดดูย้อนหลังเลย
        // (ใบที่เลขมาจาก AI ล้วน ๆ และย่อรูปไม่ทัน ยังออกบิลได้ — แต่ใบที่กรอกเองไม่ได้
        //  ดู blockingIssue ซึ่งกันไว้ตั้งแต่ก่อนเข้าคิวแล้ว)
        meter_photo: row.photoData ?? undefined,
        // เลขมาจาก AI หรือคนพิมพ์ — หลังบ้านบังคับให้ใบที่กรอกเองต้องมีรูปเสมอ
        entry_method: this.entryMethod(row),
        // กันบิลซ้ำตอนยิงซ้ำ: ยิงด้วยรหัสเดิมได้บิลใบเดิมกลับมา ไม่ใช่ใบที่สอง
        // สำคัญกับแถวสถานะ 'unknown' (ค้างตอนกำลังยิง) ที่คนจะกดออกบิลซ้ำเสมอ
        client_uuid: row.clientUuid
      })
      .subscribe({
        next: (bill: any) => {
          row.status = 'saved';
          row.errorCode = null;
          row.billId = bill?.id ?? null;
          this.dropReplacedBill(oldBillId, row.billId);
          // บิลออกแล้ว = ยืนยันแล้วว่ารูปใบนี้เป็นของบ้านหลังนี้จริง
          // ถ้าพิกัดที่บ้านเก็บไว้เสีย นี่คือจังหวะที่รู้ได้ชัดที่สุดว่าต้องตามไปแก้หลังไหน
          this.reportCoordsMismatch(row);
          // ใบนี้เสร็จแล้ว ดันลงล่างทันทีให้ใบที่ยังค้างเลื่อนขึ้นมาอยู่ในสายตา
          // (คิวที่กำลังยิงเป็นสำเนาคนละก้อนกับ this.rows การสลับที่ตรงนี้ไม่กระทบลำดับยิง)
          this.floatUnfinished();
          this.progress.done = index + 1;
          // เก็บทุกใบ — ไฟดับตอนใบที่ 12 ต้องรู้ว่า 11 ใบแรกออกไปแล้ว
          this.persist();
          this.saveNext(queue, index + 1, rateId);
        },
        error: (err) => {
          console.error('ออกบิลไม่สำเร็จ:', err);
          row.status = 'save_failed';
          row.error = extractErrorMessage(err, 'ออกบิลไม่สำเร็จ');
          row.errorCode = extractErrorCode(err);
          this.progress.done = index + 1;
          this.persist();
          // ใบนี้ไม่ผ่านก็ข้ามไปทำใบอื่นต่อ แล้วค่อยกลับมาแก้ทีหลัง
          this.saveNext(queue, index + 1, rateId);
        }
      });
  }

  /**
   * ส่ง replace ไปแล้วแต่ใบเดิมยังอยู่ — เก็บกวาดให้จากฝั่งนี้
   *
   * หลังบ้านคืนบิลใบใหม่มาแต่ไม่ได้ลบใบเดิมทิ้งจริง บ้านหลังนั้นเลยเหลือบิลของเดือนเดียวกัน
   * สองใบ ซึ่งลูกบ้านเห็นทั้งคู่ในพอร์ทัลและยอดค้างถูกนับซ้ำ
   *
   * ลบหลังใบใหม่ออกสำเร็จเท่านั้น — ลบก่อนแล้วใบใหม่ติดด่านของหลังบ้าน บ้านหลังนั้น
   * จะไม่เหลือบิลของเดือนนั้นเลย ส่วน 404 คือหลังบ้านลบให้เองแล้ว ปล่อยผ่านเงียบ ๆ
   */
  private dropReplacedBill(oldBillId: number | null, newBillId: number | null): void {
    if (!oldBillId || oldBillId === newBillId) return;

    this.meterReadingService.deleteBill(oldBillId).subscribe({
      error: (err: any) => {
        if (err?.status === 404) return;

        console.error('ลบบิลใบเดิมที่ถูกทับไม่สำเร็จ:', err);
        toast.error('ออกบิลใหม่แล้ว แต่ลบใบเดิมบางใบไม่ได้ กรุณาไปลบที่หน้าประวัติบิลด้วยนะครับ', {
          id: 'batch-replace-cleanup'
        });
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
    // แถวที่กู้มายังมีพิกัดของรูปติดมาด้วย ปุ่มบ้านใกล้เคียงจึงยังใช้ได้แม้ตัวรูปหายไปแล้ว
    this.refreshAllNearby();
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
      // คิวที่เก็บก่อนมีระบบนี้จะไม่มีรหัส — สร้างใหม่ให้ ยังดีกว่าไม่มีเลย
      // (แถวพวกนั้นกันซ้ำไม่ได้อยู่แล้วเพราะรหัสเดิมไม่เคยถูกส่งไปหลังบ้าน)
      clientUuid: row.clientUuid || newClientUuid(),
      file: null,
      fileKey: `restored|${row.seq}`,
      fileName: row.fileName,
      previewUrl: null,
      brokenImage: false,
      capturedAt: row.capturedAt ? new Date(row.capturedAt) : null,
      latitude: row.latitude,
      longitude: row.longitude,
      // ตัวรูปไม่ได้ถูกเก็บลงเครื่อง (ก้อนใหญ่เกินโควตา localStorage) จึงไม่มีรูปให้แนบแล้ว
      photoData: null,
      memberId: row.memberId,
      matchedBy: (row.matchedBy as ScanRow['matchedBy']) ?? 'none',
      matchedByCoords: false,
      matchConfidence: null,
      matchReason: null,
      candidates: [],
      nearby: [],
      warnings: [],
      unit: row.unit,
      confidence: row.confidence,
      confirmHighUsage: row.confirmHighUsage,
      confirmDigitChange: false,
      confirmLowConfidence: false,
      confirmDuplicateLocation: false,
      // คำยืนยันเรื่องเปลี่ยนมิเตอร์ผูกอยู่กับเลขตั้งต้นที่หลังบ้านส่งมาตอนจับคู่
      // คิวที่กู้มาไม่มีตัวเลือกบ้านติดมาแล้ว จึงไม่เหลืออะไรให้ยืนยันกับตัวเลขไหน
      confirmStalePhoto: false,
      confirmMeterReset: false,
      oldMeterFinalUnit: null,
      croppedRead: false,
      // ตัวรูปไม่ได้ถูกเก็บไว้ ผลที่ AI เคยอ่านจึงยืนยันอะไรไม่ได้แล้ว
      // ต้องข้ามทั้งด่านจำนวนหลักและด่านความชัดไป (ดู digitsToSend / confidenceToSend)
      ocrUnit: null,
      meterDigits: null,
      ocrConfidence: null,
      // ค้างตอนกำลังยิง = ไม่รู้ผล ส่วนค้างตอนกำลังอ่าน = รูปไม่อยู่แล้ว ต้องกรอกเอง
      status: row.status === 'saving' ? 'unknown' : row.status === 'reading' ? 'read_failed' : (row.status as RowStatus),
      error: row.status === 'reading' ? 'รูปไม่ได้ถูกเก็บไว้ กรุณากรอกเลขเองครับ' : row.error,
      // รหัสด่านไม่ได้ถูกเก็บลงเครื่อง — กดออกบิลซ้ำแล้วหลังบ้านจะตีกลับมาใหม่พร้อมรหัสเอง
      errorCode: null,
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
      clientUuid: row.clientUuid,
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
