import { CommonModule } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';
import { ImageCropperComponent, ImageCroppedEvent, ImageTransform } from 'ngx-image-cropper';

/** ผลลัพธ์ที่ส่งออกไปเมื่อกดยืนยัน — มีให้ทั้งสองรูปแบบเพราะปลายทางใช้คนละอย่าง */
export interface MeterCropResult {
  /** data:image/jpeg;base64,... — ใช้กับ POST /bills/scan (ฟิลด์ meter_photo) */
  dataUrl: string;
  /** ก้อนไฟล์เดียวกัน — ใช้กับ endpoint ที่รับ multipart (ocr-upload, scan-batch, แก้บิล) */
  blob: Blob;
  fileName: string;
  /** ขนาดจริงของภาพที่ครอปได้ (พิกเซล) — เก็บไว้ให้ผู้เรียกตัดสินใจต่อได้ */
  width: number;
  height: number;
}

/**
 * ครอบเฉพาะแถวตัวเลขบนหน้าปัด ก่อนส่งให้โมเดลอ่าน
 *
 * ═══ ทำไมต้องครอปก่อนส่ง ═══
 *
 * โมเดลอ่านเลขจากทั้งภาพ รูปที่ถ่ายมาทั้งหน้าปัดจึงมีทั้งเลขทะเบียนมิเตอร์ ตัวหนังสือ
 * บนฝาครอบ และเข็มแดงปนอยู่ ยิ่งมีอะไรอยู่ในภาพมาก โอกาสอ่านหลักเกินยิ่งสูง
 * การครอปให้เหลือเฉพาะแถวตัวเลขสีดำจึงเป็นวิธีที่ถูกที่สุดในการเพิ่มความแม่น
 *
 * ═══ ทำไมล็อกสัดส่วน ═══
 *
 * หน้าปัดมิเตอร์เป็นแถบแนวนอน กรอบอิสระทำให้คนลากเผลอกินเข็มแดง (ทศนิยม) เข้ามาด้วย
 * ซึ่งเป็นความผิดพลาดที่ทำให้ยอดคลาด 1,000 เท่า (25.312 → 25312 ดู docs/api.md ของหลังบ้าน)
 * สัดส่วน 3:1 / 4:1 บังคับให้กรอบเป็นแถบเตี้ย ๆ ตามรูปทรงของแถวตัวเลขจริง
 *
 * ⚠️ ภาพที่ครอปแล้ว **ไม่มี EXIF** (canvas วาดพิกเซลใหม่ metadata ไม่ติดไปด้วย)
 *    พิกัด/เวลาถ่ายต้องอ่านจากไฟล์ต้นฉบับก่อนเสมอ อย่าหวังจะได้จากภาพที่ออกจากที่นี่
 */
@Component({
  selector: 'app-meter-cropper',
  standalone: true,
  imports: [CommonModule, ImageCropperComponent],
  templateUrl: './meter-cropper.html',
  styleUrl: './meter-cropper.css',
})
export class MeterCropperComponent {
  /** คุณภาพ JPEG ที่ส่งออก — 80 คือจุดที่ไฟล์เล็กลงมากแต่ขอบตัวเลขยังคม */
  static readonly QUALITY = 80;

  /**
   * ความกว้างสูงสุดของภาพที่ส่งออก (พิกเซล)
   *
   * คู่กับ onlyScaleDown = ภาพเล็กอยู่แล้วจะไม่ถูกขยาย เพราะการขยายไม่ได้เพิ่ม
   * รายละเอียดให้โมเดล มีแต่ทำให้ไฟล์ใหญ่ขึ้นเปล่า ๆ
   */
  static readonly MAX_WIDTH = 1200;

  /** แคบกว่านี้แล้วตัวเลขจะเบลอจนโมเดลอ่านไม่ออก — เตือน แต่ไม่ห้ามกด */
  static readonly MIN_READABLE_WIDTH = 240;

  /** ไฟล์ต้นฉบับจากหน้าที่เรียกใช้ — ไม่ส่งมาก็ได้ คอมโพเนนต์มีปุ่มเลือกรูปของตัวเอง */
  readonly file = input<File | null>(null);

  /** ปิดปุ่มทั้งหมดระหว่างที่ผู้เรียกกำลังยิงงานอยู่ */
  readonly busy = input<boolean>(false);

  readonly cropped = output<MeterCropResult>();
  readonly cancelled = output<void>();

  /** สัดส่วนที่เลือกได้ — กว้าง:สูง ของแถวตัวเลข */
  readonly ratios = [
    { value: 3, label: '3:1' },
    { value: 4, label: '4:1' },
  ];

  readonly ratio = signal(3);
  readonly rotation = signal(0);
  readonly preview = signal<string | null>(null);
  readonly cropWidth = signal(0);
  readonly cropHeight = signal(0);
  readonly loadFailed = signal(false);

  /** ไฟล์ที่เลือกเองในกล่องนี้ — ชนะ input เสมอ เพราะเป็นสิ่งที่คนเพิ่งกดเลือก */
  private readonly picked = signal<File | null>(null);

  readonly source = computed(() => this.picked() ?? this.file());
  readonly transform = computed<ImageTransform>(() => ({ rotate: this.rotation() }));
  readonly tooSmall = computed(
    () => this.cropWidth() > 0 && this.cropWidth() < MeterCropperComponent.MIN_READABLE_WIDTH,
  );

  /** ขนาดไฟล์โดยประมาณของ base64 — 4 ตัวอักษรแทน 3 ไบต์ */
  readonly previewKb = computed(() => {
    const dataUrl = this.preview();
    if (!dataUrl) return 0;
    const body = dataUrl.slice(dataUrl.indexOf(',') + 1);
    return Math.round((body.length * 0.75) / 1024);
  });

  readonly quality = MeterCropperComponent.QUALITY;
  readonly maxWidth = MeterCropperComponent.MAX_WIDTH;

  pickFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this.loadFailed.set(true);
      return;
    }

    this.reset();
    this.picked.set(file);
  }

  onCropped(event: ImageCroppedEvent): void {
    // output="base64" จึงได้ data URL มาตรง ๆ ใช้ทั้งพรีวิวและผลลัพธ์สุดท้ายก้อนเดียวกัน
    // (ถ้าใช้ objectUrl จะต้องมาไล่ revoke เองทุกครั้งที่ลากกรอบ ซึ่งลืมง่ายและรั่วเงียบ)
    this.preview.set(event.base64 ?? null);
    this.cropWidth.set(event.width);
    this.cropHeight.set(event.height);
  }

  onLoadFailed(): void {
    this.loadFailed.set(true);
    this.picked.set(null);
  }

  setRatio(value: number): void {
    this.ratio.set(value);
  }

  rotate(direction: -1 | 1): void {
    // ทวนเข็ม/ตามเข็มทีละ 90° วนกลับมาที่ 0 เสมอ ไม่ให้เลขบวกไปเรื่อย ๆ
    this.rotation.set((this.rotation() + direction * 90 + 360) % 360);
  }

  confirm(): void {
    const dataUrl = this.preview();
    const source = this.source();
    if (!dataUrl || this.busy()) return;

    this.cropped.emit({
      dataUrl,
      blob: MeterCropperComponent.toBlob(dataUrl),
      fileName: source?.name ?? 'meter-crop.jpg',
      width: this.cropWidth(),
      height: this.cropHeight(),
    });
  }

  cancel(): void {
    this.reset();
    this.cancelled.emit();
  }

  private reset(): void {
    this.picked.set(null);
    this.preview.set(null);
    this.cropWidth.set(0);
    this.cropHeight.set(0);
    this.rotation.set(0);
    this.loadFailed.set(false);
  }

  /**
   * data URL → Blob สำหรับ endpoint ที่รับ multipart
   *
   * ไม่ใช้ fetch(dataUrl).blob() เพราะเป็น async ทั้งที่ข้อมูลอยู่ในมือแล้ว —
   * การทำให้ปุ่มยืนยันกลายเป็น async ทำให้ผู้เรียกต้องจัดการสถานะรอเปล่า ๆ
   */
  static toBlob(dataUrl: string): Blob {
    const comma = dataUrl.indexOf(',');
    const mime = /data:([^;,]+)/.exec(dataUrl.slice(0, comma))?.[1] ?? 'image/jpeg';
    const binary = atob(dataUrl.slice(comma + 1));

    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  }
}
