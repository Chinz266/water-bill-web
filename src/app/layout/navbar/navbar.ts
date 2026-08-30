import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { toast } from 'ngx-sonner';
import { AuthService } from '../../features/auth/services/auth.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './navbar.html',
  styleUrls: ['./navbar.css']
})
export class Navbar {
  private auth = inject(AuthService);
  private router = inject(Router);

  readonly displayName = this.auth.displayName;
  // ชี้ signal ตัวเดียวกับที่ทั้งแอปใช้ (เดิมมี alias ชื่อ user ซ้อนอีกชื่อ ไม่มีใครเรียก)
  readonly photo = this.auth.admin;

  onLogout(): void {
    this.auth.logout();
    toast.success('ออกจากระบบแล้ว', { id: 'logout-success' });
    this.router.navigateByUrl('/login');
  }
}
