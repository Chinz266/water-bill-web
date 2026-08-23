import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { BatchScanComponent } from './batch-scan';

/**
 * กล่อง "ค่าสำหรับกรอกตารางทดลอง" — รวบตัวเลขที่หน้าจอคิดไว้แล้วมาไว้ที่เดียว
 *
 * ═══ สิ่งที่เทสต์ชุดนี้ล็อกไว้ ═══
 *
 * กล่องนี้ห้ามคิดเลขใหม่ ต้องอ่านจาก `row.nearby` ที่คำนวณไว้แล้วเท่านั้น ไม่งั้นจะมี
 * สองความจริงในหน้าเดียว: ตัวเลขบนปุ่มบ้านกับตัวเลขในกล่อง ค่อย ๆ เพี้ยนจากกันจนไม่มีใคร
 * รู้ว่าอันไหนคือค่าที่ระบบใช้ตัดสินจริง เทสต์จึงเทียบกับ `row.nearby` ตรง ๆ ไม่ได้ hardcode
 *
 * และการคัดลอกทั้งกองต้อง **เว้นบรรทัดว่างให้รูปที่ไม่มีพิกัด** ไม่ใช่ข้ามไป ไม่งั้นแถวที่
 * เหลือจะเลื่อนขึ้นไปวางผิดรูปทั้งกองใน Excel โดยที่หน้าตาดูปกติดี
 */

const house = (id: number, houseNo: string, lat: number | null, lng = 100.5) => ({
  id,
  house_no: houseNo,
  fname: 'สมชาย',
  lname: 'ใจดี',
  latitude: lat,
  longitude: lat === null ? null : lng
});

const row = (over: any = {}) => ({
  seq: 1,
  file: new File(['รูปจำลอง'], 'meter-1.jpg', { type: 'image/jpeg' }),
  fileKey: 'meter-1.jpg|1|1',
  fileName: 'meter-1.jpg',
  previewUrl: 'blob:preview',
  brokenImage: false,
  capturedAt: new Date(),
  latitude: 13.75,
  longitude: 100.5,
  photoData: 'data:image/jpeg;base64,xxx',
  memberId: null,
  matchedBy: 'none',
  matchedByCoords: false,
  matchConfidence: null,
  matchReason: null,
  candidates: [],
  nearby: [],
  warnings: [],
  unit: 1250,
  confidence: 95,
  confirmHighUsage: false,
  confirmDigitChange: false,
  confirmLowConfidence: false,
  confirmDuplicateLocation: false,
  confirmStalePhoto: false,
  croppedRead: false,
  ocrUnit: 1250,
  meterDigits: 4,
  ocrConfidence: 0.95,
  status: 'ready',
  error: null,
  errorCode: null,
  billId: null,
  ...over
});

describe('BatchScanComponent — ค่าสำหรับกรอกตารางทดลอง', () => {
  let component: BatchScanComponent;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BatchScanComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    }).compileComponents();

    const fixture = TestBed.createComponent(BatchScanComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    http.expectOne(r => r.url.endsWith('/member/all')).flush([]);
    http.expectOne(r => r.url.endsWith('/villages')).flush([]);
  });

  afterEach(() => localStorage.clear());

  const setup = (houses: any[], over: any = {}) => {
    component.members = houses;
    component.rows = [row(over)] as any;
    component.refreshAllNearby();
    return component.rows[0];
  };

  it('พิกัดของรูปต้องมาจากแถวตรง ๆ ไม่ปัดทิ้งระหว่างทาง', () => {
    const target = setup([house(1, '99/1', 13.75001)]);
    const lab = component.labValues(target as any)!;

    expect(lab.lat).toBe(13.75);
    expect(lab.lng).toBe(100.5);
  });

  it('ระยะถึงมิเตอร์แต่ละตัวต้องเป็นตัวเลขชุดเดียวกับที่ปุ่มบ้านโชว์', () => {
    const target = setup([house(1, '99/1', 13.75001), house(2, '99/2', 13.7503)]);
    const lab = component.labValues(target as any)!;

    expect(lab.meters.map(m => m.houseNo)).toEqual(target.nearby.map(n => n.member.house_no));
    expect(lab.meters.map(m => m.distance)).toEqual(target.nearby.map(n => n.meters));
  });

  it('ตัวที่ใกล้ที่สุดคือตัวที่ระบบแนะนำ ไม่ใช่ตัวแรกในลิสต์', () => {
    // ลิสต์เรียงด้วย compareNearby() ซึ่งเอาเลขมิเตอร์มาคิดด้วย ไม่ใช่ระยะล้วน
    const target = setup([house(1, '99/1', 13.7503), house(2, '99/2', 13.75001)]);
    const lab = component.labValues(target as any)!;
    const nearest = [...target.nearby].sort((a, b) => a.meters - b.meters)[0];

    expect(lab.suggested).toBe(nearest.member.house_no);
    expect(lab.meters.filter(m => m.isNearest).length).toBe(1);
  });

  it('ยังไม่ได้เลือกบ้าน → ความคลาดเคลื่อนต้องเป็น null ไม่ใช่ 0', () => {
    // 0 คือตัวเลขที่ดูเหมือนคำตอบ ทั้งที่ยังไม่มีอะไรให้วัด
    const lab = component.labValues(setup([house(1, '99/1', 13.75001)]) as any)!;

    expect(lab.picked).toBeNull();
    expect(lab.errorMeters).toBeNull();
  });

  it('เลือกบ้านแล้ว → ความคลาดเคลื่อนคือระยะถึงหมุดของหลังที่เลือก', () => {
    const target = setup([house(1, '99/1', 13.75001), house(2, '99/2', 13.7503)], { memberId: 2 });
    const lab = component.labValues(target as any)!;
    const picked = target.nearby.find(n => Number(n.member.id) === 2)!;

    expect(lab.picked).toBe('99/2');
    expect(lab.errorMeters).toBe(picked.meters);
    expect(lab.meters.filter(m => m.isPicked).map(m => m.houseNo)).toEqual(['99/2']);
  });

  it('ระยะระหว่างมิเตอร์ 2 ตัว = ตัวหารของ % คลาดเคลื่อนในไฟล์ Excel', () => {
    // 99/1 กับ 99/2 ห่างกัน 0.0001 องศาละติจูด ≈ 11 ม.
    const lab = component.labValues(
      setup([house(1, '99/1', 13.75001), house(2, '99/2', 13.75011)]) as any
    )!;

    expect(lab.pinGap).toBeGreaterThan(10);
    expect(lab.pinGap).toBeLessThan(12);
  });

  it('มีมิเตอร์เดียวในรัศมี → ไม่มีระยะระหว่างตัว และไม่มีทิศ ต้องเป็น null', () => {
    const lab = component.labValues(setup([house(1, '99/1', 13.75001)]) as any)!;

    expect(lab.pinGap).toBeNull();
    expect(lab.pinSide).toBeNull();
  });

  it('รูปไม่มีพิกัด → ไม่มีอะไรให้กรอก ต้องคืน null ทั้งก้อน', () => {
    const target = setup([house(1, '99/1', 13.75001)], { latitude: null, longitude: null });

    expect(component.labValues(target as any)).toBeNull();
  });

  /**
   * สองตัวที่ใกล้กันกว่าเขต GPS ยังตอบทิศให้ แต่ต้องติดธงว่ายืนยันไม่ได้ —
   * เงียบไปเลยคนจะคิดว่าระบบพัง ส่วนตอบแบบไม่ติดธงคนจะเอาไปใช้ตัดสิน
   */
  it('มิเตอร์สองตัวใกล้กันกว่าเขต GPS → ตอบทิศได้ แต่ยืนยันไม่ได้', () => {
    const target = setup([house(1, '99/1', 13.75001), house(2, '99/2', 13.750077)]);
    const lab = component.labValues(target as any)!;

    expect(lab.pinSide).not.toBeNull();
    expect(lab.pinSideCertain).toBe(false);
  });

  describe('กางกล่องทีละแถว', () => {
    it('เริ่มต้นปิดไว้ และกดสลับได้', () => {
      const target = setup([house(1, '99/1', 13.75001)]);

      expect(component.isLabOpen(target as any)).toBe(false);
      component.toggleLab(target as any);
      expect(component.isLabOpen(target as any)).toBe(true);
      component.toggleLab(target as any);
      expect(component.isLabOpen(target as any)).toBe(false);
    });

    it('กางแถวหนึ่งต้องไม่กางแถวอื่นตามไปด้วย', () => {
      setup([house(1, '99/1', 13.75001)]);
      component.rows = [
        { ...component.rows[0], seq: 1 },
        { ...component.rows[0], seq: 2 }
      ] as any;

      component.toggleLab(component.rows[0]);

      expect(component.isLabOpen(component.rows[0])).toBe(true);
      expect(component.isLabOpen(component.rows[1])).toBe(false);
    });
  });

  describe('คัดลอกพิกัด', () => {
    let written: string[];

    beforeEach(() => {
      written = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: (t: string) => { written.push(t); return Promise.resolve(); } }
      });
    });

    it('ใบเดียว → ละติจูดกับลองจิจูดคั่นด้วยแท็บ ทศนิยม 6 ตำแหน่งเท่าที่ไฟล์ใช้', () => {
      const target = setup([house(1, '99/1', 13.75001)]);

      component.copyPhotoCoords(target as any);

      expect(written).toEqual(['13.750000\t100.500000']);
    });

    it('ทั้งกอง → บรรทัดละรูป เรียงตามลำดับบนจอ', () => {
      setup([house(1, '99/1', 13.75001)]);
      component.rows = [
        { ...component.rows[0], seq: 1, latitude: 13.75, longitude: 100.5 },
        { ...component.rows[0], seq: 2, latitude: 13.7501, longitude: 100.5002 }
      ] as any;

      component.copyAllPhotoCoords();

      expect(written[0]).toBe('13.750000\t100.500000\n13.750100\t100.500200');
    });

    it('รูปที่ไม่มีพิกัดต้องเว้นบรรทัดว่างไว้ ไม่ใช่ข้ามไป', () => {
      // ข้ามไปแล้วรูปใบที่ 3 จะเลื่อนขึ้นไปนั่งแถวของใบที่ 2 ใน Excel โดยไม่มีใครทัก
      setup([house(1, '99/1', 13.75001)]);
      component.rows = [
        { ...component.rows[0], seq: 1, latitude: 13.75, longitude: 100.5 },
        { ...component.rows[0], seq: 2, latitude: null, longitude: null },
        { ...component.rows[0], seq: 3, latitude: 13.7502, longitude: 100.5003 }
      ] as any;

      component.copyAllPhotoCoords();

      expect(written[0].split('\n')).toEqual([
        '13.750000\t100.500000',
        '\t',
        '13.750200\t100.500300'
      ]);
    });
  });
});

/**
 * เทียบรูปมิเตอร์สองตัว — ภาพกับป้ายต้องไม่ค้านกัน
 *
 * ถ้าป้ายบอก "88/2 อยู่ทางซ้ายของ 88/1" แต่รูป 88/2 ไปโผล่ช่องขวา คนหน้างานจะเชื่อภาพ
 * แล้วจดผิดหลังทันที เทสต์ชุดนี้จึงล็อกลำดับช่องให้ตรงกับทิศเสมอ
 */
describe('BatchScanComponent — เทียบรูปมิเตอร์สองตัว', () => {
  let component: BatchScanComponent;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BatchScanComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    }).compileComponents();

    const fixture = TestBed.createComponent(BatchScanComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne(r => r.url.endsWith('/member/all')).flush([]);
    http.expectOne(r => r.url.endsWith('/villages')).flush([]);
  });

  afterEach(() => localStorage.clear());

  /** 99/1 ใกล้จุดถ่ายกว่า (เป็นตัวอ้างอิง) · 99/2 อยู่ห่างไปทางตะวันออก = ทางขวา */
  const eastPair = () => {
    component.members = [
      house(1, '99/1', 13.75001, 100.5),
      house(2, '99/2', 13.75001, 100.5004)
    ];
    component.rows = [row({ seq: 1, memberId: 1 })] as any;
    component.refreshAllNearby();
    return component.rows[0];
  };

  it('ตัวที่อยู่ทางขวา ต้องอยู่ช่องขวา และประโยคต้องตรงกับภาพ', () => {
    const pair = component.pairPhotos(eastPair() as any)!;

    expect(pair.first.houseNo).toBe('99/1');
    expect(pair.second.houseNo).toBe('99/2');
    expect(pair.axis).toBe('ซ้าย-ขวา');
    expect(pair.sentence).toBe('99/2 อยู่ทางขวาของ 99/1');
  });

  it('ตัวที่อยู่ทางซ้าย ต้องสลับไปอยู่ช่องแรก ไม่ใช่ค้างอยู่ช่องหลัง', () => {
    component.members = [
      house(1, '99/1', 13.75001, 100.5),
      house(2, '99/2', 13.75001, 100.4996)   // ไปทางตะวันตก = ซ้าย
    ];
    component.rows = [row({ seq: 1, memberId: 1 })] as any;
    component.refreshAllNearby();
    const pair = component.pairPhotos(component.rows[0] as any)!;

    expect(pair.first.houseNo).toBe('99/2');
    expect(pair.second.houseNo).toBe('99/1');
    expect(pair.sentence).toBe('99/2 อยู่ทางซ้ายของ 99/1');
  });

  it('รูปมาจากแถวที่เลือกบ้านหลังนั้นไว้ในกอง — ไม่มีก็ต้องเป็น null ไม่ใช่หยิบรูปอื่นมาแทน', () => {
    const target = eastPair();
    const pair = component.pairPhotos(target as any)!;

    // แถวเดียวในกองเลือก 99/1 ไว้ จึงมีรูปเฉพาะฝั่งนั้น
    expect(pair.first.previewUrl).toBe('blob:preview');
    expect(pair.first.seq).toBe(1);
    expect(pair.second.previewUrl).toBeNull();
    expect(pair.second.seq).toBeNull();
  });

  it('มิเตอร์ใกล้กันกว่าเขต GPS → ยังเรียงให้ดู แต่ต้องติดธงว่ายืนยันไม่ได้', () => {
    component.members = [
      house(1, '99/1', 13.75001, 100.5),
      house(2, '99/2', 13.75001, 100.50003)  // ห่างราว 3 ม.
    ];
    component.rows = [row({ seq: 1, memberId: 1 })] as any;
    component.refreshAllNearby();
    const pair = component.pairPhotos(component.rows[0] as any)!;

    expect(pair.sentence).toContain('อยู่ทาง');
    expect(pair.certain).toBe(false);
  });

  it('มีมิเตอร์เดียวในรัศมี → ไม่มีอะไรให้เทียบ ต้องคืน null', () => {
    component.members = [house(1, '99/1', 13.75001)];
    component.rows = [row({ seq: 1, memberId: 1 })] as any;
    component.refreshAllNearby();

    expect(component.pairPhotos(component.rows[0] as any)).toBeNull();
  });
});
