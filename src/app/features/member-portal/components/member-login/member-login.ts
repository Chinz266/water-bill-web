import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { toast } from 'ngx-sonner';
import { AuthService } from '../../../auth/services/auth.service';
import { extractErrorMessage } from '../../../auth/services/auth-error';

/**
 * หน้าเข้าสู่ระบบ/สมัครบัญชีของลูกบ้าน — ใช้เบอร์โทรแทนอีเมล
 * หน้าเดียวสลับได้ 2 โหมด เพราะช่องกรอกเหมือนกันเกือบทั้งหมด (เบอร์ + รหัสผ่าน)
 */
@Component({
  selector: 'app-member-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './member-login.html',
  styleUrls: ['../../../auth/auth-shared.css', './member-login.css']
})
export class MemberLoginComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  // ใช้ signal เพราะแอปเป็น zoneless — ตั้งค่าปกติแล้วหน้าจอจะไม่อัปเดตตาม
  submitting = signal(false);
  errorMessage = signal('');
  showPassword = signal(false);
  // false = เข้าสู่ระบบ, true = สมัครบัญชีครั้งแรก
  isRegisterMode = signal(false);

  form = this.fb.nonNullable.group({
    // เบอร์ไทย: ขึ้นต้น 0 ตามด้วยเลข 8-9 ตัว (ตรงกับกติกาที่หน้าเพิ่มลูกบ้านใช้)
    phone: ['', [Validators.required, Validators.pattern(/^0\d{8,9}$/)]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  get phone() {
    return this.form.controls.phone;
  }

  get password() {
    return this.form.controls.password;
  }

  togglePassword(): void {
    this.showPassword.update((v) => !v);
  }

  switchMode(): void {
    this.isRegisterMode.update((v) => !v);
    this.errorMessage.set('');
  }

  onSubmit(): void {
    if (this.submitting()) return;

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set('');
    this.form.disable();

    const payload = this.form.getRawValue();
    const request$ = this.isRegisterMode()
      ? this.auth.registerMember(payload)
      : this.auth.loginMember(payload);

    request$.subscribe({
      next: () => {
        toast.success(
          this.isRegisterMode() ? 'สมัครบัญชีเรียบร้อย ยินดีต้อนรับครับ' : 'ยินดีต้อนรับครับ',
          { id: 'member-login-success' }
        );
        // ถ้าถูกเด้งมาจากหน้าที่ต้องล็อกอิน ให้พากลับไปหน้านั้น ไม่งั้นเข้าหน้าบิลของตัวเอง
        const redirectTo = this.route.snapshot.queryParamMap.get('redirectTo');
        this.router.navigateByUrl(redirectTo || '/member/bills');
      },
      error: (err) => {
        this.submitting.set(false);
        this.form.enable();
        this.errorMessage.set(
          extractErrorMessage(
            err,
            this.isRegisterMode()
              ? 'สมัครบัญชีไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
              : 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
          )
        );
      }
    });
  }
}
