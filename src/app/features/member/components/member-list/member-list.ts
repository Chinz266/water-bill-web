import { ChangeDetectorRef, Component, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { toast } from 'ngx-sonner';
import { MemberService } from '../../services/member.service';
import { MeterReadingService } from '../../../meter-reading/services/meter-reading.service';
import { AuthService } from '../../../auth/services/auth.service';
import { extractErrorMessage } from '../../../auth/services/auth-error';
import { Village, VillageService } from '../../../village/services/village.service';
import { parseCaptureDate, readPhotoMetadata } from '../../../meter-reading/services/exif';
import { LatLng, toCoords } from '../../../meter-reading/services/geo';
import { anchorDayOf, memberReadingDates } from '../../../meter-reading/services/billing-cycle';
import { photoDataUrl } from '../../../meter-reading/services/photo-file';
import { BillPrintService } from '../../../meter-reading/services/bill-print.service';
import { DeviceLocationComponent } from '../../../meter-reading/components/device-location/device-location';

/**
 * ทะเบียนลูกบ้าน — เขียนใหม่ทั้งหน้า ตัดขั้นตอนที่คนใช้ต้องกดเองออกให้มากที่สุด
 *
 * ของเดิมทำงานถูก แต่ทุกอย่างเป็นปุ่มที่ต้องกดตามลำดับ ซึ่งเจ้าหน้าที่ที่ยืนอยู่
 * หน้ามิเตอร์กลางแดดมักกดข้ามแล้วได้ข้อมูลไม่ครบ รอบนี้เปลี่ยนเป็น:
 *
 *   1. เปิดหน้าต่างเพิ่มบ้าน → แนบรูปหน้าปัดใบเดียว ได้ทั้งวันจดและพิกัดมิเตอร์
 *      (พิกัดคือของบังคับอยู่แล้ว การให้กดวัดเองมีแต่ทำให้ลืม)
 *   2. ชื่อเจ้าของบ้านเหลือช่องเดียว แล้วตัดคำแรกเป็นชื่อ ที่เหลือเป็นนามสกุล
 *   3. ลบบ้าน = กดครั้งเดียวจบ ถ้าติดบิลที่ผูกอยู่ ระบบล้างให้แล้วลบซ้ำเอง
 *      (ของเดิมต้องกดลบ → อ่าน error → กดล้างบิล → กดลบใหม่ รวม 4 จังหวะ)
 *   4. บ้านที่ยังไม่มีพิกัดแนบรูปจากในรายการได้เลย ไม่ต้องเข้าหน้าต่างแก้ไข
 *
 * พิกัดทุกจุดในหน้านี้มาจาก EXIF ของรูปเท่านั้น ไม่วัดจากเครื่องอีกแล้ว — ดู coordsFromPhoto
 *
 * และเมื่อทางเข้าเหลือทางเดียวคือรูป ค่าที่บันทึกไว้ก็คือจุดที่กดชัตเตอร์หน้ามิเตอร์เสมอ
 * หน้านี้จึงไม่ต้องมีชั้นตรวจ/เดาแทนคนอีกแล้ว (เทียบใจกลางหมู่บ้านว่าหลังไหน "ผิดปกติ",
 * ยกพิกัดจากครั้งที่จดมาเติมให้, บอกว่าย้ายไปกี่เมตร) ทั้งหมดนั้นเป็นของยุคที่ยังวัดพิกัด
 * จากเครื่อง ซึ่งได้ค่ามั่วปนมาจนต้องคอยไล่จับ — แนบรูปไหนก็เอาพิกัดของรูปนั้น จบตรงนั้น
 */
@Component({
  selector: 'app-member-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, DeviceLocationComponent],
  templateUrl: './member-list.html',
  styleUrls: ['./member-list.css']
})
export class MemberListComponent implements OnInit {
  private memberService = inject(MemberService);
  private meterReadingService = inject(MeterReadingService);
  private villageService = inject(VillageService);
  private auth = inject(AuthService);
  private print = inject(BillPrintService);
  private cdr = inject(ChangeDetectorRef);

  members: any[] = [];
  villages: Village[] = [];
  isLoading = true;
  loadFailed = false;
  searchTerm = '';

  // ตอน prerender (SSR) ยังไม่มี token ใน localStorage ยิง API ไปก็ได้ 401 เปล่า ๆ
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  ngOnInit(): void {
    if (!this.isBrowser) return;

    this.loadMembers();
    this.villageService.getVillages().subscribe({
      next: (villages) => {
        this.villages = villages ?? [];
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('โหลดรายชื่อหมู่บ้านไม่สำเร็จ:', err);
        toast.error('โหลดรายชื่อหมู่บ้านไม่สำเร็จ กรุณาลองเปิดหน้านี้ใหม่', { id: 'village-load-error' });
      }
    });
  }

  loadMembers(): void {
    this.isLoading = true;
    this.loadFailed = false;

    this.memberService.getMembers().subscribe({
      next: (members) => {
        this.members = this.sortByHouseNo(members ?? []);
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('ดึงข้อมูลสมาชิกไม่สำเร็จ:', err);
        this.isLoading = false;
        this.loadFailed = true;
        this.cdr.detectChanges();
        toast.error(extractErrorMessage(err, 'โหลดรายชื่อลูกบ้านไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), { id: 'member-load-error' });
      }
    });
  }

  /** เรียงตามบ้านเลขที่แบบที่คนอ่าน — 2 ต้องมาก่อน 10 ไม่ใช่เรียงตามตัวอักษร */
  private sortByHouseNo(members: any[]): any[] {
    const collator = new Intl.Collator('th', { numeric: true, sensitivity: 'base' });
    return [...members].sort((a, b) =>
      collator.compare((a?.house_no ?? '').toString(), (b?.house_no ?? '').toString())
    );
  }

  get visibleMembers(): any[] {
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) return this.members;

    return this.members.filter((m) =>
      [m.house_no, m.fname, m.lname, `${m.fname ?? ''} ${m.lname ?? ''}`, m.phone]
        .some((value) => (value ?? '').toString().toLowerCase().includes(term))
    );
  }

  /** บ้านที่ไม่มีพิกัดจะถูกจับคู่รูปมิเตอร์อัตโนมัติไม่ได้ ต้องเห็นว่าเหลือกี่หลัง */
  get missingCoordsCount(): number {
    return this.members.filter((m) => !this.hasMemberCoords(m)).length;
  }

  hasMemberCoords(member: any): boolean {
    return toCoords(member?.latitude, member?.longitude) !== null;
  }

  /**
   * วันประจำเดือนที่บ้านหลังนี้ถูกจด — แต่ละหลังไม่ตรงกัน เพราะเดินจดทั้งหมู่บ้าน
   * ไม่จบในวันเดียว เจ้าหน้าที่จะได้รู้ว่าหลังไหนถึงคิวแล้วโดยไม่ต้องเปิดประวัติบิลดูทีละหลัง
   *
   * ใช้เฉพาะของที่ /member/all ส่งซ้อนมา ไม่ยิง API เพิ่มเพื่อข้อมูลประกอบชิ้นเดียว
   * (ดู memberReadingDates) บ้านที่ยังไม่มีประวัติจะไม่ขึ้นอะไร ดีกว่าขึ้นเลขที่เดาเอา
   */
  readingDay(member: any): number | null {
    return anchorDayOf(memberReadingDates(member));
  }

  villageLabel(village: Village): string {
    const no = (village.village_no ?? '').toString().trim();
    const moo = no ? (no.startsWith('หมู่') ? no : `หมู่ ${no}`) : '';
    return [moo, village.village_name].filter(Boolean).join(' — ');
  }

  ownerName(member: any): string {
    return `${member?.fname ?? ''} ${member?.lname ?? ''}`.trim() || 'ไม่ระบุชื่อ';
  }

  /**
   * ส่งขึ้น /member/update เฉพาะฟิลด์ที่หลังบ้านรู้จัก
   *
   * ของที่ /member/all คืนมามีก้อนซ้อน (villages, bills) ติดมาด้วย ถ้าโยนกลับไปทั้งดุ้น
   * หลังบ้านที่เปิด whitelist ไว้จะตีกลับทั้งคำขอ ทั้งที่คนแก้แค่เบอร์โทรช่องเดียว
   */
  private updatePayload(member: any, over: Record<string, unknown> = {}): Record<string, unknown> {
    const villagesId = member?.villages_id ?? member?.villages?.id;
    return {
      id: member.id,
      house_no: member.house_no,
      fname: member.fname,
      lname: member.lname,
      phone: member.phone,
      ...(villagesId != null ? { villages_id: villagesId } : {}),
      ...over
    };
  }

  // ==========================================
  // พิกัดมาจากรูปทางเดียว (ใช้ร่วมกันทั้งเพิ่ม แก้ไข และปุ่มลัดในรายการ)
  // ==========================================

  /**
   * เลิกวัดพิกัดจากเครื่อง (navigator.geolocation) ทั้งหน้าแล้ว
   *
   * เครื่องที่ไม่มี GPS จริง — คอมพิวเตอร์ที่ใช้ทำงานอยู่ที่ทำการ หรือมือถือที่ปิดตำแหน่ง —
   * จะเดาจากเน็ตที่ต่ออยู่แล้วคืนค่าที่ห่างจากมิเตอร์จริงเป็นร้อยกิโล ค่าพวกนั้นถูกบันทึก
   * ทับพิกัดมิเตอร์ไปแล้วหลายหลัง จนจับคู่รูปผิดบ้านโดยไม่มีใครรู้
   *
   * ส่วนรูปหน้าปัดถูกกดชัตเตอร์ตอนยืนอยู่หน้ามิเตอร์จริง พิกัดที่กล้องฝังมาในไฟล์
   * จึงเป็นตำแหน่งมิเตอร์เสมอ ไม่ว่าจะมานั่งกรอกที่ไหนทีหลังก็ตาม
   *
   * (แถบ app-device-location ในหน้าต่างเพิ่ม/แก้ไข เรียก navigator.geolocation อยู่ก็จริง
   * แต่ค่าที่ได้ขึ้นจอเฉย ๆ ไม่มีทางไหลกลับมาถึงตรงนี้ — ดู device-location.ts)
   */
  private async coordsFromPhoto(file: Blob): Promise<LatLng | null> {
    const meta = await readPhotoMetadata(file);
    return toCoords(meta.latitude, meta.longitude);
  }

  /** ข้อความเดียวกันทุกที่ที่รูปไม่มีพิกัดติดมา — บอกวิธีแก้ ไม่ใช่แค่บอกว่าไม่ได้ */
  private readonly noPhotoCoordsMessage =
    'รูปนี้ไม่มีพิกัดติดมาครับ ต้องเป็นรูปที่ถ่ายตอนเปิดตำแหน่ง (GPS) ไว้ที่กล้อง ' +
    '— ถ้าเป็นไฟล์ .HEIC จากไอโฟน ให้ตั้งกล้องเป็นแบบ "ประสิทธิภาพสูงสุด (JPEG)" แล้วถ่ายใหม่';

  // ==========================================
  // ตรวจข้อมูลก่อนส่ง (ใช้ร่วมกันทั้งเพิ่มและแก้ไข)
  // ==========================================
  addErrors = { house_no: '', fname: '', phone: '' };
  editErrors = { house_no: '', fname: '', phone: '' };

  validateMember(member: any, errorsObj: any): boolean {
    errorsObj.house_no = '';
    errorsObj.fname = '';
    errorsObj.phone = '';

    if (!member.house_no || member.house_no.trim() === '') {
      errorsObj.house_no = 'กรุณากรอกบ้านเลขที่';
    }
    if (!member.fname || member.fname.trim() === '') {
      errorsObj.fname = 'กรุณากรอกชื่อเจ้าของบ้าน';
    }
    if (member.phone && member.phone.trim() !== '') {
      // ลบขีดออกก่อนตรวจ เผื่อกรอกมาแบบ 081-234-5678
      const phoneRegex = /^0\d{8,9}$/;
      if (!phoneRegex.test(member.phone.replace(/-/g, ''))) {
        errorsObj.phone = 'เบอร์โทรศัพท์ไม่ถูกต้อง (ต้องมี 9-10 หลัก เช่น 0812345678)';
      }
    }

    return !errorsObj.house_no && !errorsObj.fname && !errorsObj.phone;
  }

  // ==========================================
  // เพิ่มบ้านใหม่ (ยืนอยู่หน้ามิเตอร์)
  // ==========================================
  showAddModal = false;
  isSavingMember = false;

  /** ฟิลด์ตรงกับ RegisterMemberOnsiteDto ของหลังบ้าน */
  newMember: any = this.emptyMember();

  /** ได้พิกัดจากรูปที่แนบมาแล้วหรือยัง — ทางเดียวที่บ้านใหม่จะมีพิกัด */
  coordsSource: 'photo' | 'none' = 'none';
  locationError: string | null = null;
  photoPreview: string | null = null;

  /**
   * วันเวลาที่กดชัตเตอร์ (อ่านจาก EXIF ของไฟล์ต้นฉบับ) — ใช้เป็นวันจดเลขตั้งต้น
   * ไม่ใช่วันที่กดบันทึก เพราะเจ้าหน้าที่มักเดินเก็บข้อมูลทั้งซอยก่อน
   * แล้วค่อยกลับมานั่งกรอกทีหลัง บางทีข้ามวัน
   */
  photoCapturedAt: Date | null = null;
  /** รูปมีวันถ่ายติดมาแต่อ่านไม่ออก — ต้องบอกว่าระบบจะใช้วันนี้แทน ไม่ใช่เงียบ */
  photoDateUnreadable = false;

  private emptyMember() {
    return {
      house_no: '',
      fname: '',
      lname: '',
      phone: '',
      villages_id: null as number | null,
      initial_meter_unit: null as number | null,
      latitude: null as number | null,
      longitude: null as number | null,
      meter_photo: null as string | null
    };
  }

  /**
   * ชื่อเจ้าของบ้านช่องเดียว — คำแรกเป็นชื่อ ที่เหลือเป็นนามสกุล
   * คนกรอกบนมือถือกลางแดด สองช่องคือสองครั้งที่ต้องเล็งนิ้ว ทั้งที่พิมพ์รวดเดียวก็แยกได้
   */
  get ownerInput(): string {
    return `${this.newMember.fname ?? ''} ${this.newMember.lname ?? ''}`.trim();
  }

  set ownerInput(value: string) {
    const [first, ...rest] = value.trim().split(/\s+/);
    this.newMember.fname = first ?? '';
    this.newMember.lname = rest.join(' ');
  }

  openAddModal(): void {
    // มีหมู่บ้านเดียว (กรณีปกติของหมู่บ้านเดี่ยว) เลือกให้เลย
    if (this.newMember.villages_id === null && this.villages.length === 1) {
      this.newMember.villages_id = this.villages[0].id;
    }
    this.showAddModal = true;
  }

  closeAddModal(): void {
    this.showAddModal = false;
    this.newMember = this.emptyMember();
    this.addErrors = { house_no: '', fname: '', phone: '' };
    this.coordsSource = 'none';
    this.locationError = null;
    this.photoPreview = null;
    this.photoCapturedAt = null;
    this.photoDateUnreadable = false;
  }

  /**
   * แนบรูปหน้าปัด — เป็นหลักฐานของเลขตั้งต้น และเป็นที่มาของทั้ง "วันจด" กับ "พิกัด"
   *
   * ต้องอ่าน EXIF จากไฟล์ต้นฉบับตรงนี้เท่านั้น รูปที่ส่งขึ้นไปเป็น data URL
   * ที่หลังบ้านเก็บเป็นไฟล์ใหม่ ข้อมูลพวกนี้จะอ่านย้อนหลังไม่ได้อีกแล้ว
   *
   * รูปคือทางเดียวที่บ้านใหม่จะได้พิกัด ถ้ารูปไม่มีพิกัดติดมาต้องบอกให้ชัด
   * ไม่งั้นคนจะกรอกจนครบแล้วมาติดตอนกดบันทึกโดยไม่รู้ว่าต้องแก้ยังไง
   */
  async onPhotoPicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (!file) return;

    const meta = await readPhotoMetadata(file);

    // วันถ่ายคือวันที่ไปยืนอ่านเลขจริง = จุดเริ่มรอบบิลใบแรกของบ้านหลังนี้
    this.photoCapturedAt = parseCaptureDate(meta.captureDate);
    this.photoDateUnreadable = !!meta.captureDate && this.photoCapturedAt === null;

    const coords = toCoords(meta.latitude, meta.longitude);
    if (coords) {
      this.newMember.latitude = coords.lat;
      this.newMember.longitude = coords.lng;
      this.coordsSource = 'photo';
      this.locationError = null;
    } else {
      // รูปเก่าที่แชร์ผ่านแอปแชทมาแล้ว EXIF ถูกถอดทิ้ง เจอบ่อยกว่าที่คิด
      this.locationError = this.noPhotoCoordsMessage;
    }

    /**
     * ย่อก่อนส่งเสมอ — หลังบ้านรับรูปเป็น data URL ใน JSON ซึ่ง body-parser
     * ตั้งเพดานไว้ 100kb ถ้าโยนไฟล์เต็ม (มือถือใบละ 3–8 MB + base64 บวกอีกหนึ่งในสาม)
     * ทั้งคำขอจะโดนตีกลับเป็น entity.too.large ตั้งแต่ก่อนเข้า controller
     * คือลงทะเบียนบ้านไม่ผ่านทั้งที่ข้อมูลอย่างอื่นถูกหมด
     */
    const data = await photoDataUrl(file);
    if (!data) {
      toast.error('อ่านไฟล์รูปไม่สำเร็จ ลองเลือกใหม่อีกครั้งครับ', { id: 'photo-read-error' });
      return;
    }

    this.newMember.meter_photo = data;
    this.photoPreview = data;
    this.cdr.detectChanges();
  }

  removePhoto(): void {
    this.newMember.meter_photo = null;
    this.photoPreview = null;
    // วันถ่ายมาจากรูปใบนั้นใบเดียว เอารูปออกแล้วต้องกลับไปใช้วันนี้ ไม่ใช่ค้างวันของรูปเก่า
    this.photoCapturedAt = null;
    this.photoDateUnreadable = false;
    // พิกัดที่ได้จากรูปต้องหายไปพร้อมรูป ไม่งั้นเหลือพิกัดที่ไม่มีที่มา
    if (this.coordsSource === 'photo') {
      this.newMember.latitude = null;
      this.newMember.longitude = null;
      this.coordsSource = 'none';
    }
    this.locationError = null;
  }

  get hasCoords(): boolean {
    return toCoords(this.newMember.latitude, this.newMember.longitude) !== null;
  }

  /**
   * พิกัดของรูปที่แนบอยู่ ส่งให้แถบเทียบตำแหน่งเครื่อง (app-device-location) วาดอย่างเดียว
   *
   * ทางเดินของค่ายังเป็นทางเดียวเหมือนเดิม: รูป → EXIF → newMember → หลังบ้าน
   * แถบนั้นอ่านค่านี้ไปแสดง ไม่มีทางเขียนกลับ — ตำแหน่งจากเครื่องจึงไม่แตะข้อมูลที่บันทึก
   */
  get newMemberCoords(): LatLng | null {
    return toCoords(this.newMember.latitude, this.newMember.longitude);
  }

  get editingMemberCoords(): LatLng | null {
    return toCoords(this.editingMember?.latitude, this.editingMember?.longitude);
  }

  /** วันที่จะถูกบันทึกเป็นวันจดเลขตั้งต้นจริง ๆ — ไม่มีวันถ่ายติดรูปก็ถอยมาใช้วันนี้ */
  get registrationDate(): Date {
    return this.photoCapturedAt ?? new Date();
  }

  get registrationDateLabel(): string {
    return this.print.dateLabel(this.registrationDate);
  }

  saveMember(): void {
    if (this.isSavingMember) return;
    if (!this.validateMember(this.newMember, this.addErrors)) return;

    if (!this.newMember.villages_id) {
      toast.error('กรุณาเลือกหมู่บ้านก่อนบันทึกนะครับ', { id: 'need-village' });
      return;
    }

    const coords = toCoords(this.newMember.latitude, this.newMember.longitude);
    if (!coords) {
      toast.error('ต้องแนบรูปหน้าปัดที่ถ่ายตอนเปิด GPS ไว้ก่อนครับ ระบบใช้พิกัดในรูปเป็นตำแหน่งมิเตอร์ ไม่งั้นจับคู่รูปกับบ้านหลังนี้ไม่ได้', { id: 'need-coords' });
      return;
    }

    // หลังบ้านบังคับเป็นจำนวนเต็มไม่ติดลบ ดักตั้งแต่ที่นี่จะได้ไม่ต้องรอ error กลับมา
    const initialUnit = Math.round(Number(this.newMember.initial_meter_unit));
    if (
      this.newMember.initial_meter_unit === null ||
      this.newMember.initial_meter_unit === '' ||
      !Number.isFinite(initialUnit) ||
      initialUnit < 0
    ) {
      toast.error('กรุณากรอกเลขมิเตอร์ ณ วันลงทะเบียนครับ (ไม่ติดลบ)', { id: 'need-initial' });
      return;
    }

    this.isSavingMember = true;

    // ยิงครั้งเดียวจบ — หลังบ้านสร้างบ้านกับการจดครั้งแรกในทรานแซกชันเดียว
    this.memberService
      .registerOnsite({
        fname: this.newMember.fname,
        lname: this.newMember.lname,
        house_no: this.newMember.house_no,
        phone: this.newMember.phone || undefined,
        villages_id: this.newMember.villages_id,
        create_by: this.auth.admin()?.id,
        latitude: coords.lat,
        longitude: coords.lng,
        initial_meter_unit: initialUnit,
        // วันถ่ายรูปคือวันที่อ่านเลขนี้จริง ๆ = จุดเริ่มรอบบิลใบแรกของบ้านหลังนี้
        reading_date: this.print.isoDate(this.registrationDate),
        meter_photo: this.newMember.meter_photo || undefined
      })
      .subscribe({
        next: () => {
          this.isSavingMember = false;
          this.closeAddModal();
          toast.success('เพิ่มบ้านใหม่พร้อมเลขมิเตอร์ตั้งต้นเรียบร้อยแล้ว', { id: 'member-added' });
          this.loadMembers();
        },
        error: (err) => {
          this.isSavingMember = false;
          console.error('Register onsite error:', err);
          this.cdr.detectChanges();
          toast.error(extractErrorMessage(err, 'เพิ่มข้อมูลไม่สำเร็จ กรุณาตรวจสอบข้อมูลอีกครั้ง'), { id: 'member-add-error' });
        }
      });
  }

  // ==========================================
  // ปุ่มลัดในรายการ: เติมพิกัดให้บ้านที่ยังไม่มี
  // ==========================================
  /** id ของบ้านที่กำลังอ่านพิกัดจากรูปอยู่ — กันกดซ้ำและใช้แสดงตัวหมุนเฉพาะแถวนั้น */
  locatingMemberId: number | null = null;

  /**
   * บ้านเก่าที่ลงทะเบียนไว้ก่อนระบบเก็บพิกัดจะไม่มีพิกัดติดมา และจับคู่รูปอัตโนมัติไม่ได้
   * แนบรูปหน้าปัดที่ถ่ายไว้แล้วจากในรายการได้เลย ระบบดึงพิกัดในไฟล์ไปบันทึกให้จบในจังหวะเดียว
   * ไม่ต้องเปิดหน้าต่างแก้ไขแล้วกดบันทึกอีกที และไม่ต้องเดินกลับไปยืนหน้ามิเตอร์
   */
  async fillCoordsFromPhoto(member: any, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (!file || !this.isBrowser || this.locatingMemberId !== null) return;

    this.locatingMemberId = member.id;
    this.cdr.detectChanges();

    const coords = await this.coordsFromPhoto(file);
    if (!coords) {
      this.locatingMemberId = null;
      this.cdr.detectChanges();
      toast.error(this.noPhotoCoordsMessage, { id: 'member-coords-error' });
      return;
    }

    this.memberService
      .updateMember(this.updatePayload(member, { latitude: coords.lat, longitude: coords.lng }))
      .subscribe({
        next: () => {
          this.locatingMemberId = null;
          toast.success(`บันทึกพิกัดจากรูปของบ้านเลขที่ ${member.house_no} แล้วครับ`, { id: 'member-coords-saved' });
          this.loadMembers();
        },
        error: (err) => {
          this.locatingMemberId = null;
          console.error('Fill coords error:', err);
          this.cdr.detectChanges();
          toast.error(extractErrorMessage(err, 'บันทึกพิกัดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), { id: 'member-coords-error' });
        }
      });
  }

  // ==========================================
  // แก้ไขข้อมูลบ้าน (รวมพิกัด)
  // ==========================================
  showEditModal = false;
  isUpdating = false;
  editingMember: any = null;
  editLocationError: string | null = null;

  openEditModal(member: any): void {
    this.editingMember = { ...member };
    this.editErrors = { house_no: '', fname: '', phone: '' };
    this.editLocationError = null;
    this.showEditModal = true;
  }

  closeEditModal(): void {
    if (this.isUpdating) return;
    this.showEditModal = false;
    this.editingMember = null;
  }

  /**
   * ดึงพิกัดจากรูปที่ถ่ายไว้แล้ว — ทางเดียวที่บ้านเก่าจะได้พิกัดที่เชื่อถือได้
   * ใช้แค่ค่าพิกัดใน EXIF ไม่ได้อัปโหลดตัวรูป (หน้าแก้ไขไม่ได้เก็บรูปหน้าปัด)
   */
  async onEditPhotoPicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (!file || !this.editingMember) return;

    const coords = await this.coordsFromPhoto(file);

    if (!coords) {
      this.editLocationError = this.noPhotoCoordsMessage;
      this.cdr.detectChanges();
      return;
    }

    // รูปที่แนบมาคือรูปล่าสุดที่คนตั้งใจเลือกเอง ใช้ค่าของมันตรง ๆ ไม่ต้องเทียบกับของเดิม
    this.editingMember.latitude = coords.lat;
    this.editingMember.longitude = coords.lng;
    this.editLocationError = null;
    this.cdr.detectChanges();

    this.persistCoords('บันทึกพิกัดจากรูปเรียบร้อยแล้ว');
  }

  /**
   * เขียนพิกัดที่เพิ่งได้ลงฐานข้อมูลทันที ไม่รอให้กด "บันทึกการแก้ไข" อีกจังหวะ
   *
   * ของเดิมแค่เซ็ตค่าลงฟอร์ม คนที่กดดึงพิกัดแล้วปิดหน้าต่างเลยจะได้ค่าเก่ากลับมา
   * ทั้งที่หน้าจอเพิ่งขึ้นพิกัดใหม่ให้ดู — เห็นแล้วเข้าใจว่าระบบดึงพิกัดไม่ตรงกับรูป
   */
  private persistCoords(successMessage: string): void {
    const member = this.editingMember;
    const coords = toCoords(member?.latitude, member?.longitude);
    if (!member || !coords || this.isUpdating) return;

    this.isUpdating = true;
    this.cdr.detectChanges();

    this.memberService
      .updateMember(this.updatePayload(member, { latitude: coords.lat, longitude: coords.lng }))
      .subscribe({
        next: () => {
          this.isUpdating = false;
          this.cdr.detectChanges();
          toast.success(successMessage, { id: 'edit-coords-photo' });
          this.loadMembers();
        },
        error: (err) => {
          this.isUpdating = false;
          console.error('บันทึกพิกัดไม่สำเร็จ:', err);
          // ค่าบนฟอร์มยังเป็นพิกัดจากรูปอยู่ กดปุ่มบันทึกการแก้ไขลองใหม่ได้เลย
          this.editLocationError = extractErrorMessage(err, 'บันทึกพิกัดไม่สำเร็จ กดปุ่มบันทึกการแก้ไขเพื่อลองใหม่');
          this.cdr.detectChanges();
        }
      });
  }

  updateMember(): void {
    if (this.isUpdating || !this.editingMember) return;
    if (!this.validateMember(this.editingMember, this.editErrors)) return;

    const member = this.editingMember;
    const coords = toCoords(member.latitude, member.longitude);

    this.isUpdating = true;
    this.memberService
      .updateMember(
        this.updatePayload(member, coords ? { latitude: coords.lat, longitude: coords.lng } : {})
      )
      .subscribe({
        next: () => {
          this.isUpdating = false;
          this.closeEditModal();
          toast.success('บันทึกการแก้ไขเรียบร้อยแล้ว', { id: 'member-updated' });
          this.loadMembers();
        },
        error: (err) => {
          this.isUpdating = false;
          console.error('Update member error:', err);
          this.cdr.detectChanges();
          toast.error(extractErrorMessage(err, 'แก้ไขข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), { id: 'member-update-error' });
        }
      });
  }

  // ==========================================
  // พิมพ์บิลย้อนหลังของบ้านหลังเดียว
  //
  // ลูกบ้านมาขอใบเสร็จย้อนหลังทีละหลัง แต่ของเดิมต้องเข้าหน้าประวัติบิล เลือกเดือน
  // แล้วค้นบ้านเลขที่อีกที ทั้งที่ยืนดูทะเบียนบ้านหลังนั้นอยู่แล้ว
  //
  // เอกสารที่ออกคือ printSingle() ตัวเดียวกับหน้าประวัติบิล (A4 เต็มหน้า) —
  // อย่าเขียน template ใบเสร็จของหน้านี้เอง ไม่งั้นบิลใบเดียวกันพิมพ์จากคนละหน้า
  // แล้วได้คนละหน้าตา ลูกบ้านที่ถือสองใบมาเทียบจะไม่เชื่อทั้งสองใบ
  // ==========================================

  /** บ้านที่กำลังเปิดดูบิลอยู่ (null = ยังไม่ได้กด) */
  billsMember: any = null;
  memberBills: any[] = [];
  isLoadingBills = false;
  billsLoadFailed = false;

  openBills(member: any): void {
    this.billsMember = member;
    this.memberBills = [];
    this.billsLoadFailed = false;
    this.isLoadingBills = true;
    this.cdr.detectChanges();

    // โหลดใหม่ทุกครั้งที่เปิด ไม่เก็บกองไว้ — บิลออกเพิ่มระหว่างเปิดหน้านี้ค้างไว้ได้
    this.meterReadingService.getBills().subscribe({
      next: (bills: any) => {
        const all = bills ?? [];
        // ช่วงวันของรอบต้องรู้วันจดของใบก่อนหน้า จึงต้องทำดัชนีจากบิล "ทั้งกอง"
        // ไม่ใช่เฉพาะของบ้านหลังนี้ (ดู BillPrintService.indexCycles)
        this.print.indexCycles(all);

        this.memberBills = all
          // id จากหลังบ้านมาเป็น string ได้ในบางเส้นทาง เทียบเป็นตัวเลขไว้ก่อน
          .filter((b: any) => Number(b?.member?.id ?? b?.members_id) === Number(member.id))
          .sort((a: any, b: any) => this.billOrder(b) - this.billOrder(a));

        this.isLoadingBills = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Load member bills error:', err);
        this.isLoadingBills = false;
        this.billsLoadFailed = true;
        this.cdr.detectChanges();
        toast.error(extractErrorMessage(err, 'ดึงบิลของบ้านหลังนี้ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), { id: 'member-bills-error' });
      }
    });
  }

  closeBills(): void {
    this.billsMember = null;
    this.memberBills = [];
  }

  /** เรียงใหม่สุดขึ้นก่อน — 2569-08 ต้องมาก่อน 2569-07 ไม่ใช่เรียงตามวันที่กดออกบิล */
  private billOrder(bill: any): number {
    return Number(bill?.billing_year ?? 0) * 12 + Number(bill?.billing_month ?? 0);
  }

  printBill(bill: any): void {
    this.print.printSingle(bill);
  }

  // ข้อความบนจอใช้ตัวเดียวกับที่พิมพ์ลงกระดาษ ให้ตรงกันทั้งสองที่
  monthLabel(month: string | number, year: string | number): string {
    return this.print.monthLabel(month, year);
  }

  statusLabel(status: string): string {
    return this.print.statusLabel(status);
  }

  // ==========================================
  // ลบบ้าน — กดครั้งเดียว ระบบเคลียร์ของที่ผูกอยู่ให้เอง
  // ==========================================
  memberToDelete: any = null;
  isDeleting = false;
  /** บอกว่าตอนนี้ทำอะไรอยู่ระหว่างลบ (ล้างบิลนานกว่าที่คิด ต้องมีอะไรให้ดู) */
  deleteStep: string | null = null;
  /** ลบไม่ผ่านจริง ๆ — เก็บสาเหตุไว้บอกว่าต้องไปทำอะไรต่อ */
  deleteBlockedReason: string | null = null;

  askDelete(member: any): void {
    this.memberToDelete = member;
    this.deleteBlockedReason = null;
    this.deleteStep = null;
  }

  cancelDelete(): void {
    if (this.isDeleting) return;
    this.memberToDelete = null;
    this.deleteBlockedReason = null;
    this.deleteStep = null;
  }

  confirmDelete(): void {
    if (!this.memberToDelete || this.isDeleting) return;

    this.isDeleting = true;
    this.deleteStep = 'กำลังลบข้อมูลบ้าน...';
    this.deleteBlockedReason = null;
    this.cdr.detectChanges();

    this.removeMember(this.memberToDelete, true);
  }

  /**
   * ลบบ้านหนึ่งครั้ง — ถ้าติดข้อมูลที่ผูกอยู่ (หลังบ้านตอบ 5xx) ให้ล้างบิลแล้วลองซ้ำเอง
   *
   * `allowRetry` กันวนไม่จบ: ล้างบิลได้ครั้งเดียว ถ้ารอบสองยังไม่ผ่านแปลว่าติดที่อื่น
   * ซึ่งกดซ้ำอีกกี่ทีก็ไม่หาย ต้องให้คนแก้ระบบเข้าไปดู
   */
  private removeMember(member: any, allowRetry: boolean): void {
    this.memberService.deleteMember(member.id).subscribe({
      next: () => {
        this.isDeleting = false;
        this.deleteStep = null;
        this.memberToDelete = null;
        toast.success(`ลบบ้านเลขที่ ${member.house_no} เรียบร้อยแล้ว`, { id: 'member-deleted' });
        this.loadMembers();
      },
      error: (err) => {
        // เก็บของดิบไว้ให้คนแก้ระบบดู ส่วนบนจอบอกว่าต้องทำอะไรต่อ
        console.error('Delete member error:', err?.status, err?.error ?? err);

        if (allowRetry && err?.status >= 500) {
          this.clearBillsThenRetry(member);
          return;
        }

        this.isDeleting = false;
        this.deleteStep = null;
        this.deleteBlockedReason = this.deleteErrorMessage(err, allowRetry, member);
        this.cdr.detectChanges();
      }
    });
  }

  /**
   * บิลเป็นตัวเดียวที่หน้าเว็บลบเองได้ (DELETE /bills/:id) ส่วนประวัติจดมิเตอร์
   * หลังบ้านจัดการต่อเองตอนลบบ้าน — ล้างบิลออกให้หมดแล้วค่อยสั่งลบบ้านอีกที
   */
  private clearBillsThenRetry(member: any): void {
    this.deleteStep = 'กำลังล้างบิลของบ้านหลังนี้...';
    this.cdr.detectChanges();

    this.meterReadingService.getBills().subscribe({
      next: (bills: any) => {
        const ids = (bills ?? []).filter((b: any) => b?.member?.id === member.id).map((b: any) => b.id);
        if (!ids.length) {
          // ไม่มีบิลให้ล้าง แปลว่าติดที่อื่น ลองลบซ้ำก็ไม่ช่วย
          this.isDeleting = false;
          this.deleteStep = null;
          this.deleteBlockedReason =
            `บ้านหลังนี้ไม่มีบิลค้างให้ล้างแล้วครับ แต่หลังบ้านยังลบไม่ผ่าน รบกวนแจ้งผู้ดูแลระบบพร้อมบ้านเลขที่ ${member.house_no}`;
          this.cdr.detectChanges();
          return;
        }

        this.clearNextBill(member, ids, 0);
      },
      error: (err) => {
        console.error('Load bills before delete error:', err);
        this.isDeleting = false;
        this.deleteStep = null;
        this.deleteBlockedReason = extractErrorMessage(err, 'ดึงรายการบิลของบ้านหลังนี้ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
        this.cdr.detectChanges();
      }
    });
  }

  /** ลบบิลทีละใบตามคิว ใบไหนพังก็ไปต่อ แล้วค่อยลองลบบ้านซ้ำตอนจบ */
  private clearNextBill(member: any, ids: number[], index: number): void {
    if (index >= ids.length) {
      this.deleteStep = 'ล้างบิลเสร็จแล้ว กำลังลบข้อมูลบ้าน...';
      this.cdr.detectChanges();
      this.removeMember(member, false);
      return;
    }

    this.deleteStep = `กำลังล้างบิลของบ้านหลังนี้ (เหลือ ${ids.length - index} ใบ)...`;
    this.cdr.detectChanges();

    this.meterReadingService.deleteBill(ids[index]).subscribe({
      next: () => this.clearNextBill(member, ids, index + 1),
      error: (err) => {
        console.error('Delete bill error:', err);
        this.clearNextBill(member, ids, index + 1);
      }
    });
  }

  /**
   * ลบไม่ผ่านมีได้หลายสาเหตุ และแต่ละสาเหตุคนละคนเป็นคนแก้
   * ถ้าขึ้นข้อความกลาง ๆ เหมือนกันหมด เจ้าหน้าที่จะได้แต่กดซ้ำไปเรื่อย ๆ
   */
  private deleteErrorMessage(err: any, firstTry: boolean, member: any): string {
    if (err?.status === 404) {
      return 'ระบบหลังบ้านยังไม่มีคำสั่งลบบ้าน (อาจยังไม่ได้อัปเดตหรือรีสตาร์ท) รบกวนแจ้งผู้ดูแลระบบครับ';
    }
    if (err?.status === 401 || err?.status === 403) {
      return 'บัญชีนี้ไม่มีสิทธิ์ลบบ้านครับ ต้องเข้าด้วยบัญชีเจ้าหน้าที่';
    }
    if (err?.status >= 500) {
      return firstTry
        ? 'หลังบ้านลบไม่สำเร็จครับ รบกวนลองใหม่อีกครั้ง'
        : `ล้างบิลให้หมดแล้วแต่ยังลบไม่ผ่านครับ แปลว่ายังมีข้อมูลอื่นผูกอยู่กับบ้านหลังนี้ รบกวนแจ้งผู้ดูแลระบบพร้อมบ้านเลขที่ ${member.house_no}`;
    }
    return extractErrorMessage(err, 'ลบข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
  }
}
