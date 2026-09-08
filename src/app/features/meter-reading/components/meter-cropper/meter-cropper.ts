import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import {
  CropperPosition,
  Dimensions,
  ImageCropperComponent,
  ImageCroppedEvent,
  ImageTransform,
  LoadedImage,
} from 'ngx-image-cropper';

import { MeterCropBox, MeterReadingService } from '../../services/meter-reading.service';

/** การหมุน/พลิกที่ไลบรารีทำให้ภาพตาม EXIF — ไลบรารีไม่ได้ export ชนิดนี้ออกมาตรง ๆ */
export type CropperExifTransform = LoadedImage['exifTransform'];

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
 * หมุนกรอบที่โมเดลชี้ ให้ตรงกับภาพที่คนเห็นบนจอ
 *
 * ═══ ทำไมกรอบถึงไม่ตรงตั้งแต่แรก ═══
 *
 * vision service อ่านรูปด้วย PIL ซึ่ง **ไม่หมุนภาพตาม EXIF Orientation** พิกัดที่ได้จึงเป็น
 * ของภาพ "ตามที่เก็บในไฟล์" ส่วน ngx-image-cropper หมุนภาพตาม EXIF ให้ก่อนแสดงเสมอ
 * รูปที่ถ่ายแนวตั้งจากมือถือ (ซึ่งคือรูปเกือบทั้งหมดในงานนี้) จึงต่างกันอยู่ 90 องศา
 * เอากรอบมาวางตรง ๆ แล้วมันจะไปโผล่คนละมุมของภาพ ดูเหมือน AI จับพลาด ทั้งที่จับถูก
 *
 * ลำดับหมุนก่อนแล้วค่อยพลิก ตามที่ ngx-image-cropper วาดลง canvas (rotate ก่อน scale(-1))
 * สลับลำดับเมื่อไหร่ รูปที่มีทั้ง rotate และ flip จะเพี้ยนแบบที่หาสาเหตุยากมาก
 */
export function mapBoxThroughExif(box: MeterCropBox, exif: CropperExifTransform | null): MeterCropBox {
  const quarters = (((exif?.rotate ?? 0) % 4) + 4) % 4;
  let { x, y, w, h } = box;

  for (let turn = 0; turn < quarters; turn++) {
    // หมุนตามเข็ม 90°: มุมซ้ายบนไปอยู่ขวาบน → (x, y) กลายเป็น (1 - y, x) และด้านกว้าง/สูงสลับกัน
    const nextX = 1 - (y + h);
    const nextY = x;
    x = nextX;
    y = nextY;
    [w, h] = [h, w];
  }

  if (exif?.flip) {
    x = 1 - (x + w);
  }

  return { ...box, x, y, w, h };
}

/**
 * กรอบสัดส่วน 0-1 → พิกัดพิกเซลบนกรอบครอป โดยยืดให้ได้สัดส่วนที่เลือกไว้
 *
 * ═══ ทำไมต้องยืด ไม่ใช่ใช้กรอบของโมเดลตรง ๆ ═══
 *
 * กรอบครอปล็อกสัดส่วนไว้ (3:1 / 4:1 ตามรูปทรงของแถวตัวเลข) กรอบที่ส่งเข้าไปโดยสัดส่วนไม่ตรง
 * จะถูกไลบรารีจัดใหม่เอง ซึ่งวิธีจัดของมันคือ "หด" ด้านที่เกิน = เฉือนตัวเลขที่โมเดลเพิ่งชี้ทิ้ง
 * ที่นี่จึงยืดด้านที่แคบออกแทน กรอบได้สัดส่วนตามที่ล็อกไว้โดยไม่มีหลักไหนหลุดออกนอกกรอบ
 *
 * หดเฉพาะตอนกรอบใหญ่เกินภาพเท่านั้น (ถ่ายจ่อจนตัวเลขเต็มเฟรม) — หดพร้อมกันทั้งสองด้าน
 * เพื่อคงสัดส่วน แล้วค่อยดันกลับเข้าในภาพ
 */
export function fitBoxToRatio(box: MeterCropBox, ratio: number, size: Dimensions): CropperPosition {
  const maxWidth = size.width;
  const maxHeight = size.height;
  const target = ratio > 0 ? ratio : 1;

  if (maxWidth <= 0 || maxHeight <= 0) {
    return { x1: 0, y1: 0, x2: 0, y2: 0 };
  }

  let width = box.w * maxWidth;
  let height = box.h * maxHeight;

  if (width / height < target) {
    width = height * target;
  } else {
    height = width / target;
  }

  if (width > maxWidth) {
    width = maxWidth;
    height = width / target;
  }
  if (height > maxHeight) {
    height = maxHeight;
    width = height * target;
  }

  // ยึดจุดกึ่งกลางของกรอบเดิมไว้ ตัวเลขจะได้อยู่กลางกรอบหลังยืด แล้วค่อยดันเข้าในภาพ
  const centerX = (box.x + box.w / 2) * maxWidth;
  const centerY = (box.y + box.h / 2) * maxHeight;
  const x1 = Math.round(Math.min(Math.max(centerX - width / 2, 0), maxWidth - width));
  const y1 = Math.round(Math.min(Math.max(centerY - height / 2, 0), maxHeight - height));

  return { x1, y1, x2: Math.round(x1 + width), y2: Math.round(y1 + height) };
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
 * ═══ กรอบเริ่มต้นมาจากโมเดล (auto-crop) ═══
 *
 * ได้รูปมาปุ๊บจะยิงถามโมเดลก่อนว่าแถวตัวเลขอยู่ตรงไหน แล้วเอามาตั้งเป็นกรอบเริ่มต้นให้เลย
 * คนที่ยืนจดกลางแดดจึงเหลือแค่ "ดูว่าตรงไหม" แทนที่จะต้องลากเองทุกใบ — และกรอบที่ลากเร็ว ๆ
 * คือต้นเหตุของการครอปติดเลขแดง ซึ่งทำให้ยอดคลาด 1,000 เท่า
 *
 * กรอบที่ได้มาเป็นแค่จุดตั้งต้น **ลากปรับทับได้เสมอ** (คราบโคลน แสงสะท้อน มุมเอียง ทำให้
 * โมเดลจับพลาดได้) และถ้าโมเดลไม่ตอบ/ไม่เจอ ทุกอย่างถอยกลับไปเป็นกรอบกลางภาพแบบเดิม
 * ไม่มีการบล็อกหรือขึ้น error เพราะนี่เป็นตัวช่วย ไม่ใช่ขั้นตอนที่ขาดไม่ได้
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

  /**
   * แถบที่ใช้ตั้งกรอบเมื่อโมเดลชี้ไม่ได้ — สัดส่วนของภาพ (0-1)
   *
   * ═══ ทำไมห้ามปล่อยให้กรอบไปอยู่กลางภาพ ═══
   *
   * กลางหน้าปัดมิเตอร์น้ำคือที่อยู่ของ**เข็มแดงกับโลโก้** ไม่ใช่แถวตัวเลข กรอบที่ตกลง
   * ตรงกลาง (ค่าเริ่มต้นของไลบรารี) จึงครอบของที่ไม่ต้องการมาเต็ม ๆ ทุกครั้งที่โมเดลพลาด
   * แล้วคนต้องลากขึ้นเองทุกใบ — ซึ่งเป็นงานที่ทำซ้ำวันละหลายสิบครั้ง
   *
   * แถบตัวเลขอยู่เหนือเข็มแดงแต่ไม่ได้สูงถึงขอบบน — ของเดิมตั้งไว้ 25-45% ซึ่งสูงเกิน
   * รูปที่ถ่ายเต็มหน้าปัด (กรอบไปคร่อมตัวหนังสือบนฝาครอบแทน) ขยับลงมาที่ 35-55%
   * แล้วยืดเป็น 4:1 กรอบจะตกที่แถวเลขบ่อยกว่า และยังไม่ต่ำจนกินเข็มแดงที่กลางหน้าปัด
   */
  static readonly FALLBACK_BAND = { x: 0.2, y: 0.35, w: 0.6, h: 0.2 };

  /**
   * แถบของปุ่ม "จัดกรอบไปที่แถบตัวเลข" — ระดับเดียวกับแถบสำรองแต่แคบกว่า
   *
   * ปุ่มนี้เป็นทางลัดของคนที่เห็นแล้วว่ากรอบไปผิดที่ ต้องให้ผลต่างจากแถบสำรองพอที่จะ
   * เห็นว่า "กดแล้วมีอะไรเกิดขึ้น" แม้ตอนที่กรอบค้างอยู่ในแถบสำรองอยู่แล้ว —
   * แคบลงยังได้ของแถมคือครอบเฉพาะแถวตัวเลขแน่นขึ้น ซึ่งเป็นสิ่งที่โมเดลอ่านง่ายที่สุด
   */
  static readonly SNAP_BAND = { x: 0.25, y: 0.4, w: 0.5, h: 0.15 };

  /** ไฟล์ต้นฉบับจากหน้าที่เรียกใช้ — ไม่ส่งมาก็ได้ คอมโพเนนต์มีปุ่มเลือกรูปของตัวเอง */
  readonly file = input<File | null>(null);

  /** ปิดปุ่มทั้งหมดระหว่างที่ผู้เรียกกำลังยิงงานอยู่ */
  readonly busy = input<boolean>(false);

  readonly cropped = output<MeterCropResult>();
  readonly cancelled = output<void>();

  /** สัดส่วนที่เลือกได้ — กว้าง:สูง ของแถวตัวเลข */
  readonly ratios = [
    { value: 4, label: '4:1' },
    { value: 3, label: '3:1' },
  ];

  /** สัดส่วนตั้งต้น — ใช้ตอนเปิดหน้าและตอนกดปุ่มจัดกรอบ */
  static readonly DEFAULT_RATIO = 4;

  readonly ratio = signal(MeterCropperComponent.DEFAULT_RATIO);
  readonly rotation = signal(0);
  readonly preview = signal<string | null>(null);
  readonly cropWidth = signal(0);
  readonly cropHeight = signal(0);
  readonly loadFailed = signal(false);

  /**
   * ให้โมเดลตั้งกรอบเริ่มต้นให้เมื่อได้รูปใหม่ (auto-crop) — ปิดได้เมื่อผู้เรียกยิงเองอยู่แล้ว
   *
   * ปิดแล้วทุกอย่างทำงานเหมือนเดิมทุกประการ คือขึ้นกรอบกลางภาพให้คนลากเอง
   */
  readonly autoDetect = input<boolean>(true);

  /** กำลังถามโมเดลว่ากรอบอยู่ตรงไหน — โชว์ให้คนรู้ว่าอย่าเพิ่งรีบลาก */
  readonly detecting = signal(false);

  /** กรอบที่โมเดลชี้ (สัดส่วนของภาพต้นฉบับ) — null = ยังไม่ได้ถาม/ถามแล้วไม่เจอ */
  readonly autoBox = signal<MeterCropBox | null>(null);

  /** กรอบที่เห็นอยู่ตอนนี้มาจากแถบสำรอง ไม่ใช่จากโมเดล — ต้องบอกคนให้ตรวจหนักกว่าปกติ */
  readonly usedFallback = signal(false);

  /**
   * กรอบที่ส่งให้ไลบรารีจริง (พิกเซลบนภาพที่ย่อแล้ว) — undefined = ปล่อยกรอบกลางภาพตามเดิม
   *
   * ตั้งครั้งเดียวตอนได้กรอบจากโมเดล จากนั้นไม่แตะอีกเลย ให้ไลบรารีถือสถานะต่อ
   * ไม่งั้นทุกครั้งที่ค่าใน component ขยับ กรอบจะเด้งกลับไปที่เดิม ทับสิ่งที่คนเพิ่งลาก
   */
  readonly cropBox = signal<CropperPosition | undefined>(undefined);

  /** การหมุนที่ไลบรารีทำให้ภาพตาม EXIF — ต้องเอามาหมุนกรอบตามด้วย ไม่งั้นกรอบไปคนละมุม */
  private readonly exif = signal<CropperExifTransform | null>(null);

  /** ขนาดของภาพที่แสดงจริงบนจอ (พิกเซล) — กรอบครอปคิดพิกัดบนขนาดนี้ ไม่ใช่ขนาดไฟล์ */
  private readonly displaySize = signal<Dimensions | null>(null);

  private readonly readings = inject(MeterReadingService);

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

  /** ข้อความบอกสถานะกรอบอัตโนมัติ — null = ไม่มีอะไรต้องบอก (คนลากเองอยู่แล้ว) */
  readonly autoBoxNote = computed<string | null>(() => {
    if (this.detecting()) return 'ระบบกำลังค้นหาแถวตัวเลข...';

    const box = this.autoBox();
    if (!box) {
      return this.usedFallback()
        ? 'ระบบค้นหาแถวตัวเลขไม่พบ — วางกรอบไว้เหนือกึ่งกลางภาพให้ก่อน (ตำแหน่งมาตรฐานของแถบตัวเลข) กรุณาปรับกรอบให้ตรงก่อนยืนยัน'
        : null;
    }

    // กรอบที่มาจาก border คือ "ทั้งแถบเลขมิเตอร์" ซึ่งยังไม่ได้ตัดเลขทศนิยมสีแดงออก
    // ต้องบอกให้ชัดว่าอันนี้ต้องหดเอง ไม่ใช่กดยืนยันต่อได้เลยเหมือนกรอบของเลขสีดำ
    return box.source === 'border'
      ? 'ระบบวางกรอบให้เบื้องต้นแล้ว — กรอบนี้ยังรวมเลขทศนิยมสีแดงอยู่ กรุณาย่อกรอบให้เหลือเฉพาะเลขสีดำก่อนยืนยัน'
      : 'ระบบวางกรอบให้แล้ว — กรุณาตรวจสอบว่าครอบเลขสีดำครบทุกหลัก ปรับกรอบได้ตามต้องการ';
  });

  constructor() {
    // ได้รูปใหม่เมื่อไหร่ถามกรอบใหม่ทันที — กรอบของรูปเก่าใช้กับรูปใหม่ไม่ได้เลย
    effect(() => {
      const file = this.source();
      const enabled = this.autoDetect();
      untracked(() => this.requestAutoBox(file, enabled));
    });

    // วางกรอบเมื่อรู้ขนาดที่แสดงจริงแล้ว และการถามโมเดลจบแล้ว (จะเจอหรือไม่เจอก็ตาม)
    //
    // ⚠️ ไม่มีทางออกที่ "ไม่ทำอะไรเลย" — ปล่อยไว้แปลว่าไลบรารีตั้งกรอบไว้กลางภาพ
    //    ซึ่งคือตำแหน่งของเข็มแดงกับโลโก้ ไม่ใช่แถวตัวเลข (ดู FALLBACK_BAND)
    effect(() => {
      const box = this.autoBox();
      const size = this.displaySize();
      const detecting = this.detecting();
      if (!size || detecting) return;

      // อ่าน ratio/exif แบบ untracked — ไม่งั้นทุกครั้งที่คนกดเปลี่ยนสัดส่วน กรอบจะเด้ง
      // กลับไปที่ AI ชี้ ทับกรอบที่คนเพิ่งลากปรับเอง ซึ่งเป็นสิ่งเดียวที่ต้องเคารพที่สุด
      untracked(() => {
        if (box) {
          this.usedFallback.set(false);
          const mapped = mapBoxThroughExif(box, this.exif());
          this.cropBox.set(fitBoxToRatio(mapped, this.ratio(), size));
          return;
        }

        // แถบสำรองเป็นพิกัดของภาพที่คนเห็นอยู่แล้ว (ไม่ได้มาจากไฟล์) จึงไม่ต้องหมุนตาม EXIF
        this.usedFallback.set(true);
        this.cropBox.set(
          fitBoxToRatio(
            { ...MeterCropperComponent.FALLBACK_BAND, source: 'digits' },
            this.ratio(),
            size,
          ),
        );
      });
    });
  }

  /**
   * ถามโมเดลว่าแถวตัวเลขอยู่ตรงไหนของรูปใบนี้
   *
   * ผลของรูปใบเก่าที่ตอบกลับมาช้าต้องถูกทิ้ง ไม่ใช่เอามาตั้งกรอบให้รูปใบใหม่ —
   * คนที่กดเปลี่ยนรูปเร็ว ๆ จะได้กรอบของรูปก่อนหน้ามาวางทับ แล้วครอปผิดตำแหน่งโดยไม่รู้ตัว
   */
  private requestAutoBox(file: File | null, enabled: boolean): void {
    this.autoBox.set(null);
    this.cropBox.set(undefined);

    if (!file || !enabled) {
      this.detecting.set(false);
      return;
    }

    this.detecting.set(true);
    this.readings.detectCropBox(file).subscribe((box) => {
      if (this.source() !== file) return;

      this.detecting.set(false);
      this.autoBox.set(box);
    });
  }

  /**
   * ดันกรอบขึ้นไปจับแถบตัวเลขทันที (ปุ่ม 🎯)
   *
   * มีไว้สำหรับตอนที่กรอบไปผิดที่ — โมเดลจับโดนคราบโคลน/แสงสะท้อน หรือคนเผลอลากจนหลง
   * กดแล้วได้ตำแหน่งมาตรฐานกลับมาใน 1 คลิก เร็วกว่าลากหาเองซึ่งต้องทำทีละใบ
   *
   * ทำงานได้เสมอหลังภาพขึ้นจอ ไม่สนใจว่าโมเดลตอบอะไรมา — ปุ่มที่กดแล้วเงียบบางครั้ง
   * แย่กว่าไม่มีปุ่ม เพราะคนจะไม่รู้ว่าต้องกดซ้ำหรือไปลากเอง
   *
   * ดึงสัดส่วนกลับเป็น 4:1 ให้ด้วย — คนที่กดปุ่มนี้คือคนที่กรอบเพี้ยนอยู่ ถ้าเพี้ยนเพราะ
   * เผลอสลับไป 3:1 (กรอบสูงขึ้น กินเข็มแดงง่าย) การจัดกรอบเฉย ๆ จะยังเพี้ยนเหมือนเดิม
   */
  quickSnap(): void {
    const size = this.displaySize();
    if (!size || this.busy()) return;

    this.ratio.set(MeterCropperComponent.DEFAULT_RATIO);
    this.usedFallback.set(true);
    this.cropBox.set(
      fitBoxToRatio(
        { ...MeterCropperComponent.SNAP_BAND, source: 'digits' },
        MeterCropperComponent.DEFAULT_RATIO,
        size,
      ),
    );
  }

  /** ไลบรารีหมุนภาพตาม EXIF ให้แล้ว — จำค่าที่มันหมุนไว้ เพื่อหมุนกรอบตามให้ตรงกัน */
  onImageLoaded(loaded: LoadedImage): void {
    this.exif.set(loaded.exifTransform ?? null);
  }

  /** รู้ขนาดที่แสดงจริงตอนนี้ — กรอบครอปคิดเป็นพิกเซลบนขนาดนี้ ไม่ใช่ขนาดของไฟล์ */
  onCropperReady(dimensions: Dimensions): void {
    this.displaySize.set(dimensions);
  }

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
    this.autoBox.set(null);
    this.cropBox.set(undefined);
    this.detecting.set(false);
    this.usedFallback.set(false);
    this.exif.set(null);
    this.displaySize.set(null);
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
