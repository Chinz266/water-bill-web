import { ChangeDetectorRef, Component, OnDestroy, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { toast } from 'ngx-sonner';
import { MemberService } from '../../services/member.service';
import { AuthService } from '../../../auth/services/auth.service';
import { extractErrorMessage } from '../../../auth/services/auth-error';
import { Village, VillageService } from '../../../village/services/village.service';
import { parseCaptureDate, readPhotoMetadata } from '../../../meter-reading/services/exif';
import { LatLng, distanceMeters, medianCoords, toCoords } from '../../../meter-reading/services/geo';
import { photoDataUrl } from '../../../meter-reading/services/photo-file';
import { BillPrintService } from '../../../meter-reading/services/bill-print.service';
import { DeviceLocationComponent } from '../../../meter-reading/components/device-location/device-location';

/** บ้านหนึ่งหลัง = รูปหน้าปัดหนึ่งใบ + ข้อมูลที่ต้องพิมพ์เพิ่มเอง */
interface RegisterRow {
  seq: number;
  file: File;
  fileKey: string;
  previewUrl: string | null;
  brokenImage: boolean;

  /** อ่านจาก EXIF ของไฟล์ตอนเลือกรูป — ครอป/ย่อแล้วข้อมูลนี้หายหมด */
  capturedAt: Date | null;
  latitude: number | null;
  longitude: number | null;

  houseNo: string;
  /** ชื่อช่องเดียว คำแรกเป็นชื่อ ที่เหลือเป็นนามสกุล (เหมือนหน้าเพิ่มทีละหลัง) */
  ownerName: string;
  phone: string;
  initialUnit: number | null;

  status: 'ready' | 'saving' | 'saved' | 'failed';
  error: string | null;
  memberId: number | null;
}

/**
 * ลงทะเบียนหลายบ้านจากรูปที่ถ่ายมา
 *
 * ทำไมต้องมีหน้านี้: หน้าเพิ่มทีละหลังบังคับให้ยืนอยู่หน้ามิเตอร์ตอนกรอก เพราะพิกัด
 * มาจากเครื่อง แต่เครื่องที่ไม่มี GPS จริง (คอม หรือมือถือที่ปิดตำแหน่ง) คืนค่า
 * คลาดเคลื่อนหลักสิบกิโลเมตร ซึ่งใช้ไม่ได้เลย และการยืนกรอกทีละหลังทั้งหมู่บ้าน
 * กลางแดดก็ไม่ใช่วิธีที่คนทำจริงได้
 *
 * หน้านี้กลับลำดับ: เดินถ่ายรูปหน้าปัดให้ครบก่อน (รูปพกทั้งวันเวลาและพิกัดมาในไฟล์)
 * แล้วค่อยกลับมานั่งกรอกบ้านเลขที่ ชื่อเจ้าของ และเลขมิเตอร์ตั้งต้นทีเดียวทั้งกอง
 *
 * ⚠️ ไม่มีการเดาข้อมูลใด ๆ แทนคน — บ้านเลขที่กับเลขตั้งต้นต้องพิมพ์เองทุกแถว
 *    เพราะเลขตั้งต้นที่ผิดจะทำให้บิลใบแรกของบ้านหลังนั้นคิดเงินผิดตามไปด้วย
 */
@Component({
  selector: 'app-batch-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, DeviceLocationComponent],
  templateUrl: './batch-register.html',
  styleUrls: ['./batch-register.css']
})
export class BatchRegisterComponent implements OnInit, OnDestroy {
  private memberService = inject(MemberService);
  private villageService = inject(VillageService);
  private auth = inject(AuthService);
  private print = inject(BillPrintService);
  private cdr = inject(ChangeDetectorRef);

  /** กันเผลอลากมาทั้งอัลบั้ม — เกินนี้หน้าจะอืดและคนตรวจไม่ไหวในรอบเดียว */
  readonly maxFiles = 40;

  /** ด้านที่ยาวที่สุดของรูปที่ส่งขึ้นไป (px) */
  private readonly maxPhotoEdge = 1280;

  rows: RegisterRow[] = [];
  villages: Village[] = [];
  villagesId: number | null = null;
  /** บ้านที่มีอยู่แล้ว — ใช้กันลงทะเบียนซ้ำทั้งจากบ้านเลขที่และจากตำแหน่ง */
  members: any[] = [];

  isSaving = false;
  progress = { done: 0, total: 0 };
  private stopRequested = false;
  private seq = 0;

  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** ปิดแท็บกลางคิว = บ้านถูกสร้างไปครึ่งกองโดยไม่มีใครรู้ว่าถึงหลังไหน */
  private readonly warnBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!this.isSaving) return;
    event.preventDefault();
    event.returnValue = '';
  };

  ngOnInit(): void {
    if (!this.isBrowser) return;

    window.addEventListener('beforeunload', this.warnBeforeUnload);

    this.villageService.getVillages().subscribe({
      next: (villages) => {
        this.villages = villages ?? [];
        // มีหมู่บ้านเดียว (กรณีปกติ) เลือกให้เลย จะได้ไม่ต้องกดเอง
        if (this.villages.length === 1) this.villagesId = this.villages[0].id;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('โหลดรายชื่อหมู่บ้านไม่สำเร็จ:', err);
        toast.error('โหลดรายชื่อหมู่บ้านไม่สำเร็จ กรุณาเปิดหน้านี้ใหม่', { id: 'village-load-error' });
      }
    });

    this.memberService.getMembers().subscribe({
      next: (members) => {
        this.members = members ?? [];
        this.cdr.detectChanges();
      },
      error: (err) => console.error('โหลดรายชื่อบ้านเดิมไม่สำเร็จ:', err)
    });
  }

  ngOnDestroy(): void {
    if (this.isBrowser) window.removeEventListener('beforeunload', this.warnBeforeUnload);
    this.rows.forEach((row) => this.releasePreview(row));
  }

  private releasePreview(row: RegisterRow): void {
    if (row.previewUrl) URL.revokeObjectURL(row.previewUrl);
  }

  // ==========================================
  // เลือกรูป
  // ==========================================

  async onFilesPicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    const picked = Array.from(input?.files ?? []);
    // ล้างค่าใน input ไม่งั้นเลือกโฟลเดอร์เดิมซ้ำจะไม่มี event ให้จับ
    if (input) input.value = '';

    const images = picked.filter((file) => file.type.startsWith('image/'));
    if (!images.length) {
      if (picked.length) toast.error('ไม่พบไฟล์รูปในที่ที่เลือกครับ', { id: 'reg-no-image' });
      return;
    }

    // เลือกโฟลเดอร์เดิมซ้ำเป็นเรื่องปกติ ถ้าไม่กันจะได้บ้านเดียวกันสองแถว
    const known = new Set(this.rows.map((row) => row.fileKey));
    const fresh = images.filter((file) => !known.has(this.keyOf(file)));
    const room = this.maxFiles - this.rows.length;

    if (room <= 0) {
      toast.error(`ใส่ได้ครั้งละไม่เกิน ${this.maxFiles} รูปครับ`, { id: 'reg-limit' });
      return;
    }

    const taking = fresh.slice(0, room);
    for (const file of taking) {
      this.rows.push(await this.buildRow(file));
    }

    // เรียงตามเวลาถ่าย = ลำดับที่เดินจดจริง บ้านเลขที่ที่ต้องพิมพ์จะได้ไล่ไปตามซอย
    this.rows.sort((a, b) => (a.capturedAt?.getTime() ?? 0) - (b.capturedAt?.getTime() ?? 0));
    this.cdr.detectChanges();

    if (images.length > fresh.length) {
      toast.success(`ข้ามรูปที่อยู่ในคิวอยู่แล้ว ${images.length - fresh.length} รูปครับ`, { id: 'reg-dup-file' });
    }
    if (fresh.length > taking.length) {
      toast.error(`ใส่ได้อีกแค่ ${room} รูป ส่วนที่เหลือยังไม่ได้ใส่ครับ`, { id: 'reg-limit' });
    }
  }

  private keyOf(file: File): string {
    return `${file.name}|${file.size}|${file.lastModified}`;
  }

  private async buildRow(file: File): Promise<RegisterRow> {
    // ต้องอ่านตอนนี้ ก่อนที่รูปจะถูกย่อลง canvas ตอนส่ง — canvas เก็บแต่พิกเซล
    const meta = await readPhotoMetadata(file);
    const coords = toCoords(meta.latitude, meta.longitude);

    return {
      seq: ++this.seq,
      file,
      fileKey: this.keyOf(file),
      previewUrl: URL.createObjectURL(file),
      brokenImage: false,
      capturedAt: parseCaptureDate(meta.captureDate),
      latitude: coords?.lat ?? null,
      longitude: coords?.lng ?? null,
      houseNo: '',
      ownerName: '',
      phone: '',
      initialUnit: null,
      status: 'ready',
      error: null,
      memberId: null
    };
  }

  removeRow(row: RegisterRow): void {
    if (this.isSaving) return;
    this.releasePreview(row);
    this.rows = this.rows.filter((r) => r !== row);
  }

  clearAll(): void {
    if (this.isSaving) return;
    this.rows.forEach((row) => this.releasePreview(row));
    this.rows = [];
    this.progress = { done: 0, total: 0 };
  }

  onImageError(row: RegisterRow): void {
    row.brokenImage = true;
  }

  // ==========================================
  // ตรวจแต่ละแถวก่อนบันทึก
  // ==========================================

  dateLabel(value: Date | null): string {
    return this.print.dateLabel(value);
  }

  private normalizeHouseNo(value: string): string {
    return (value ?? '').trim().toLowerCase();
  }

  /** เรื่องที่ทำให้แถวนี้ยังบันทึกไม่ได้ — ต้องบอกทีละข้อ ไม่ใช่ "ข้อมูลไม่ครบ" ลอย ๆ */
  blockingIssue(row: RegisterRow): string | null {
    if (row.status === 'saved') return null;

    if (row.latitude === null || row.longitude === null) {
      return 'รูปนี้ไม่มีพิกัดติดมาครับ ต้องเปิดตำแหน่ง (GPS) ที่กล้องก่อนถ่าย — ถ้าเป็นไฟล์ .HEIC จากไอโฟน ให้ตั้งกล้องเป็นแบบ "ประสิทธิภาพสูงสุด (JPEG)" แล้วถ่ายใหม่';
    }
    if (!row.houseNo.trim()) return 'ยังไม่ได้กรอกบ้านเลขที่ครับ';
    if (!row.ownerName.trim()) return 'ยังไม่ได้กรอกชื่อเจ้าของบ้านครับ';

    // เช็ค null อย่างเดียว — มิเตอร์ที่เพิ่งติดใหม่อ่านได้ 0 ซึ่งต้องลงทะเบียนได้
    if (row.initialUnit === null || !Number.isFinite(Number(row.initialUnit))) {
      return 'ยังไม่ได้กรอกเลขมิเตอร์ตั้งต้นครับ';
    }
    if (Number(row.initialUnit) < 0) return 'เลขมิเตอร์ติดลบไม่ได้ครับ';

    if (row.phone.trim() && !/^0\d{8,9}$/.test(row.phone.replace(/-/g, ''))) {
      return 'เบอร์โทรศัพท์ไม่ถูกต้อง (ต้องมี 9-10 หลัก เช่น 0812345678)';
    }

    if (!this.villagesId) return 'ยังไม่ได้เลือกหมู่บ้านด้านบนครับ';

    const houseNo = this.normalizeHouseNo(row.houseNo);
    if (this.rows.some((other) => other !== row && this.normalizeHouseNo(other.houseNo) === houseNo)) {
      return 'บ้านเลขที่นี้ซ้ำกับอีกแถวในคิวครับ';
    }
    if (this.members.some((m) => this.normalizeHouseNo(m?.house_no) === houseNo)) {
      return 'บ้านเลขที่นี้มีอยู่ในระบบแล้วครับ';
    }

    return null;
  }

  /**
   * บ้านที่ลงทะเบียนไว้แล้วและอยู่ใกล้จุดที่ถ่ายรูปใบนี้มาก
   *
   * เตือนอย่างเดียวไม่บล็อก เพราะบ้านสองหลังที่ใช้มิเตอร์ติดกันมีจริง (บ้านเช่า/บ้านญาติ)
   * แต่ส่วนใหญ่กรณีนี้คือถ่ายซ้ำหลังเดิมโดยไม่รู้ตัว ซึ่งจะกลายเป็นบ้านซ้ำในระบบ
   */
  nearbyMember(row: RegisterRow): { house_no: string; meters: number } | null {
    if (row.status === 'saved' || row.latitude === null || row.longitude === null) return null;

    const from = { lat: row.latitude, lng: row.longitude };
    let nearest: { house_no: string; meters: number } | null = null;

    for (const member of this.members) {
      const coords = toCoords(member?.latitude, member?.longitude);
      if (!coords) continue;

      const meters = distanceMeters(from, coords);
      if (meters <= 25 && (!nearest || meters < nearest.meters)) {
        nearest = { house_no: member.house_no, meters };
      }
    }

    return nearest;
  }

  get savableRows(): RegisterRow[] {
    return this.rows.filter((row) => row.status !== 'saved' && this.blockingIssue(row) === null);
  }

  get savedCount(): number {
    return this.rows.filter((row) => row.status === 'saved').length;
  }

  get needsAttention(): number {
    return this.rows.filter((row) => row.status !== 'saved' && this.blockingIssue(row) !== null).length;
  }

  /**
   * ใจกลางของกองรูปที่เลือกมา — ส่งให้แถบเทียบตำแหน่งเครื่องแสดงอย่างเดียว
   *
   * ใช้ค่ากลาง ไม่ใช่ค่าเฉลี่ย เพราะรูปหลุดมาใบเดียวจากคนละอำเภอลากค่าเฉลี่ยออกไปได้ทั้งกอง
   * (เหตุผลเดียวกับ villageCenter ในหน้าจดมิเตอร์ — ดู medianCoords)
   * ค่านี้ไม่ถูกบันทึกและไม่มีผลกับพิกัดของแต่ละแถว ซึ่งยังมาจาก EXIF ของไฟล์ตัวเอง
   */
  get batchCenter(): LatLng | null {
    const points = this.rows
      .map((row) => toCoords(row.latitude, row.longitude))
      .filter((point): point is LatLng => point !== null);

    return medianCoords(points);
  }

  get progressPercent(): number {
    if (!this.progress.total) return 0;
    return Math.min(100, (this.progress.done / this.progress.total) * 100);
  }

  /** หน้าอื่นเรียกผ่าน guard ตอนจะออกจากหน้านี้ */
  get isBusy(): boolean {
    return this.isSaving;
  }

  stopQueue(): void {
    if (!this.isSaving) return;
    this.stopRequested = true;
    toast.success('จะหยุดหลังลงทะเบียนหลังที่ค้างอยู่เสร็จนะครับ', { id: 'reg-stop' });
  }

  // ==========================================
  // ลงทะเบียนทีละหลังตามคิว
  // ==========================================

  saveAll(): void {
    if (this.isSaving) return;

    const queue = this.savableRows;
    if (!queue.length) {
      toast.error('ยังไม่มีแถวไหนพร้อมลงทะเบียนครับ', { id: 'reg-none' });
      return;
    }

    this.isSaving = true;
    this.stopRequested = false;
    this.progress = { done: 0, total: queue.length };
    this.cdr.detectChanges();

    this.saveNext(queue, 0);
  }

  private async saveNext(queue: RegisterRow[], index: number): Promise<void> {
    if (index >= queue.length || this.stopRequested) {
      this.isSaving = false;
      this.cdr.detectChanges();

      const done = queue.slice(0, index);
      const failed = done.filter((row) => row.status === 'failed').length;

      if (this.stopRequested) {
        this.stopRequested = false;
        toast.success(`หยุดแล้วครับ ลงทะเบียนไปทั้งหมด ${done.length - failed} หลัง`, { id: 'reg-done' });
        return;
      }

      toast.success(
        failed
          ? `ลงทะเบียนสำเร็จ ${done.length - failed} หลัง ไม่สำเร็จ ${failed} หลังครับ`
          : `ลงทะเบียนครบ ${queue.length} หลังแล้วครับ`,
        { id: 'reg-done' }
      );
      return;
    }

    const row = queue[index];
    row.status = 'saving';
    row.error = null;
    this.cdr.detectChanges();

    const [fname, ...rest] = row.ownerName.trim().split(/\s+/);
    const photo = await this.photoDataUrl(row.file);

    this.memberService
      .registerOnsite({
        fname: fname ?? '',
        lname: rest.join(' '),
        house_no: row.houseNo.trim(),
        phone: row.phone.trim() || undefined,
        villages_id: Number(this.villagesId),
        create_by: this.auth.admin()?.id,
        latitude: row.latitude!,
        longitude: row.longitude!,
        // EXIF ไม่บอกความคลาดเคลื่อน จึงไม่ส่ง หลังบ้านจะได้ไม่ต้องตรวจข้อนี้
        initial_meter_unit: Math.round(Number(row.initialUnit)),
        reading_date: this.print.isoDate(row.capturedAt ?? new Date()),
        meter_photo: photo ?? undefined
      })
      .subscribe({
        next: (res: any) => {
          row.status = 'saved';
          row.memberId = res?.member?.id ?? res?.id ?? null;

          // ใส่เข้ารายชื่อบ้านที่มีอยู่ทันที แถวถัดไปที่พิมพ์เลขซ้ำจะได้ถูกจับได้
          this.members = [
            ...this.members,
            { id: row.memberId, house_no: row.houseNo.trim(), latitude: row.latitude, longitude: row.longitude }
          ];

          this.progress.done = index + 1;
          this.saveNext(queue, index + 1);
        },
        error: (err) => {
          console.error('ลงทะเบียนบ้านไม่สำเร็จ:', err);
          row.status = 'failed';
          row.error = extractErrorMessage(err, 'ลงทะเบียนไม่สำเร็จ');
          this.progress.done = index + 1;
          // หลังนี้ไม่ผ่านก็ไปทำหลังอื่นต่อ แล้วค่อยกลับมาแก้ทีหลัง
          this.saveNext(queue, index + 1);
        }
      });
  }

  /** ห่อไว้เป็นเมธอดเพื่อให้เทสต์แทนได้ — jsdom เปิดรูปจริงไม่ได้ */
  private photoDataUrl(file: File): Promise<string | null> {
    return this.isBrowser ? photoDataUrl(file, { maxEdge: this.maxPhotoEdge }) : Promise.resolve(null);
  }
}
