import { ChangeDetectorRef, Component, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toast } from 'ngx-sonner';
import { MemberService } from '../../services/member.service';
import { MeterReadingService } from '../../../meter-reading/services/meter-reading.service';
import { AuthService } from '../../../auth/services/auth.service';
import { extractErrorMessage } from '../../../auth/services/auth-error';
import { Village, VillageService } from '../../../village/services/village.service';
import { readPhotoMetadata } from '../../../meter-reading/services/exif';
import { toCoords } from '../../../meter-reading/services/geo';

/**
 * ทะเบียนลูกบ้าน — เขียนใหม่ทั้งหน้า ตัดขั้นตอนที่คนใช้ต้องกดเองออกให้มากที่สุด
 *
 * ของเดิมทำงานถูก แต่ทุกอย่างเป็นปุ่มที่ต้องกดตามลำดับ ซึ่งเจ้าหน้าที่ที่ยืนอยู่
 * หน้ามิเตอร์กลางแดดมักกดข้ามแล้วได้ข้อมูลไม่ครบ รอบนี้เปลี่ยนเป็น:
 *
 *   1. เปิดหน้าต่างเพิ่มบ้าน → เริ่มหาพิกัดให้เลย ไม่ต้องกดปุ่ม "บันทึกพิกัด" อีกที
 *      (พิกัดคือของบังคับอยู่แล้ว การให้กดเองมีแต่ทำให้ลืม)
 *   2. ชื่อเจ้าของบ้านเหลือช่องเดียว แล้วตัดคำแรกเป็นชื่อ ที่เหลือเป็นนามสกุล
 *   3. ลบบ้าน = กดครั้งเดียวจบ ถ้าติดบิลที่ผูกอยู่ ระบบล้างให้แล้วลบซ้ำเอง
 *      (ของเดิมต้องกดลบ → อ่าน error → กดล้างบิล → กดลบใหม่ รวม 4 จังหวะ)
 *   4. บ้านที่ยังไม่มีพิกัดมีปุ่มวัดพิกัดอยู่ในรายการเลย ไม่ต้องเข้าหน้าต่างแก้ไข
 */
@Component({
  selector: 'app-member-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './member-list.html',
  styleUrls: ['./member-list.css']
})
export class MemberListComponent implements OnInit {
  private memberService = inject(MemberService);
  private meterReadingService = inject(MeterReadingService);
  private villageService = inject(VillageService);
  private auth = inject(AuthService);
  private cdr = inject(ChangeDetectorRef);

  members: any[] = [];
  villages: Village[] = [];
  isLoading = true;
  loadFailed = false;
  searchTerm = '';

  /** ความคลาดเคลื่อนที่หลังบ้านยอมรับ (MAX_ACCEPTABLE_ACCURACY_M) — เกินนี้ถูกปฏิเสธ */
  private readonly maxAccuracyM = 50;

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
  // อ่านพิกัดจากเครื่อง (ใช้ร่วมกันทั้งเพิ่ม แก้ไข และปุ่มลัดในรายการ)
  // ==========================================

  /** ต้องการความแม่นระดับแยกบ้านได้ ยอมรอนานหน่อย และห้ามใช้ค่าที่แคชไว้จากที่อื่น */
  private currentPosition(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (!this.isBrowser || !navigator.geolocation) {
        reject(new Error('no-geolocation'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      });
    });
  }

  private geolocationMessage(err: any): string {
    // เปิดผ่าน http จาก IP ในวงแลน เบราว์เซอร์บล็อกการอ่านพิกัดทั้งหมด
    // (localhost กับ https เท่านั้นที่ถือว่าปลอดภัย) — เจอบ่อยตอนทดสอบจากมือถือ
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      return 'เบราว์เซอร์ไม่ยอมให้อ่านพิกัดเมื่อเปิดผ่าน http ครับ ให้เปิดผ่าน https หรือแนบรูปมิเตอร์ที่เปิด GPS ถ่ายไว้แทน';
    }
    if (typeof err?.code !== 'number') {
      return 'เครื่องนี้อ่านพิกัดไม่ได้ครับ ลองแนบรูปมิเตอร์ที่เปิด GPS ถ่ายไว้แทนได้';
    }
    if (err.code === 1) {
      return 'ยังไม่ได้อนุญาตให้เว็บเข้าถึงตำแหน่งครับ กดอนุญาตในเบราว์เซอร์แล้วลองใหม่';
    }
    if (err.code === 2) {
      return 'หาสัญญาณ GPS ไม่เจอครับ ลองออกมาที่โล่ง ๆ แล้วกดใหม่';
    }
    return 'รอสัญญาณ GPS นานเกินไปครับ ลองกดใหม่อีกครั้ง';
  }

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

  /** พิกัดที่ได้มาจากไหน — ต้องรู้ว่าวัดสด ๆ หรืออ่านจากรูปที่แนบ */
  coordsSource: 'gps' | 'photo' | 'none' = 'none';
  isLocating = false;
  locationError: string | null = null;
  photoPreview: string | null = null;

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
      gps_accuracy_m: null as number | null,
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

    // เริ่มจับสัญญาณตั้งแต่เปิดหน้าต่าง กว่าจะกรอกชื่อเสร็จพิกัดก็มาพอดี
    // ถ้ารอให้กดปุ่มเอง จะกลายเป็นยืนรอ GPS ตอนท้ายทุกครั้ง
    this.captureLocation();
  }

  closeAddModal(): void {
    this.showAddModal = false;
    this.newMember = this.emptyMember();
    this.addErrors = { house_no: '', fname: '', phone: '' };
    this.coordsSource = 'none';
    this.locationError = null;
    this.photoPreview = null;
    this.isLocating = false;
  }

  captureLocation(): void {
    if (!this.isBrowser || this.isLocating) return;

    this.isLocating = true;
    this.locationError = null;

    this.currentPosition().then(
      (position) => {
        this.isLocating = false;
        this.newMember.latitude = position.coords.latitude;
        this.newMember.longitude = position.coords.longitude;
        this.newMember.gps_accuracy_m = Math.round(position.coords.accuracy);
        this.coordsSource = 'gps';

        // บอกตั้งแต่ตรงนี้ ดีกว่าปล่อยไปโดนหลังบ้านปฏิเสธตอนกดบันทึกแล้วต้องกรอกใหม่
        if (this.newMember.gps_accuracy_m! > this.maxAccuracyM) {
          this.locationError = `สัญญาณยังไม่นิ่ง (คลาดเคลื่อน ±${this.newMember.gps_accuracy_m} ม.) รอสักครู่แล้วกดวัดใหม่ครับ — ต้องไม่เกิน ${this.maxAccuracyM} ม.`;
        }
        this.cdr.detectChanges();
      },
      (err) => {
        this.isLocating = false;
        this.locationError = this.geolocationMessage(err);
        this.cdr.detectChanges();
      }
    );
  }

  /**
   * แนบรูปหน้าปัด — เป็นหลักฐานของเลขตั้งต้น
   * ถ้ายังไม่มีพิกัดจากเครื่อง ใช้พิกัดที่ติดมากับรูปแทนได้ เพราะรูปถ่ายตอนยืนหน้ามิเตอร์
   * ซึ่งเป็นจุดเดียวกับที่พนักงานยืนตอนจดทุกเดือน
   */
  async onPhotoPicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (!file) return;

    const meta = await readPhotoMetadata(file);
    const coords = toCoords(meta.latitude, meta.longitude);
    if (coords && this.coordsSource !== 'gps') {
      this.newMember.latitude = coords.lat;
      this.newMember.longitude = coords.lng;
      // EXIF ไม่บอกความคลาดเคลื่อน จึงไม่ส่งไป หลังบ้านจะได้ไม่ต้องตรวจข้อนี้
      this.newMember.gps_accuracy_m = null;
      this.coordsSource = 'photo';
      this.locationError = null;
    }

    // หลังบ้านรับรูปเป็น data URL (ดู MeterPhotoService)
    const reader = new FileReader();
    reader.onload = () => {
      this.newMember.meter_photo = reader.result as string;
      this.photoPreview = reader.result as string;
      this.cdr.detectChanges();
    };
    reader.onerror = () => toast.error('อ่านไฟล์รูปไม่สำเร็จ ลองเลือกใหม่อีกครั้งครับ', { id: 'photo-read-error' });
    reader.readAsDataURL(file);
  }

  removePhoto(): void {
    this.newMember.meter_photo = null;
    this.photoPreview = null;
    // พิกัดที่ได้จากรูปต้องหายไปพร้อมรูป ไม่งั้นเหลือพิกัดที่ไม่มีที่มา
    if (this.coordsSource === 'photo') {
      this.newMember.latitude = null;
      this.newMember.longitude = null;
      this.coordsSource = 'none';
    }
  }

  get hasCoords(): boolean {
    return toCoords(this.newMember.latitude, this.newMember.longitude) !== null;
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
      toast.error('ต้องบันทึกพิกัดตอนยืนอยู่หน้ามิเตอร์ก่อนครับ ไม่งั้นระบบจะจับคู่รูปกับบ้านหลังนี้ไม่ได้', { id: 'need-coords' });
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

    const accuracy = Number(this.newMember.gps_accuracy_m);
    if (Number.isFinite(accuracy) && accuracy > this.maxAccuracyM) {
      toast.error(`สัญญาณ GPS ยังไม่นิ่ง (±${Math.round(accuracy)} ม.) กรุณากดวัดพิกัดใหม่ครับ`, { id: 'need-coords' });
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
        gps_accuracy_m: Number.isFinite(accuracy) ? accuracy : undefined,
        initial_meter_unit: initialUnit,
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
  /** id ของบ้านที่กำลังวัดพิกัดอยู่ — กันกดซ้ำและใช้แสดงตัวหมุนเฉพาะแถวนั้น */
  locatingMemberId: number | null = null;

  /**
   * บ้านเก่าที่ลงทะเบียนไว้ก่อนระบบเก็บพิกัดจะไม่มีพิกัดติดมา และจับคู่รูปอัตโนมัติไม่ได้
   * ให้เดินไปยืนหน้ามิเตอร์แล้วกดปุ่มเดียวจบ ไม่ต้องเปิดหน้าต่างแก้ไขแล้วกดบันทึกอีกที
   */
  fillCoords(member: any): void {
    if (!this.isBrowser || this.locatingMemberId !== null) return;

    this.locatingMemberId = member.id;
    this.cdr.detectChanges();

    this.currentPosition().then(
      (position) => {
        const accuracy = Math.round(position.coords.accuracy);
        if (accuracy > this.maxAccuracyM) {
          this.locatingMemberId = null;
          this.cdr.detectChanges();
          toast.error(
            `สัญญาณยังไม่นิ่ง (±${accuracy} ม.) พิกัดหยาบขนาดนี้แยกบ้านไม่ได้ครับ รอสักครู่แล้วกดใหม่`,
            { id: 'member-coords-error' }
          );
          return;
        }

        this.memberService
          .updateMember(
            this.updatePayload(member, {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude
            })
          )
          .subscribe({
            next: () => {
              this.locatingMemberId = null;
              toast.success(`บันทึกพิกัดของบ้านเลขที่ ${member.house_no} แล้วครับ`, { id: 'member-coords-saved' });
              this.loadMembers();
            },
            error: (err) => {
              this.locatingMemberId = null;
              console.error('Fill coords error:', err);
              this.cdr.detectChanges();
              toast.error(extractErrorMessage(err, 'บันทึกพิกัดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), { id: 'member-coords-error' });
            }
          });
      },
      (err) => {
        this.locatingMemberId = null;
        this.cdr.detectChanges();
        toast.error(this.geolocationMessage(err), { id: 'member-coords-error' });
      }
    );
  }

  // ==========================================
  // แก้ไขข้อมูลบ้าน (รวมพิกัด)
  // ==========================================
  showEditModal = false;
  isUpdating = false;
  editingMember: any = null;
  /** วัดพิกัดใหม่ให้บ้านที่กำลังแก้ — พิกัดที่วัดพลาดครั้งแรกต้องแก้ได้ */
  isLocatingEdit = false;
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
    this.isLocatingEdit = false;
  }

  recaptureLocation(): void {
    if (!this.isBrowser || this.isLocatingEdit || !this.editingMember) return;

    this.isLocatingEdit = true;
    this.editLocationError = null;

    this.currentPosition().then(
      (position) => {
        this.isLocatingEdit = false;
        this.editingMember.latitude = position.coords.latitude;
        this.editingMember.longitude = position.coords.longitude;
        const accuracy = Math.round(position.coords.accuracy);
        if (accuracy > this.maxAccuracyM) {
          this.editLocationError = `สัญญาณยังไม่นิ่ง (±${accuracy} ม.) ถ้าบันทึกไปตอนนี้พิกัดจะหยาบเกินกว่าจะแยกบ้านได้ครับ`;
        }
        this.cdr.detectChanges();
      },
      (err) => {
        this.isLocatingEdit = false;
        this.editLocationError = this.geolocationMessage(err);
        this.cdr.detectChanges();
      }
    );
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
