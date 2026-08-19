import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ImageCroppedEvent, LoadedImage } from 'ngx-image-cropper';

import { MeterCropBox } from '../../services/meter-reading.service';
import { MeterCropperComponent, fitBoxToRatio, mapBoxThroughExif } from './meter-cropper';

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

/** กรอบที่โมเดลชี้ — สัดส่วนของภาพ ไม่ใช่พิกเซล */
const box = (x: number, y: number, w: number, h: number): MeterCropBox => ({
  x,
  y,
  w,
  h,
  source: 'digits',
});

/** LoadedImage เท่าที่คอมโพเนนต์ใช้จริง (แค่ค่าการหมุนตาม EXIF) */
const loadedImage = (rotate: number, flip = false) =>
  ({ exifTransform: { rotate, flip } }) as LoadedImage;

const photoFile = (name = 'meter.jpg') =>
  new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' });

const OCR_URL = '/meter-readings/ocr-upload';

describe('mapBoxThroughExif — หมุนกรอบให้ตรงกับภาพที่คนเห็น', () => {
  it('ไม่มีการหมุน → กรอบเท่าเดิม', () => {
    expect(mapBoxThroughExif(box(0.1, 0.2, 0.3, 0.4), { rotate: 0, flip: false })).toMatchObject({
      x: 0.1,
      y: 0.2,
      w: 0.3,
      h: 0.4,
    });
  });

  it('หมุนตามเข็ม 90° → มุมซ้ายบนไปอยู่ขวาบน และด้านกว้าง/สูงสลับกัน', () => {
    // กรอบชิดมุมซ้ายบนของไฟล์ พอภาพถูกหมุนตามเข็ม มันต้องไปโผล่มุมขวาบน
    expect(mapBoxThroughExif(box(0, 0, 0.2, 0.5), { rotate: 1, flip: false })).toMatchObject({
      x: 0.5,
      y: 0,
      w: 0.5,
      h: 0.2,
    });
  });

  it('หมุน 180° → กรอบไปอยู่ตรงข้ามทั้งสองแกน ขนาดเท่าเดิม', () => {
    const mapped = mapBoxThroughExif(box(0.1, 0.2, 0.3, 0.4), { rotate: 2, flip: false });

    expect(mapped.x).toBeCloseTo(0.6, 6);
    expect(mapped.y).toBeCloseTo(0.4, 6);
    expect(mapped.w).toBeCloseTo(0.3, 6);
    expect(mapped.h).toBeCloseTo(0.4, 6);
  });

  it('พลิกซ้าย-ขวาทำหลังหมุน — สลับลำดับแล้วรูปที่มีทั้งสองอย่างจะเพี้ยน', () => {
    // หมุน 90° ก่อนได้กรอบชิดขวา (x = 0.5) แล้วพลิกจึงกลับมาชิดซ้าย
    expect(mapBoxThroughExif(box(0, 0, 0.2, 0.5), { rotate: 1, flip: true })).toMatchObject({
      x: 0,
      y: 0,
      w: 0.5,
      h: 0.2,
    });
  });
});

describe('fitBoxToRatio — กรอบสัดส่วน → พิกเซลบนภาพที่แสดง', () => {
  it('ยืดด้านที่แคบให้ได้สัดส่วนที่ล็อกไว้ โดยไม่เฉือนของเดิม', () => {
    // กรอบ 200×200 px บนภาพ 1000×500 → ต้องกลายเป็น 600×200 (3:1) คร่อมจุดกึ่งกลางเดิม
    const position = fitBoxToRatio(box(0.4, 0.3, 0.2, 0.4), 3, { width: 1000, height: 500 });

    expect(position.x2 - position.x1).toBe(600);
    expect(position.y2 - position.y1).toBe(200);
    expect((position.x1 + position.x2) / 2).toBe(500);
    expect((position.y1 + position.y2) / 2).toBe(250);
  });

  it('กรอบชิดขอบ → ดันเข้ามาในภาพ ไม่ยื่นออกไปติดลบ', () => {
    const position = fitBoxToRatio(box(0, 0.4, 0.1, 0.2), 3, { width: 1000, height: 500 });

    expect(position.x1).toBeGreaterThanOrEqual(0);
    expect(position.y1).toBeGreaterThanOrEqual(0);
    expect(position.x2).toBeLessThanOrEqual(1000);
    expect(position.y2).toBeLessThanOrEqual(500);
  });

  it('กรอบใหญ่เกินภาพ → หดพร้อมกันทั้งสองด้าน สัดส่วนต้องไม่เพี้ยน', () => {
    const position = fitBoxToRatio(box(0, 0, 1, 1), 3, { width: 900, height: 600 });

    expect(position.x2 - position.x1).toBe(900);
    expect(position.y2 - position.y1).toBe(300);
  });
});

describe('MeterCropperComponent', () => {
  let component: MeterCropperComponent;
  let fixture: ComponentFixture<MeterCropperComponent>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MeterCropperComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(MeterCropperComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  it('เริ่มที่สัดส่วน 4:1 — หน้าปัดเป็นแถบแนวนอน ไม่ใช่จัตุรัส', () => {
    expect(component.ratio()).toBe(4);
    expect(component.ratios.map((option) => option.value)).toEqual([4, 3]);
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

  describe('กรอบเริ่มต้นจากโมเดล (auto-crop)', () => {
    /** ใส่รูปให้คอมโพเนนต์แล้วรอจน effect ยิงคำขอออกไป */
    const withPhoto = async (file = photoFile()) => {
      fixture.componentRef.setInput('file', file);
      await fixture.whenStable();
      return file;
    };

    it('ได้รูปใหม่ → ถามโมเดลทันทีว่าแถวตัวเลขอยู่ตรงไหน', async () => {
      await withPhoto();

      const request = http.expectOne((req) => req.url.endsWith(OCR_URL));
      expect(request.request.method).toBe('POST');
      expect(component.detecting()).toBe(true);

      request.flush({ crop_box: null });
    });

    it('ปิด autoDetect → ต้องไม่ยิงอะไรเลย (ผู้เรียกบางหน้ายิงเองอยู่แล้ว)', async () => {
      fixture.componentRef.setInput('autoDetect', false);
      await withPhoto();

      http.expectNone((req) => req.url.endsWith(OCR_URL));
      expect(component.detecting()).toBe(false);
    });

    it('ได้กรอบมาแล้วภาพก็โหลดเสร็จ → ตั้งกรอบครอปเป็นพิกเซลของภาพที่แสดงจริง', async () => {
      await withPhoto();

      component.onImageLoaded(loadedImage(0));
      component.onCropperReady({ width: 1000, height: 500 });
      http.expectOne((req) => req.url.endsWith(OCR_URL)).flush({ crop_box: box(0.4, 0.3, 0.2, 0.4) });
      await fixture.whenStable();

      // 200×200 px ยืดเป็น 4:1 → 800×200 คร่อมจุดกึ่งกลางเดิม
      expect(component.cropBox()).toEqual({ x1: 100, y1: 150, x2: 900, y2: 350 });
      expect(component.detecting()).toBe(false);
    });

    it('รูปแนวตั้งที่ EXIF บอกให้หมุน → กรอบต้องหมุนตาม ไม่ใช่วางทับดิบ ๆ', async () => {
      await withPhoto();

      component.onImageLoaded(loadedImage(1));
      component.onCropperReady({ width: 1000, height: 1000 });
      http.expectOne((req) => req.url.endsWith(OCR_URL)).flush({ crop_box: box(0, 0, 0.2, 0.5) });
      await fixture.whenStable();

      // กรอบชิดซ้ายบนของไฟล์ พอหมุนตามเข็มต้องไปอยู่ครึ่งขวาของภาพที่คนเห็น
      // (ถ้าลืมหมุน กรอบจะกางเต็มความกว้างแล้วได้ x1 = 0 ซึ่งเป็นอาการที่เจอจริงบนมือถือ)
      expect(component.cropBox()).toEqual({ x1: 200, y1: 0, x2: 1000, y2: 200 });
    });

    it('โมเดลไม่ตอบ → ไม่ขึ้น error ขวางคนทำงาน แต่ต้องไม่ปล่อยกรอบไว้กลางภาพ', async () => {
      await withPhoto();

      component.onCropperReady({ width: 1000, height: 500 });
      http
        .expectOne((req) => req.url.endsWith(OCR_URL))
        .error(new ProgressEvent('network error'));
      await fixture.whenStable();

      // กลางหน้าปัดคือเข็มแดงกับโลโก้ ไม่ใช่แถวตัวเลข — กรอบต้องไปอยู่ครึ่งบน
      const box = component.cropBox()!;
      expect((box.y1 + box.y2) / 2).toBeLessThan(250);
      expect(component.usedFallback()).toBe(true);
      expect(component.autoBoxNote()).toContain('เหนือกลางภาพ');
      expect(component.loadFailed()).toBe(false);
    });

    it('โมเดลตอบว่าไม่เจอกรอบ → ใช้แถบสำรอง 35-55% ไม่ใช่กรอบกลางภาพ', async () => {
      await withPhoto();

      component.onCropperReady({ width: 1000, height: 500 });
      http.expectOne((req) => req.url.endsWith(OCR_URL)).flush({ crop_box: null });
      await fixture.whenStable();

      expect(component.cropBox()).toEqual({ x1: 200, y1: 150, x2: 800, y2: 300 });
      expect(component.usedFallback()).toBe(true);
    });

    it('ปิด autoDetect → ตั้งแถบสำรองให้ทันทีโดยไม่ต้องยิงถามใคร', async () => {
      fixture.componentRef.setInput('autoDetect', false);
      await withPhoto();

      component.onCropperReady({ width: 1000, height: 500 });
      await fixture.whenStable();

      expect(component.usedFallback()).toBe(true);
      expect(component.cropBox()).toBeDefined();
    });

    it('ระหว่างที่ยังถามโมเดลอยู่ ต้องยังไม่วางแถบสำรอง — ไม่งั้นกรอบจะกระพริบสองที', async () => {
      await withPhoto();

      component.onCropperReady({ width: 1000, height: 500 });
      await fixture.whenStable();

      expect(component.cropBox()).toBeUndefined();

      http.expectOne((req) => req.url.endsWith(OCR_URL)).flush({ crop_box: null });
    });

    it('ปุ่มจัดกรอบ: กดแล้วกรอบกระโดดไปแถบตัวเลขด้านบน ต่างจากแถบสำรองที่วางไว้ตอนแรก', async () => {
      await withPhoto();

      component.onCropperReady({ width: 1000, height: 500 });
      http.expectOne((req) => req.url.endsWith(OCR_URL)).flush({ crop_box: null });
      await fixture.whenStable();

      const fallback = component.cropBox()!;
      component.quickSnap();
      const snapped = component.cropBox()!;

      expect(snapped).not.toEqual(fallback);
      // อยู่ครึ่งบนเหมือนกัน แต่แคบกว่า — ครอบเฉพาะแถวตัวเลขแน่นขึ้น
      expect((snapped.y1 + snapped.y2) / 2).toBeLessThan(250);
      expect(snapped.x2 - snapped.x1).toBeLessThan(fallback.x2 - fallback.x1);
    });

    it('ปุ่มจัดกรอบดึงสัดส่วนกลับเป็น 4:1 — กรอบ 3:1 ที่คนเผลอสลับไว้กินเข็มแดงง่าย', async () => {
      await withPhoto();

      component.onCropperReady({ width: 1000, height: 500 });
      http.expectOne((req) => req.url.endsWith(OCR_URL)).flush({ crop_box: null });
      await fixture.whenStable();

      component.setRatio(3);
      component.quickSnap();

      const box = component.cropBox()!;
      expect(component.ratio()).toBe(4);
      expect((box.x2 - box.x1) / (box.y2 - box.y1)).toBeCloseTo(4);
    });

    it('ปุ่มจัดกรอบใช้ได้แม้โมเดลจะตั้งกรอบให้แล้ว — กรอบที่จับผิดที่ต้องมีทางกลับ', async () => {
      await withPhoto();

      component.onCropperReady({ width: 1000, height: 500 });
      http
        .expectOne((req) => req.url.endsWith(OCR_URL))
        .flush({ crop_box: box(0.1, 0.7, 0.2, 0.2) });
      await fixture.whenStable();

      // โมเดลจับไปอยู่ครึ่งล่าง (เช่นโดนคราบโคลน) — กดปุ่มแล้วต้องกลับขึ้นมาข้างบน
      expect((component.cropBox()!.y1 + component.cropBox()!.y2) / 2).toBeGreaterThan(250);

      component.quickSnap();

      expect((component.cropBox()!.y1 + component.cropBox()!.y2) / 2).toBeLessThan(250);
      expect(component.usedFallback()).toBe(true);
    });

    it('เปลี่ยนรูปแล้วผลของใบเก่าตอบช้ามาทีหลัง → ต้องไม่เอามาตั้งกรอบให้ใบใหม่', async () => {
      await withPhoto(photoFile('first.jpg'));
      const stale = http.expectOne((req) => req.url.endsWith(OCR_URL));

      await withPhoto(photoFile('second.jpg'));
      const fresh = http.expectOne((req) => req.url.endsWith(OCR_URL));

      component.onCropperReady({ width: 1000, height: 500 });
      stale.flush({ crop_box: box(0, 0, 0.2, 0.2) });
      await fixture.whenStable();

      expect(component.autoBox()).toBeNull();
      expect(component.cropBox()).toBeUndefined();

      fresh.flush({ crop_box: null });
    });

    it('กรอบที่ได้เป็นแบบ border → ต้องบอกให้หดเอง เพราะยังรวมเลขแดงอยู่', async () => {
      await withPhoto();

      http
        .expectOne((req) => req.url.endsWith(OCR_URL))
        .flush({ crop_box: { ...box(0.2, 0.2, 0.4, 0.2), source: 'border' } });
      await fixture.whenStable();

      expect(component.autoBoxNote()).toContain('เลขทศนิยมสีแดง');
    });
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
