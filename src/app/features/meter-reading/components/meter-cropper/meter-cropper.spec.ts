import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ImageCroppedEvent } from 'ngx-image-cropper';

import { MeterCropperComponent } from './meter-cropper';

/** เหตุการณ์ครอปหนึ่งครั้งแบบที่ ngx-image-cropper ส่งออกมาเมื่อ output = base64 */
const croppedEvent = (base64: string, width: number, height = 120): ImageCroppedEvent => ({
  base64,
  width,
  height,
  cropperPosition: { x1: 0, y1: 0, x2: 0, y2: 0 },
  imagePosition: { x1: 0, y1: 0, x2: 0, y2: 0 },
});

/** data URL ของ JPEG ก้อนเล็ก ๆ ที่ decode ได้จริง (ไม่ใช่สตริงมั่ว) */
const JPEG_DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA==';

describe('MeterCropperComponent', () => {
  let component: MeterCropperComponent;
  let fixture: ComponentFixture<MeterCropperComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MeterCropperComponent] }).compileComponents();

    fixture = TestBed.createComponent(MeterCropperComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('เริ่มที่สัดส่วน 3:1 — หน้าปัดเป็นแถบแนวนอน ไม่ใช่จัตุรัส', () => {
    expect(component.ratio()).toBe(3);
    expect(component.ratios.map((option) => option.value)).toEqual([3, 4]);
  });

  it('ลากกรอบแล้วได้พรีวิวทันที พร้อมขนาดจริงของภาพ', () => {
    component.onCropped(croppedEvent(JPEG_DATA_URL, 900, 300));

    expect(component.preview()).toBe(JPEG_DATA_URL);
    expect(component.cropWidth()).toBe(900);
    expect(component.cropHeight()).toBe(300);
  });

  it('กรอบแคบกว่าเกณฑ์ที่โมเดลอ่านออก → เตือน', () => {
    component.onCropped(croppedEvent(JPEG_DATA_URL, 180));
    expect(component.tooSmall()).toBe(true);

    component.onCropped(croppedEvent(JPEG_DATA_URL, 900));
    expect(component.tooSmall()).toBe(false);
  });

  it('ยังไม่ได้ครอป กดยืนยันแล้วต้องไม่ส่งอะไรออกไป', () => {
    const emitted: unknown[] = [];
    component.cropped.subscribe((result) => emitted.push(result));

    component.confirm();

    expect(emitted).toHaveLength(0);
  });

  it('กดยืนยันแล้วส่งออกทั้ง data URL และ Blob ของก้อนเดียวกัน', async () => {
    const results: { dataUrl: string; blob: Blob; width: number }[] = [];
    component.cropped.subscribe((result) => results.push(result));

    component.onCropped(croppedEvent(JPEG_DATA_URL, 900, 300));
    component.confirm();

    expect(results).toHaveLength(1);
    expect(results[0].dataUrl).toBe(JPEG_DATA_URL);
    expect(results[0].blob.type).toBe('image/jpeg');
    // ก้อนไบต์ต้องตรงกับ base64 ที่ครอปได้ ไม่ใช่ไฟล์ว่าง
    expect(results[0].blob.size).toBeGreaterThan(0);
    expect(results[0].width).toBe(900);
  });

  it('หมุนแล้ววนกลับมาที่ 0 เสมอ ไม่สะสมเป็นเลขบวกไปเรื่อย ๆ', () => {
    component.rotate(1);
    expect(component.rotation()).toBe(90);
    expect(component.transform()).toEqual({ rotate: 90 });

    component.rotate(-1);
    component.rotate(-1);
    expect(component.rotation()).toBe(270);
  });

  it('ยกเลิกแล้วล้างสถานะทิ้งทั้งหมด — รูปเก่าต้องไม่ค้างไปรอบถัดไป', () => {
    let cancelled = 0;
    component.cancelled.subscribe(() => cancelled++);

    component.onCropped(croppedEvent(JPEG_DATA_URL, 900));
    component.rotate(1);
    component.cancel();

    expect(component.preview()).toBeNull();
    expect(component.cropWidth()).toBe(0);
    expect(component.rotation()).toBe(0);
    expect(cancelled).toBe(1);
  });
});
