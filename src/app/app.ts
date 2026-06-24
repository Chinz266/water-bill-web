import { Component } from '@angular/core';
<<<<<<< HEAD
// 🌟 ลบ RouterOutlet ออกไปเพราะใน html ไม่ได้ใช้แล้ว
import { MeterCropperComponent } from './features/meter-reading/components/meter-cropper/meter-cropper';
import { NgxSonnerToaster } from 'ngx-sonner';
=======
import { RouterModule, RouterOutlet } from '@angular/router';
import { NavbarComponent } from './layout/navbar/navbar'; // 🌟 ดึง Navbar มาใช้
>>>>>>> master

@Component({
  selector: 'app-root',
  standalone: true,
<<<<<<< HEAD
  imports: [MeterCropperComponent, NgxSonnerToaster], // 🌟 เพิ่ม NgxSonnerToaster เข้าไปครับ
=======
  imports: [RouterOutlet, RouterModule, NavbarComponent], // 🌟 เอามาใส่ใน imports
>>>>>>> master
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class AppComponent {
  title = 'water-bill-web';
}