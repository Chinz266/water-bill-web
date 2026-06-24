import { Component } from '@angular/core';
// 🌟 ลบ RouterOutlet ออกไปเพราะใน html ไม่ได้ใช้แล้ว
import { MeterCropperComponent } from './features/meter-reading/components/meter-cropper/meter-cropper';
import { NgxSonnerToaster } from 'ngx-sonner';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [MeterCropperComponent, NgxSonnerToaster], // 🌟 เพิ่ม NgxSonnerToaster เข้าไปครับ
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class AppComponent {
  title = 'water-bill-web';
}