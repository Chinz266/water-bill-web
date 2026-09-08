import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { LatLng, distanceMeters, toCoords } from './geo';

/**
 * ตำแหน่งของ "เครื่องที่กำลังเปิดเว็บอยู่" — ของประกอบสายตาล้วน ห้ามบันทึก
 *
 * ทำไมเคยถูกถอดออกทั้งแอป: navigator.geolocation บนเครื่องที่ไม่มี GPS จริง
 * (คอมที่ทำการ หรือมือถือที่ปิดตำแหน่ง) จะเดาจากเน็ตที่ต่ออยู่แล้วคืนพิกัดที่ห่างจาก
 * มิเตอร์จริงเป็นร้อยกิโล ค่าพวกนั้นเคยถูกเขียนทับพิกัดในทะเบียนจนจับคู่รูปผิดบ้าน
 *
 * ทำไมกลับมาได้: คราวนี้ค่าที่ได้ไม่มีทางออกไปไหนเลย — ไม่เข้า payload ที่ยิงหลังบ้าน
 * ไม่เข้าเงื่อนไขออกบิลอัตโนมัติ ไม่ไปทับ EXIF ของรูป มีหน้าที่เดียวคือขึ้นบนจอให้คน
 * ที่ยืนอยู่หน้ามิเตอร์เห็นว่า "รูปที่เพิ่งแนบ อยู่ห่างจากที่ยืนอยู่ตอนนี้กี่เมตร"
 * แหล่งพิกัดที่ระบบเชื่อยังเป็น EXIF ของไฟล์รูปทางเดียวเหมือนเดิม
 *
 * ⚠️ ถ้าวันหลังมีคนอยากเอาค่าจากที่นี่ไปเซฟ — นั่นคือบั๊กเดิมที่เคยทำมาแล้ว อย่าทำ
 */

export type DeviceLocationStatus =
  /** ยังไม่ได้ขอ — เบราว์เซอร์จะยังไม่เด้งถามสิทธิ์จนกว่าคนจะกดเอง */
  | 'idle'
  | 'asking'
  | 'ready'
  /** คนกดไม่อนุญาต หรือเบราว์เซอร์บล็อกไว้ (เว็บที่ไม่ใช่ https ก็ลงทางนี้) */
  | 'denied'
  | 'unavailable';

/**
 * เกินเท่านี้ถือว่าไม่ได้มาจากดาวเทียม
 *
 * GPS จริงคลาดเคลื่อนราว 5–50 ม. ส่วนตอนหาดาวเทียมไม่เจอ เบราว์เซอร์จะเดาจาก wifi/IP
 * แล้วรายงาน accuracy เป็นพัน ๆ เมตรมาตรง ๆ — ใช้ค่านี้แยกสองอย่างออกจากกัน
 * แล้วบอกบนจอไปเลยว่าอย่าเชื่อ ดีกว่าโชว์ตัวเลขเปล่า ๆ ให้คนเข้าใจผิดว่าแม่น
 */
export const COARSE_ACCURACY_M = 200;

/** ขอครั้งเดียวจบ ไม่เฝ้าต่อ — หน้าจดมิเตอร์เปิดค้างทั้งวัน watchPosition กินแบตฟรี */
const REQUEST_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  // มือถือกลางแจ้งจับดาวเทียมใหม่ใช้เวลาหลายวินาที รอสั้นกว่านี้จะได้แต่ค่าที่เดาจากเน็ต
  timeout: 15000,
  // ค่าที่เพิ่งวัดไปเมื่อครู่ใช้ซ้ำได้ เดินจดบ้านถัดไปไม่ต้องรอจับดาวเทียมใหม่ทั้งรอบ
  maximumAge: 30000
};

@Injectable({ providedIn: 'root' })
export class DeviceLocationService {
  // ตอน prerender ไม่มี navigator ให้เรียก แตะเข้าไปตรง ๆ build พังตั้งแต่ตอน build
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly state = signal<DeviceLocationStatus>('idle');
  private readonly point = signal<LatLng | null>(null);
  private readonly accuracy = signal<number | null>(null);
  private readonly failure = signal<string>('');

  readonly status = this.state.asReadonly();
  readonly coords = this.point.asReadonly();
  /** รัศมีความคลาดเคลื่อนที่เบราว์เซอร์บอกมาเอง (เมตร) — ไม่บอกมาคือ null */
  readonly accuracyMeters = this.accuracy.asReadonly();
  readonly errorMessage = this.failure.asReadonly();

  /** จับได้แต่หยาบเกินกว่าจะเป็นดาวเทียม — ยังโชว์ได้ แต่ต้องติดป้ายว่าเชื่อไม่ได้ */
  readonly isCoarse = computed(() => {
    const meters = this.accuracy();
    return meters !== null && meters > COARSE_ACCURACY_M;
  });

  readonly isSupported = this.isBrowser && typeof navigator !== 'undefined' && !!navigator.geolocation;

  /**
   * ขอตำแหน่งครั้งเดียว — ต้องให้คนกดเองเสมอ ห้ามเรียกเองใน ngOnInit
   * เพราะป๊อปอัปขอสิทธิ์ที่เด้งมาโดยไม่มีใครกดอะไร คนจะกด "ไม่อนุญาต" ทิ้งแทบทุกครั้ง
   */
  request(): void {
    if (!this.isSupported) {
      this.state.set('unavailable');
      this.failure.set('เครื่องนี้หรือเบราว์เซอร์นี้ไม่รองรับการบอกตำแหน่ง');
      return;
    }
    if (this.state() === 'asking') return; // กดรัวไม่ให้ยิงซ้อน

    this.state.set('asking');
    this.failure.set('');

    navigator.geolocation.getCurrentPosition(
      (position) => this.accept(position),
      (error) => this.reject(error),
      REQUEST_OPTIONS
    );
  }

  /** ล้างค่าทิ้งเมื่อคนไม่อยากให้ค้างบนจอ — ไม่มีอะไรถูกบันทึกอยู่แล้ว แค่ซ่อน */
  clear(): void {
    this.state.set('idle');
    this.point.set(null);
    this.accuracy.set(null);
    this.failure.set('');
  }

  /**
   * ห่างจากพิกัดในรูปกี่เมตร — ข้างใดข้างหนึ่งไม่มีให้คืน null (ห้ามเดาแทน)
   * ตัวเลขนี้ไว้ให้คนดูตัดสินเอง ไม่มีใครเอาไปเทียบ threshold ตัดสินใจแทน
   */
  gapFrom(photo: LatLng | null): number | null {
    const here = this.point();
    if (!here || !photo) return null;
    return distanceMeters(here, photo);
  }

  private accept(position: GeolocationPosition): void {
    // ค่าที่เบราว์เซอร์คืนมาก็เพี้ยนได้ (0,0 หรือเกินขอบโลก) กรองด้วยด่านเดียวกับ EXIF
    const coords = toCoords(position?.coords?.latitude, position?.coords?.longitude);
    if (!coords) {
      this.state.set('unavailable');
      this.failure.set('เครื่องคืนค่าตำแหน่งที่ใช้ไม่ได้มา');
      return;
    }

    const accuracy = Number(position?.coords?.accuracy);
    this.point.set(coords);
    this.accuracy.set(Number.isFinite(accuracy) && accuracy > 0 ? accuracy : null);
    this.state.set('ready');
  }

  private reject(error: GeolocationPositionError): void {
    // เทียบด้วยตัวเลข ไม่ใช่ค่าคงที่บน prototype — เบราว์เซอร์เก่าบางตัวไม่มีให้
    if (error?.code === 1) {
      this.state.set('denied');
      this.failure.set('เครื่องไม่อนุญาตให้เว็บดูตำแหน่ง — เปิดสิทธิ์ตำแหน่งให้เบราว์เซอร์แล้วกดใหม่');
      return;
    }

    this.state.set('unavailable');
    this.failure.set(
      error?.code === 3
        ? 'หาตำแหน่งไม่ทัน ลองออกไปที่โล่งแล้วกดใหม่'
        : 'หาตำแหน่งของเครื่องไม่ได้'
    );
  }
}
