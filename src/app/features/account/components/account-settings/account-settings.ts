import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { toast } from 'ngx-sonner';
import { AuthService } from '../../../auth/services/auth.service';
import { AccountService } from '../../services/account.service';
import { extractErrorMessage } from '../../../auth/services/auth-error';

/**
 * หน้าตั้งค่าข้อมูลผู้ดูแลหมู่บ้าน (โปรไฟล์ของตัวเอง)
 * แก้ชื่อ-นามสกุล และเบอร์โทรได้ — อีเมล (ใช้ล็อกอิน) แสดงอย่างเดียว ไม่ให้แก้
 */
@Component({
  selector: 'app-account-settings',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './account-settings.html',
  styleUrls: ['./account-settings.css']
})
export class AccountSettingsComponent implements OnInit {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private account = inject(AccountService);
  private router = inject(Router);

  readonly isSaving = signal(false);
  // อีเมลที่ใช้ล็อกอิน — โชว์เฉย ๆ กันแก้ผิดแล้วเข้าระบบไม่ได้
  readonly email = signal('');
  // รูปโปรไฟล์ (base64 data URL) — null = ยังไม่มี/ลบแล้ว
  readonly photo = signal<string | null>(null);
  // จำไว้ว่ารูปถูกแก้ไหม จะได้ส่งเฉพาะตอนเปลี่ยนจริง (ไม่ส่ง base64 ก้อนใหญ่โดยไม่จำเป็น)
  private photoChanged = false;

  readonly form = this.fb.nonNullable.group({
    fname: ['', [Validators.required, Validators.maxLength(45)]],
    lname: ['', [Validators.required, Validators.maxLength(45)]],
    // เบอร์ไทย: ขึ้นต้น 0 ตามด้วยเลข 8-9 ตัว (ไม่บังคับกรอก)
    phone: ['', [Validators.pattern(/^0\d{8,9}$/)]]
  });

  get fname() { return this.form.controls.fname; }
  get lname() { return this.form.controls.lname; }
  get phone() { return this.form.controls.phone; }

  ngOnInit(): void {
    const user = this.auth.admin();
    if (!user) return;
    this.email.set(user.email ?? '');
    this.photo.set(user.photo ?? null);
    this.form.setValue({
      fname: user.fname ?? '',
      lname: user.lname ?? '',
      phone: user.phone ?? ''
    });
    this.form.markAsPristine();
  }

  /** เลือกรูป → ย่อเป็นสี่เหลี่ยมจัตุรัสเล็ก แล้วเก็บเป็น base64 (ไม่ต้องอัปไฟล์จริง) */
  onPhotoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('กรุณาเลือกไฟล์รูปภาพ', { id: 'photo-type' });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // ครอปเป็นจัตุรัสตรงกลาง แล้วย่อเหลือ 256px กันไฟล์ใหญ่เกินเก็บใน localStorage/DB
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

        this.photo.set(canvas.toDataURL('image/jpeg', 0.8));
        this.photoChanged = true;
        this.form.markAsDirty(); // เปิดปุ่มบันทึกให้กดได้
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);

    // เคลียร์ค่า input เผื่อผู้ใช้เลือกไฟล์เดิมซ้ำ (จะได้ยิง change อีกครั้ง)
    input.value = '';
  }

  removePhoto(): void {
    this.photo.set(null);
    this.photoChanged = true;
    this.form.markAsDirty();
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      toast.error('กรุณากรอกข้อมูลให้ถูกต้อง', { id: 'account-invalid' });
      return;
    }

    const id = this.auth.admin()?.id;
    if (!id) return;

    const value = this.form.getRawValue();
    this.isSaving.set(true);
    this.form.disable();

    // ส่งรูปเฉพาะตอนเปลี่ยนจริง (undefined = ไม่แตะรูปเดิม, null = สั่งลบรูป)
    const photoPayload = this.photoChanged ? { photo: this.photo() } : {};

    this.account
      .updateProfile({ id, fname: value.fname, lname: value.lname, phone: value.phone, ...photoPayload })
      .subscribe({
        next: () => {
          this.isSaving.set(false);
          this.form.enable();
          this.form.markAsPristine();
          this.photoChanged = false;
          // อัปเดตข้อมูลที่เก็บไว้ ให้แถบเมนู/รูปเปลี่ยนตามทันที
          this.auth.patchUser({
            fname: value.fname,
            lname: value.lname,
            phone: value.phone,
            ...photoPayload
          });
          toast.success('บันทึกข้อมูลผู้ดูแลเรียบร้อยแล้ว', { id: 'account-saved' });
        },
        error: (err) => {
          this.isSaving.set(false);
          this.form.enable();
          toast.error(extractErrorMessage(err, 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), { id: 'account-error' });
        }
      });
  }

  onLogout(): void {
    this.auth.logout();
    toast.success('ออกจากระบบแล้ว', { id: 'logout-success' });
    this.router.navigateByUrl('/login');
  }
}
