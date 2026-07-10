import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators
} from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { toast } from 'ngx-sonner';
import { AuthService } from '../../services/auth.service';
import { extractErrorMessage } from '../../services/auth-error';

// ตรวจว่ารหัสผ่านทั้งสองช่องตรงกัน (ติดไว้ที่ตัว group ไม่ใช่ที่ control)
function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const password = group.get('password')?.value;
  const confirmPassword = group.get('confirmPassword')?.value;
  return password && confirmPassword && password !== confirmPassword ? { mismatch: true } : null;
}

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './register.html',
  styleUrls: ['../../auth-shared.css', './register.css']
})
export class RegisterComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);

  submitting = signal(false);
  errorMessage = signal('');
  showPassword = signal(false);

  form = this.fb.nonNullable.group(
    {
      // ตาราง admin เก็บ fname/lname ได้ 45 ตัวอักษร, password 45
      fname: ['', [Validators.required, Validators.maxLength(45)]],
      lname: ['', [Validators.required, Validators.maxLength(45)]],
      email: ['', [Validators.required, Validators.email, Validators.maxLength(100)]],
      password: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(45)]],
      confirmPassword: ['', [Validators.required]]
    },
    { validators: passwordsMatch }
  );

  get fname() {
    return this.form.controls.fname;
  }

  get lname() {
    return this.form.controls.lname;
  }

  get email() {
    return this.form.controls.email;
  }

  get password() {
    return this.form.controls.password;
  }

  get confirmPassword() {
    return this.form.controls.confirmPassword;
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

    // หลังบ้านรับแค่ 4 field — confirmPassword ใช้ตรวจฝั่งหน้าเว็บอย่างเดียว
    const { confirmPassword, ...payload } = this.form.getRawValue();
    this.form.disable();

    this.auth.register(payload).subscribe({
      next: () => {
        // สมัครเสร็จหลังบ้านคืน admin กลับมา AuthService เก็บ session ให้แล้ว เข้า home ได้เลย
        toast.success('สมัครสมาชิกสำเร็จ', { id: 'register-success' });
        this.router.navigateByUrl('/home');
      },
      error: (err) => {
        this.submitting.set(false);
        this.form.enable();
        this.errorMessage.set(
          extractErrorMessage(err, 'สมัครสมาชิกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
        );
      }
    });
  }
}
