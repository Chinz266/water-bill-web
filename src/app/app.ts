import { Component, inject } from '@angular/core';
// 🌟 ลบ RouterOutlet ออกไปเพราะใน html ไม่ได้ใช้แล้ว
import { NgxSonnerToaster } from 'ngx-sonner';
import { RouterModule } from '@angular/router';
import { Navbar } from './layout/navbar/navbar'; // 🌟 ดึง Navbar มาใช้
import { AuthService } from './features/auth/services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [NgxSonnerToaster, RouterModule, Navbar], // 🌟 เอามาใส่ใน imports
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class AppComponent {
  title = 'water-bill-web';

  // 🌟 ใช้ตัดสินใจว่าจะโชว์ navbar ไหม — หน้า login/register ไม่ต้องมี navbar
  readonly isLoggedIn = inject(AuthService).isLoggedIn;
}
