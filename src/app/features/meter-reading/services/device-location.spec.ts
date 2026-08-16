import { TestBed } from '@angular/core/testing';
import { DeviceLocationService } from './device-location';

/**
 * ตำแหน่งจากเครื่องเคยทำให้พิกัดในทะเบียนพังมาแล้ว เทสต์ชุดนี้จึงเฝ้าสองเรื่อง:
 * ค่าที่หยาบต้องถูกติดป้ายว่าหยาบ และ service นี้ต้องไม่มีทางเขียนอะไรออกไปข้างนอก
 */

type SuccessFn = (position: GeolocationPosition) => void;
type FailFn = (error: GeolocationPositionError) => void;

/** พอสำหรับสิ่งที่ service อ่านจริง — ของจริงมี timestamp/altitude ที่ไม่ได้ใช้ */
const positionOf = (lat: number, lng: number, accuracy: number): GeolocationPosition =>
  ({ coords: { latitude: lat, longitude: lng, accuracy } }) as GeolocationPosition;

describe('DeviceLocationService — ตำแหน่งเครื่อง (ของประกอบสายตา)', () => {
  let service: DeviceLocationService;
  let succeed: SuccessFn;
  let fail: FailFn;

  beforeEach(() => {
    // ดักไว้ที่ navigator เลย จะได้ไม่มีป๊อปอัปขอสิทธิ์จริงมาค้างตอนรันเทสต์
    (globalThis as any).navigator ??= {};
    Object.defineProperty(globalThis.navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (onOk: SuccessFn, onFail: FailFn) => {
          succeed = onOk;
          fail = onFail;
        }
      }
    });

    TestBed.configureTestingModule({});
    service = TestBed.inject(DeviceLocationService);
  });

  it('เริ่มมาต้องยังไม่ขอตำแหน่ง — ป๊อปอัปที่เด้งเองคนจะกดปฏิเสธทิ้ง', () => {
    expect(service.status()).toBe('idle');
    expect(service.coords()).toBeNull();
  });

  it('ได้พิกัดแม่น ๆ มา → ready และไม่ติดป้ายว่าหยาบ', () => {
    service.request();
    succeed(positionOf(14.9799, 102.0977, 12));

    expect(service.status()).toBe('ready');
    expect(service.coords()).toEqual({ lat: 14.9799, lng: 102.0977 });
    expect(service.isCoarse()).toBe(false);
  });

  it('accuracy เป็นพันเมตร = เดาจากเน็ต ต้องติดป้ายว่าหยาบ (ต้นเหตุพิกัดผิดของเดิม)', () => {
    service.request();
    succeed(positionOf(13.7563, 100.5018, 4800));

    expect(service.isCoarse()).toBe(true);
  });

  it('เครื่องคืน 0,0 มา → ไม่รับ (ค่าว่างที่ถูกแปลงเป็นเลข ไม่ใช่พิกัดกลางมหาสมุทร)', () => {
    service.request();
    succeed(positionOf(0, 0, 10));

    expect(service.status()).toBe('unavailable');
    expect(service.coords()).toBeNull();
  });

  it('คนกดไม่อนุญาต (code 1) → denied พร้อมข้อความบอกวิธีแก้', () => {
    service.request();
    fail({ code: 1 } as GeolocationPositionError);

    expect(service.status()).toBe('denied');
    expect(service.errorMessage()).toContain('ตำแหน่ง');
  });

  it('หาไม่ทัน (code 3) → unavailable ไม่ใช่ denied — คนละวิธีแก้กัน', () => {
    service.request();
    fail({ code: 3 } as GeolocationPositionError);

    expect(service.status()).toBe('unavailable');
  });

  it('gapFrom ต้องคืน null เมื่อขาดข้างใดข้างหนึ่ง — ห้ามเดาระยะแทน', () => {
    expect(service.gapFrom({ lat: 14.98, lng: 102.09 })).toBeNull();

    service.request();
    succeed(positionOf(14.9799, 102.0977, 10));

    expect(service.gapFrom(null)).toBeNull();
    expect(service.gapFrom({ lat: 14.9799, lng: 102.0977 })).toBe(0);
  });

  it('ไกลกันคนละจังหวัดต้องได้ระยะจริง ไม่ใช่ค่าที่ถูกตัดทิ้ง', () => {
    service.request();
    succeed(positionOf(13.7563, 100.5018, 20));

    expect(service.gapFrom({ lat: 14.9799, lng: 102.0977 })).toBeGreaterThan(200000);
  });

  /**
   * ตั้งใจให้เปราะ: เพิ่มเมธอดใหม่เมื่อไรเทสต์นี้แดงทันที คนเขียนจะได้ถูกบังคับให้ตอบว่า
   * ของใหม่นั้นเขียนค่าออกไปข้างนอกหรือเปล่า — บั๊กเดิมเกิดจากค่าตรงนี้ไหลไปถึงหลังบ้าน
   * (private ของ TypeScript หายไปตอนรัน เมธอดส่วนตัวจึงอยู่ในรายชื่อนี้ด้วย)
   */
  it('ผิวของ service ต้องมีแค่ขอ/ล้าง/วัดระยะ — ไม่มีเมธอดที่บันทึกหรือยิง API', () => {
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(service))
      .filter((name) => name !== 'constructor')
      .sort();

    expect(surface).toEqual(['accept', 'clear', 'gapFrom', 'reject', 'request']);
  });
});
