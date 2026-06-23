import { Component } from '@angular/core';
// 🌟 ลบ RouterOutlet ออกไปเพราะใน html ไม่ได้ใช้แล้ว
import { MeterCropperComponent } from './features/meter-reading/components/meter-cropper/meter-cropper';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [MeterCropperComponent], // 🌟 เหลือแค่ตัว Crop รูปของเราตัวเดียวพอครับ
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class AppComponent {
  title = 'water-bill-web';
}