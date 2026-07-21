import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { toast } from 'ngx-sonner';
import { AuthService } from '../../../auth/services/auth.service';
import { extractErrorMessage } from '../../../auth/services/auth-error';

/**
 * หน้าเข้าสู่ระบบของลูกบ้าน — ใช้เบอร์โทรอย่างเดียว ไม่มีรหัสผ่าน
 * เบอร์ต้องถูกลงทะเบียนไว้กับบ้านโดยเจ้าหน้าที่ก่อน ระบบจะเปิดบัญชีให้เองตอนเข้าครั้งแรก
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

  form = this.fb.nonNullable.group({
    // เบอร์ไทย: ขึ้นต้น 0 ตามด้วยเลข 8-9 ตัว (ตรงกับกติกาที่หน้าเพิ่มลูกบ้านใช้)
    phone: ['', [Validators.required, Validators.pattern(/^0\d{8,9}$/)]]
  });

  get phone() {
    return this.form.controls.phone;
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

    this.auth.loginMember(this.form.getRawValue()).subscribe({
      next: () => {
        toast.success('ยินดีต้อนรับครับ', { id: 'member-login-success' });
        // ถ้าถูกเด้งมาจากหน้าที่ต้องล็อกอิน ให้พากลับไปหน้านั้น ไม่งั้นเข้าหน้าบิลของตัวเอง
        const redirectTo = this.route.snapshot.queryParamMap.get('redirectTo');
        this.router.navigateByUrl(redirectTo || '/member/bills');
      },
      error: (err) => {
        this.submitting.set(false);
        this.form.enable();
        this.errorMessage.set(
          extractErrorMessage(err, 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
        );
      }
    });
  }
}
