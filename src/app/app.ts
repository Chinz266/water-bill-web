import { Component, inject } from '@angular/core';
// 🌟 ลบ RouterOutlet ออกไปเพราะใน html ไม่ได้ใช้แล้ว
import { NgxSonnerToaster } from 'ngx-sonner';
import { RouterModule } from '@angular/router';
import { Navbar } from './layout/navbar/navbar'; // 🌟 ดึง Navbar มาใช้
import { AuthService } from './features/auth/services/auth.service';
import { BillPrintComponent } from './features/meter-reading/components/bill-print/bill-print';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [NgxSonnerToaster, RouterModule, Navbar, BillPrintComponent], // 🌟 เอามาใส่ใน imports
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class AppComponent {
  title = 'water-bill-web';

  // 🌟 navbar เจ้าหน้าที่โชว์เฉพาะตอนล็อกอินเป็น admin เท่านั้น
  //    ลูกบ้าน (role member) มีแถบบนของตัวเองในหน้า my-bills — เมนูสแกน/ลูกบ้านไม่เกี่ยวกับเขา
  readonly isAdmin = inject(AuthService).isAdmin;
}
