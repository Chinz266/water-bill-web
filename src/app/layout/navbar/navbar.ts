import { Component, HostListener, inject, signal } from '@angular/core';
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
  // ชี้ signal ตัวเดียวกับที่ทั้งแอปใช้ (auth.service ไม่มี alias ชื่อ user แล้ว)
  readonly photo = this.auth.admin;
  readonly isMoreOpen = signal(false);

  toggleMore(): void {
    this.isMoreOpen.update((open) => !open);
  }

  closeMore(): void {
    this.isMoreOpen.set(false);
  }

  /**
   * หน้าที่อยู่ในเมนู "เพิ่มเติม" — ปุ่มต้องขึ้นสีตอนอยู่หน้าพวกนี้ ไม่งั้นแถบล่าง
   * ดูเหมือนไม่มีเมนูไหนถูกเลือกอยู่เลยทั้งที่ยืนอยู่ในหน้าใดหน้าหนึ่ง
   *
   * ⚠️ ต้องตรงกับรายการลิงก์ใน .more-links ของ navbar.html เสมอ
   */
  isMoreRouteActive(): boolean {
    return ['/unassigned', '/audit', '/reports', '/village-settings', '/account'].some((path) =>
      this.router.url.startsWith(path),
    );
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeMore();
  }

  onLogout(): void {
    this.closeMore();
    this.auth.logout();
    toast.success('ออกจากระบบแล้ว', { id: 'logout-success' });
    this.router.navigateByUrl('/login');
  }
}
