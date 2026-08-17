import { Component, OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Observable } from 'rxjs';
import { toast } from 'ngx-sonner';
import { Meter, MetersService } from '../../services/meters.service';
import { Tenancy, TenancyService } from '../../services/tenancy.service';
import { MemberService } from '../../services/member.service';
import { MeterReadingService } from '../../../meter-reading/services/meter-reading.service';
import { AuthService } from '../../../auth/services/auth.service';
import { extractErrorCode, extractErrorMessage } from '../../../auth/services/auth-error';

/**
 * จัดการ "ตัวมิเตอร์" และ "คนที่อยู่บ้านหลังนี้" — สองเรื่องที่บิลรายเดือนไม่ครอบ
 *
 * ═══ ทำไมสองเรื่องนี้ต้องอยู่หน้าเดียวกัน ═══
 *
 * ทั้งคู่คือ "เหตุการณ์ที่เกิดกลางรอบบิล" ซึ่งถ้าไม่บันทึกตอนเกิด ข้อมูลจะหายถาวร:
 *   - เปลี่ยนมิเตอร์: เลขปิดของตัวเก่าอยู่บนหน้าปัดที่ถูกถอดไปแล้ว
 *   - ย้ายออก: เลขมิเตอร์ ณ วันย้ายอยู่กับคนที่ไม่อยู่บ้านหลังนั้นแล้ว
 *
 * ทั้งสองอย่างจึงต้องบันทึก ณ วันที่เกิด ไม่ใช่รอไปกรอกตอนออกบิลรอบถัดไป
 */
@Component({
  selector: 'app-member-manage',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './member-manage.html',
  styleUrls: ['./member-manage.css']
})
export class MemberManageComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private metersService = inject(MetersService);
  private tenancyService = inject(TenancyService);
  private memberService = inject(MemberService);
  private meterReadingService = inject(MeterReadingService);
  private auth = inject(AuthService);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly membersId = signal<number | null>(null);
  readonly member = signal<any>(null);
  readonly meters = signal<Meter[]>([]);
  readonly tenancies = signal<Tenancy[]>([]);
  readonly isLoading = signal(true);

  ngOnInit(): void {
    if (!this.isBrowser) return;

    const id = Number(this.route.snapshot.paramMap.get('membersId'));
    if (!Number.isFinite(id) || id <= 0) {
      toast.error('ไม่พบรหัสบ้านใน URL ครับ', { id: 'manage-no-id' });
      return;
    }

    this.membersId.set(id);
    this.reload();
  }

  reload(): void {
    const id = this.membersId();
    if (!id) return;

    this.isLoading.set(true);

    // ไม่มี endpoint ดึงบ้านทีละหลัง — โหลดทั้งหมดแล้วหยิบเอา
    // (หมู่บ้านเดียวมีหลักร้อยหลัง หน้ารายชื่อก็โหลดทั้งกองอยู่แล้ว ไม่ได้แพงขึ้น)
    this.memberService.getMembers().subscribe({
      next: (members: any[]) => this.member.set(members?.find((m) => m.id === id) ?? null),
      error: () => this.member.set(null)
    });

    this.metersService.getByMember(id).subscribe({
      next: (rows) => {
        this.meters.set(rows);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.isLoading.set(false);
        toast.error(extractErrorMessage(err, 'ดึงทะเบียนมิเตอร์ไม่สำเร็จ'), { id: 'meters-error' });
      }
    });

    this.tenancyService.getByMember(id).subscribe({
      next: (rows) => this.tenancies.set(rows),
      error: () => this.tenancies.set([])
    });
  }

  /** ตัวที่ใช้อยู่ปัจจุบัน — null = บ้านหลังนี้ยังไม่เคยลงทะเบียนมิเตอร์ */
  get activeMeter(): Meter | null {
    return this.meters().find((m) => !m.removed_at) ?? null;
  }

  /** คนที่อยู่ปัจจุบัน — null = ไม่เคยบันทึก (บ้านที่เจ้าของอยู่เอง) */
  get currentTenancy(): Tenancy | null {
    return this.tenancies().find((t) => !t.end_date) ?? null;
  }

  /** หน่วยค้างของมิเตอร์ตัวเก่าที่ยังไม่ได้คิดเงิน — โชว์ไว้ให้รู้ว่าจะไปโผล่ในบิลใบหน้า */
  get pendingResidualMeter(): Meter | null {
    return this.meters().find((m) => m.removed_at && m.final_unit !== null && !m.residual_billed_at) ?? null;
  }

  // ==========================================
  // 🔧 ลงทะเบียน / เปลี่ยนมิเตอร์
  // ==========================================

  readonly showMeterForm = signal(false);
  readonly isSavingMeter = signal(false);

  meterForm = {
    serial_no: '',
    digits: null as number | null,
    old_final_unit: null as number | null,
    new_initial_unit: 0,
    date: '',
    note: ''
  };

  openMeterForm(): void {
    this.meterForm = {
      serial_no: '',
      digits: this.activeMeter?.digits ?? null,
      old_final_unit: null,
      new_initial_unit: 0,
      date: '',
      note: ''
    };
    this.showMeterForm.set(true);
  }

  saveMeter(): void {
    const id = this.membersId();
    if (!id || this.isSavingMeter()) return;

    this.isSavingMeter.set(true);

    // ยังไม่มีมิเตอร์ในทะเบียน = ลงทะเบียนตัวปัจจุบัน ไม่ใช่การเปลี่ยน
    // (บ้านที่เข้าระบบมาก่อนมีทะเบียนมิเตอร์ต้องผ่านขั้นนี้ก่อนถึงจะเปลี่ยนได้)
    // ชนิดของสองทางไม่เหมือนกัน (register คืน Meter ส่วน replace คืนก้อนที่มี residual_unit)
    // ประกาศเป็น any เพื่อให้ union เรียก subscribe ได้ — ฝั่งที่ใช้ค่าอ่านแบบเผื่อไว้อยู่แล้ว
    const request$: Observable<any> = this.activeMeter
      ? this.metersService.replace({
          members_id: id,
          old_final_unit: Number(this.meterForm.old_final_unit),
          new_initial_unit: Number(this.meterForm.new_initial_unit ?? 0),
          new_serial_no: this.meterForm.serial_no || undefined,
          new_digits: this.meterForm.digits ?? undefined,
          replaced_at: this.meterForm.date || undefined,
          note: this.meterForm.note || undefined,
          create_by: this.auth.admin()?.id
        })
      : this.metersService.register({
          members_id: id,
          serial_no: this.meterForm.serial_no || undefined,
          digits: this.meterForm.digits ?? undefined,
          installed_at: this.meterForm.date || undefined,
          initial_unit: Number(this.meterForm.new_initial_unit ?? 0),
          note: this.meterForm.note || undefined,
          create_by: this.auth.admin()?.id
        });

    request$.subscribe({
      next: (result: any) => {
        this.isSavingMeter.set(false);
        this.showMeterForm.set(false);

        const residual = Number(result?.residual_unit ?? 0);
        toast.success(
          residual > 0
            ? `บันทึกการเปลี่ยนมิเตอร์แล้ว — น้ำที่ใช้ก่อนถอด ${residual} หน่วย จะถูกบวกเข้าบิลใบถัดไปให้อัตโนมัติ`
            : 'บันทึกทะเบียนมิเตอร์เรียบร้อยครับ',
          { id: 'meter-saved' }
        );
        this.reload();
      },
      error: (err) => {
        this.isSavingMeter.set(false);
        toast.error(extractErrorMessage(err, 'บันทึกทะเบียนมิเตอร์ไม่สำเร็จ'), { id: 'meter-error' });
      }
    });
  }

  // ==========================================
  // 🚪 ย้ายเข้า / ย้ายออก
  // ==========================================

  readonly showTenancyForm = signal(false);
  readonly isSavingTenancy = signal(false);
  tenancyForm = { occupant_name: '', phone: '', start_date: '' };

  saveTenancy(): void {
    const id = this.membersId();
    if (!id || this.isSavingTenancy()) return;
    if (!this.tenancyForm.occupant_name.trim()) {
      toast.error('ต้องกรอกชื่อผู้อยู่อาศัยครับ', { id: 'tenancy-name' });
      return;
    }

    this.isSavingTenancy.set(true);

    this.tenancyService
      .start({
        members_id: id,
        occupant_name: this.tenancyForm.occupant_name.trim(),
        phone: this.tenancyForm.phone || undefined,
        start_date: this.tenancyForm.start_date || undefined,
        create_by: this.auth.admin()?.id
      })
      .subscribe({
        next: () => {
          this.isSavingTenancy.set(false);
          this.showTenancyForm.set(false);
          this.tenancyForm = { occupant_name: '', phone: '', start_date: '' };
          toast.success('บันทึกผู้อยู่อาศัยรายใหม่เรียบร้อยครับ', { id: 'tenancy-saved' });
          this.reload();
        },
        error: (err) => {
          this.isSavingTenancy.set(false);
          toast.error(extractErrorMessage(err, 'บันทึกผู้อยู่อาศัยไม่สำเร็จ'), { id: 'tenancy-error' });
        }
      });
  }

  readonly showMoveOut = signal(false);
  readonly isMovingOut = signal(false);
  readonly moveOutBlocked = signal<string | null>(null);
  readonly moveOutCode = signal<string | null>(null);
  private moveOutConfirms: Record<string, boolean> = {};

  moveOutForm = {
    current_unit: null as number | null,
    moved_at: '',
    new_occupant_name: '',
    new_occupant_phone: ''
  };

  openMoveOut(): void {
    this.moveOutForm = { current_unit: null, moved_at: '', new_occupant_name: '', new_occupant_phone: '' };
    this.moveOutConfirms = {};
    this.moveOutBlocked.set(null);
    this.moveOutCode.set(null);
    this.showMoveOut.set(true);
  }

  /**
   * ปุ่มยืนยันที่ควรขึ้นสำหรับด่านที่ตีกลับมา — null = ด่านที่ข้ามไม่ได้
   *
   * ด่านที่บล็อกตาย (รูปถูกใช้ไปแล้ว · ถ่ายรัวจากจุดเดิม · เวลาถ่ายเป็นอนาคต ·
   * บิลจ่ายแล้ว) ต้องไม่มีปุ่มโผล่มา ไม่งั้นคนจะกดวนโดยไม่มีอะไรเปลี่ยน
   */
  confirmFlagFor(code: string | null): { flag: string; label: string } | null {
    switch (code) {
      case 'HIGH_USAGE':
        return { flag: 'confirm_high_usage', label: 'ยืนยันว่าหน่วยน้ำที่สูงผิดปกตินั้นถูกต้อง' };
      case 'METER_ROLLBACK':
        return { flag: 'confirm_meter_reset', label: 'ยืนยันว่าเปลี่ยนมิเตอร์ / มิเตอร์วนรอบ' };
      case 'BILL_EXISTS':
        return { flag: 'replace', label: 'จดทับบิลของเดือนนี้ที่ออกไปแล้ว' };
      default:
        return null;
    }
  }

  confirmMoveOutAndRetry(flag: string): void {
    this.moveOutConfirms[flag] = true;
    this.moveOutBlocked.set(null);
    this.moveOutCode.set(null);
    this.submitMoveOut();
  }

  submitMoveOut(): void {
    const id = this.membersId();
    const unit = this.moveOutForm.current_unit;
    if (!id || unit === null || this.isMovingOut()) return;

    this.isMovingOut.set(true);

    this.meterReadingService.getActiveWaterRate().subscribe({
      next: (rate: any) => {
        if (!rate?.id) {
          this.isMovingOut.set(false);
          toast.error('ยังไม่มีเรทค่าน้ำในระบบ ตั้งเรทที่หน้าตั้งค่าหมู่บ้านก่อนครับ', { id: 'no-rate' });
          return;
        }

        this.tenancyService
          .moveOut({
            members_id: id,
            water_rates_id: rate.id,
            current_unit: Number(unit),
            moved_at: this.moveOutForm.moved_at || undefined,
            new_occupant_name: this.moveOutForm.new_occupant_name || undefined,
            new_occupant_phone: this.moveOutForm.new_occupant_phone || undefined,
            create_by: this.auth.admin()?.id,
            ...this.moveOutConfirms
          })
          .subscribe({
            next: (result: any) => {
              this.isMovingOut.set(false);
              this.showMoveOut.set(false);
              toast.success(
                `ออกบิลปิดยอดเรียบร้อย — ต้องเก็บจากผู้ย้ายออก ${Number(result?.amount_due ?? 0).toLocaleString('th-TH')} บาท`,
                { id: 'move-out-ok' }
              );
              this.reload();
            },
            error: (err) => {
              this.isMovingOut.set(false);
              this.moveOutCode.set(extractErrorCode(err));
              this.moveOutBlocked.set(extractErrorMessage(err, 'ออกบิลปิดยอดไม่สำเร็จ'));
            }
          });
      },
      error: (err) => {
        this.isMovingOut.set(false);
        toast.error(extractErrorMessage(err, 'ดึงเรทค่าน้ำไม่สำเร็จ'), { id: 'rate-error' });
      }
    });
  }
}
