import { Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DeviceLocationService } from '../../services/device-location';
import { LatLng } from '../../services/geo';

/**
 * แถบเทียบตำแหน่ง — "ที่ยืนอยู่ตอนนี้" เทียบกับ "พิกัดที่ติดมากับรูป"
 *
 * ตัวเลขฝั่งเครื่องมาจาก navigator.geolocation ซึ่งเชื่อไม่ได้ (ดู device-location.ts)
 * จึงอยู่ในคอมโพเนนต์แยกที่ทำได้อย่างเดียวคือวาดลงจอ — ไม่มี output ไม่แก้ของใคร
 * เพจที่เอาไปวางจึงไม่มีทางเผลอหยิบค่าไปเซฟ แม้จะเขียนต่อทีหลังก็ตาม
 *
 * ประโยชน์จริงคือคนที่ยืนอยู่หน้ามิเตอร์เห็นทันทีว่ารูปที่เพิ่งแนบมาจากตรงนี้จริงไหม
 * (รูปเก่าในแกลเลอรีที่หยิบผิดใบจะโผล่เป็นระยะห่างหลักร้อยเมตรขึ้นไป)
 */
@Component({
  selector: 'app-device-location',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './device-location.html'
  // สไตล์อยู่ที่ src/styles.css (.device-loc-*) — ใช้ร่วมกับ batch-scan ที่ชน budget แล้ว
})
export class DeviceLocationComponent {
  private device = inject(DeviceLocationService);

  /** พิกัดจาก EXIF ของรูปที่กำลังดูอยู่ — ไม่ส่งมาก็ได้ แค่จะไม่มีระยะให้เทียบ */
  readonly photo = input<LatLng | null>(null);

  /** บอกว่ากำลังเทียบกับรูปของใคร เช่น 'บ้าน 12/3' — ขึ้นบนหัวแถบเฉย ๆ */
  readonly subject = input<string>('');

  readonly status = this.device.status;
  readonly coords = this.device.coords;
  readonly accuracyMeters = this.device.accuracyMeters;
  readonly errorMessage = this.device.errorMessage;
  readonly isCoarse = this.device.isCoarse;
  readonly isSupported = this.device.isSupported;

  private readonly gapMeters = computed(() => this.device.gapFrom(this.photo()));

  /** คำนวณเป็นข้อความไว้เลย — ระยะ 0 เมตรเป็นค่าที่ falsy template จะมองว่า "ไม่มี" */
  readonly gapText = computed(() => {
    const meters = this.gapMeters();
    return meters === null ? null : this.gapLabel(meters);
  });

  /** ไกลเกินกว่าจะเป็นมิเตอร์หลังเดียวกัน — ระบายสีเตือน แต่ไม่ไปห้ามอะไรทั้งนั้น */
  readonly gapIsFar = computed(() => (this.gapMeters() ?? 0) > 100);

  request(): void {
    this.device.request();
  }

  hide(): void {
    this.device.clear();
  }

  /** ระยะไกล ๆ อ่านเป็นกิโลง่ายกว่า — เลขเป็นพันเมตรคนอ่านผ่านตาแล้วนึกภาพไม่ออก */
  gapLabel(meters: number): string {
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)} กม.` : `${Math.round(meters)} ม.`;
  }
}
