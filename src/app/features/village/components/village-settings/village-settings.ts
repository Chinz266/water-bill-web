import { Component, OnInit, inject, signal, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { toast } from 'ngx-sonner';
import { VillageService, Village, LocationOption } from '../../services/village.service';
import { MeterReadingService, WaterRate } from '../../../meter-reading/services/meter-reading.service';
import { AuthService } from '../../../auth/services/auth.service';
import { extractErrorMessage } from '../../../auth/services/auth-error';

@Component({
  selector: 'app-village-settings',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  templateUrl: './village-settings.html',
  styleUrls: ['./village-settings.css'],
})
export class VillageSettingsComponent implements OnInit {
  private villageService = inject(VillageService);
  private meterReadingService = inject(MeterReadingService);
  private auth = inject(AuthService);
  private fb = inject(FormBuilder);

  readonly isLoading = signal(true);
  readonly isSaving = signal(false);
  readonly loadError = signal('');
  /** เก็บ id ไว้ตอนบันทึก — ไม่ hardcode เผื่ออนาคตมีหลายหมู่บ้าน */
  readonly villageId = signal<number | null>(null);

  // ชื่อหมู่บ้านกับหมู่ที่เป็น NOT NULL ในฐานข้อมูล จึงบังคับกรอกตั้งแต่หน้าเว็บ
  // village_no เก็บ "เลขหมู่ล้วน ๆ" (เช่น 1) — คำว่า "หมู่" ให้หน้าจอเติมเองตอนแสดงผล
  readonly form = this.fb.nonNullable.group({
    village_name: ['', [Validators.required, Validators.maxLength(200)]],
    village_no: ['', [Validators.required, Validators.pattern(/^\d+$/), Validators.maxLength(45)]],
    provinces_id: [null as number | null, [Validators.required]],
    districts_id: [null as number | null, [Validators.required]],
    subdistricts_id: [null as number | null, [Validators.required]],
  });

  get villageName() { return this.form.controls.village_name; }
  get villageNo() { return this.form.controls.village_no; }

  // ==========================================
  // 🗺️ จังหวัด → อำเภอ → ตำบล (เลือกเป็นชั้น)
  // ==========================================
  readonly provinces = signal<LocationOption[]>([]);
  readonly districts = signal<LocationOption[]>([]);
  readonly subdistricts = signal<LocationOption[]>([]);

  /** เปลี่ยนจังหวัด → โหลดอำเภอใหม่ และล้างอำเภอ/ตำบลเดิมที่ไม่ได้อยู่ในจังหวัดนี้แล้ว */
  onProvinceChange(): void {
    this.form.patchValue({ districts_id: null, subdistricts_id: null });
    this.districts.set([]);
    this.subdistricts.set([]);

    const provinceId = this.form.controls.provinces_id.value;
    if (provinceId) this.loadDistricts(provinceId);
  }

  /** เปลี่ยนอำเภอ → โหลดตำบลใหม่ และล้างตำบลเดิม */
  onDistrictChange(): void {
    this.form.patchValue({ subdistricts_id: null });
    this.subdistricts.set([]);

    const districtId = this.form.controls.districts_id.value;
    if (districtId) this.loadSubdistricts(districtId);
  }

  private loadDistricts(provinceId: number): void {
    this.villageService.getDistricts(provinceId).subscribe({
      next: (districts) => this.districts.set(districts ?? []),
      error: (err) => console.error('โหลดรายชื่ออำเภอไม่สำเร็จ:', err),
    });
  }

  private loadSubdistricts(districtId: number): void {
    this.villageService.getSubdistricts(districtId).subscribe({
      next: (subdistricts) => this.subdistricts.set(subdistricts ?? []),
      error: (err) => console.error('โหลดรายชื่อตำบลไม่สำเร็จ:', err),
    });
  }

  // ==========================================
  // 💧 ส่วนเรทค่าน้ำ — ราคาต่อหน่วยที่ใช้คิดบิลทุกใบ
  // ==========================================
  readonly rates = signal<WaterRate[]>([]);
  readonly isSavingRate = signal(false);
  // ประวัติการปรับราคาซ่อนไว้ก่อน กดปุ่มถึงจะกาง (คนส่วนใหญ่ดูแค่ราคาปัจจุบัน)
  readonly showRateHistory = signal(false);
  // ราคาที่กำลังจะตั้งใหม่ (ngModel) และสถานะเปิด/ปิดกล่องยืนยัน
  newPrice: number | null = null;
  showRateConfirm = false;

  /** เรทที่ใช้คิดเงินอยู่ตอนนี้ (ตัว Active ล่าสุด) */
  get activeRate(): WaterRate | null {
    return this.rates().find((r) => r.status === 'Active') ?? null;
  }

  // ตอน prerender (SSR) ยังไม่มี token ใน localStorage ยิง API ไปก็ได้ 401 เปล่า ๆ
  // ต้องข้ามไปก่อน แล้วให้ฝั่ง browser โหลดจริง ไม่งั้น build จะพังตอน prerender
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  ngOnInit(): void {
    if (!this.isBrowser) return;

    this.loadVillage();
    this.loadRates();

    this.villageService.getProvinces().subscribe({
      next: (provinces) => this.provinces.set(provinces ?? []),
      error: (err) => console.error('โหลดรายชื่อจังหวัดไม่สำเร็จ:', err),
    });
  }

  private loadRates(): void {
    this.meterReadingService.getWaterRates().subscribe({
      next: (rates) => this.rates.set(rates ?? []),
      error: (err) => {
        console.error('โหลดเรทค่าน้ำไม่สำเร็จ:', err);
        toast.error(extractErrorMessage(err, 'โหลดเรทค่าน้ำไม่สำเร็จ'), { id: 'rate-load-error' });
      },
    });
  }

  /** กดปุ่มบันทึกเรท → เช็คค่าก่อน แล้วเปิดกล่องยืนยัน (เรื่องเงินต้องยืนยันก่อนเสมอ) */
  askSaveRate(): void {
    const price = Number(this.newPrice);
    if (!price || isNaN(price) || price <= 0) {
      toast.error('กรุณากรอกราคาต่อหน่วยเป็นตัวเลขมากกว่า 0', { id: 'rate-invalid' });
      return;
    }
    this.showRateConfirm = true;
  }

  cancelSaveRate(): void {
    this.showRateConfirm = false;
  }

  confirmSaveRate(): void {
    const price = Number(this.newPrice);
    const adminId = this.auth.admin()?.id;
    if (!price || !adminId) return;

    this.showRateConfirm = false;
    this.isSavingRate.set(true);

    this.meterReadingService.createWaterRate(price, adminId).subscribe({
      next: () => {
        this.isSavingRate.set(false);
        this.newPrice = null;
        this.loadRates();
        toast.success(`ตั้งเรทค่าน้ำใหม่ ${price} บาท/หน่วย เรียบร้อยแล้ว`, { id: 'rate-saved' });
      },
      error: (err) => {
        this.isSavingRate.set(false);
        toast.error(extractErrorMessage(err, 'ตั้งเรทค่าน้ำไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), { id: 'rate-save-error' });
      },
    });
  }

  /** '2026-07-21' → '21 กรกฎาคม 2569' สำหรับตารางประวัติเรท */
  private readonly thMonths = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];

  rateDateLabel(value: string | undefined): string {
    if (!value) return '—';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '—';
    return `${d.getDate()} ${this.thMonths[d.getMonth()]} ${d.getFullYear() + 543}`;
  }

  private loadVillage(): void {
    this.isLoading.set(true);
    this.loadError.set('');

    this.villageService.getVillages().subscribe({
      next: (villages) => {
        const village = villages[0];
        if (!village) {
          this.loadError.set('ยังไม่มีข้อมูลหมู่บ้านในระบบ');
          this.isLoading.set(false);
          return;
        }
        this.villageId.set(village.id);
        this.fillForm(village);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.isLoading.set(false);
        this.loadError.set(extractErrorMessage(err, 'โหลดข้อมูลหมู่บ้านไม่สำเร็จ'));
      },
    });
  }

  /** ค่า null จากหลังบ้านต้องแปลงเป็น '' ไม่งั้น input จะโชว์คำว่า null */
  private fillForm(village: Village): void {
    this.form.setValue({
      // ข้อมูลเก่าอาจเก็บมาแบบ "หมู่ 4" — ดึงเฉพาะตัวเลขมาใส่ช่อง ให้ผู้ใช้เห็นรูปแบบใหม่เลย
      village_name: village.village_name ?? '',
      village_no: (village.village_no ?? '').replace(/[^0-9]/g, ''),
      provinces_id: village.provinces_id ?? null,
      districts_id: village.districts_id ?? null,
      subdistricts_id: village.subdistricts_id ?? null,
    });
    this.form.markAsPristine();

    // เตรียมตัวเลือกอำเภอ/ตำบลของค่าที่บันทึกไว้ ให้ dropdown โชว์ชื่อได้ทันทีที่เปิดหน้า
    if (village.provinces_id) this.loadDistricts(village.provinces_id);
    if (village.districts_id) this.loadSubdistricts(village.districts_id);
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      toast.error('กรุณากรอกข้อมูลให้ครบถ้วน', { id: 'village-invalid' });
      return;
    }

    const id = this.villageId();
    if (id === null) return;

    this.isSaving.set(true);
    this.form.disable();

    // id ทั้งสามผ่าน required มาแล้วจึงไม่เป็น null — แปลงชนิดให้ตรงกับ payload (number | undefined)
    const raw = this.form.getRawValue();
    const payload = {
      ...raw,
      provinces_id: raw.provinces_id ?? undefined,
      districts_id: raw.districts_id ?? undefined,
      subdistricts_id: raw.subdistricts_id ?? undefined,
    };

    this.villageService.updateVillage(id, payload).subscribe({
      next: (village) => {
        this.isSaving.set(false);
        this.form.enable();
        // เติมค่าที่หลังบ้านบันทึกจริงกลับเข้าฟอร์ม (เช่นค่าที่ถูก trim ช่องว่างออก)
        this.fillForm(village);
        toast.success('บันทึกข้อมูลหมู่บ้านเรียบร้อยแล้ว', { id: 'village-saved' });
      },
      error: (err) => {
        this.isSaving.set(false);
        this.form.enable();
        toast.error(extractErrorMessage(err, 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), {
          id: 'village-save-error',
        });
      },
    });
  }

  onReset(): void {
    this.loadVillage();
    toast.info('ย้อนกลับเป็นข้อมูลที่บันทึกไว้ล่าสุดแล้ว', { id: 'village-reset' });
  }
}
