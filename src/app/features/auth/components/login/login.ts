import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { toast } from 'ngx-sonner';
import { AuthService } from '../../services/auth.service';
import { extractErrorMessage } from '../../services/auth-error';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './login.html',
  styleUrls: ['../../auth-shared.css', './login.css']
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  // ใช้ signal เพราะแอปเป็น zoneless — ตั้งค่าปกติแล้วหน้าจอจะไม่อัปเดตตาม
  submitting = signal(false);
  errorMessage = signal('');
  showPassword = signal(false);

  form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]]
  });

  get email() {
    return this.form.controls.email;
  }

  get password() {
    return this.form.controls.password;
  }

  togglePassword(): void {
    this.showPassword.update((v) => !v);
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

    this.auth.login(this.form.getRawValue()).subscribe({
      next: (admin) => {
        toast.success(`ยินดีต้อนรับ ${admin.fname}`, { id: 'login-success' });
        // ถ้าถูกเด้งมาจากหน้าที่ต้องล็อกอิน ให้พากลับไปหน้านั้น ไม่งั้นเข้า home
        const redirectTo = this.route.snapshot.queryParamMap.get('redirectTo');
        this.router.navigateByUrl(redirectTo || '/home');
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
