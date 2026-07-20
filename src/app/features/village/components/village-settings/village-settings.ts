import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { toast } from 'ngx-sonner';
import { VillageService, Village } from '../../services/village.service';
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
  readonly form = this.fb.nonNullable.group({
    village_name: ['', [Validators.required, Validators.maxLength(200)]],
    village_no: ['', [Validators.required, Validators.maxLength(45)]],
    headman_name: ['', [Validators.maxLength(45)]],
    deputy_headman_name: ['', [Validators.maxLength(45)]],
    phone: ['', [Validators.maxLength(45)]],
    billing_month: ['', [Validators.maxLength(45)]],
  });

  get villageName() { return this.form.controls.village_name; }
  get villageNo() { return this.form.controls.village_no; }

  // ==========================================
  // 💧 ส่วนเรทค่าน้ำ — ราคาต่อหน่วยที่ใช้คิดบิลทุกใบ
  // ==========================================
  readonly rates = signal<WaterRate[]>([]);
  readonly isSavingRate = signal(false);
  // ราคาที่กำลังจะตั้งใหม่ (ngModel) และสถานะเปิด/ปิดกล่องยืนยัน
  newPrice: number | null = null;
  showRateConfirm = false;

  /** เรทที่ใช้คิดเงินอยู่ตอนนี้ (ตัว Active ล่าสุด) */
  get activeRate(): WaterRate | null {
    return this.rates().find((r) => r.status === 'Active') ?? null;
  }

  ngOnInit(): void {
    this.loadVillage();
    this.loadRates();
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
      village_name: village.village_name ?? '',
      village_no: village.village_no ?? '',
      headman_name: village.headman_name ?? '',
      deputy_headman_name: village.deputy_headman_name ?? '',
      phone: village.phone ?? '',
      billing_month: village.billing_month ?? '',
    });
    this.form.markAsPristine();
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

    this.villageService.updateVillage(id, this.form.getRawValue()).subscribe({
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
