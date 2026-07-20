import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BillPrintService } from '../../services/bill-print.service';

/**
 * เอกสารบิลที่ใช้ตอนสั่งพิมพ์ (ซ่อนบนจอเสมอ)
 * วางไว้ที่ app.html ตัวเดียว ทุกหน้าจึงพิมพ์บิลได้ด้วยหน้าตาเดียวกัน
 */
@Component({
  selector: 'app-bill-print',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './bill-print.html'
})
export class BillPrintComponent {
  readonly print = inject(BillPrintService);
}
