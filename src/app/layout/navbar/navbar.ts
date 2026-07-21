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
  readonly photo = this.auth.user; // เอา user มาอ่าน .photo ในเทมเพลต

  onLogout(): void {
    this.auth.logout();
    toast.success('ออกจากระบบแล้ว', { id: 'logout-success' });
    this.router.navigateByUrl('/login');
  }
}
