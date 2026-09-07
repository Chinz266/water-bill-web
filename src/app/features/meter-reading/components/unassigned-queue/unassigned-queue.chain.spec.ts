import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { UnassignedQueueComponent } from './unassigned-queue';

/**
 * มิเตอร์ตัวเดียวกันที่ถ่ายคนละวัน — ฝั่งหน้าจอ
 *
 * หลังบ้านบอกมาแค่ว่า "ใบนี้ต่อจากใบไหน" หน้าจอมีหน้าที่สองอย่างที่ทำให้มันใช้งานได้จริง:
 *   1. โชว์ตัวเลขทั้งสองใบให้คนตัดสิน (57 ➔ 90 = 33 หน่วย) ไม่ใช่แค่บอกว่าเชื่อมกัน
 *   2. พาไปหาใบคู่หูหลังจับคู่ใบแรกเสร็จ — ใบนั้นอาจอยู่ห่างไปหลายสิบใบในคิว
 *      ถ้าไม่พาไป มันจะค้างต่อไปทั้งที่ตอนนี้ตอบได้แล้ว
 */

const chain = (over: any = {}) => ({
  id: 9,
  captured_at: '2026-08-15T09:00:00',
  meter_unit: 57,
  usage_unit: 33,
  days_apart: 3,
  distance_m: 4,
  status: 'Assigned',
  members_id: 7,
  house_no: '206/2',
  cluster_group_id: null,
  ...over
});

const queued = (over: any = {}) => ({
  id: 12,
  villages_id: 1,
  members_id: null,
  blocked_code: null,
  blocked_reason: null,
  meter_unit: 90,
  meter_digits: 2,
  read_confidence: 0.9,
  evidence_photo: 'uploads/meters/b.jpg',
  latitude: 14.9799,
  longitude: 102.0977,
  gps_accuracy_m: 8,
  captured_at: '2026-08-18T09:00:00',
  status: 'Pending',
  note: null,
  create_date: '2026-08-18T09:05:00',
  chain: chain(),
  ...over
});

describe('UnassignedQueueComponent — ไทม์ไลน์มิเตอร์ตัวเดียวกัน', () => {
  let component: UnassignedQueueComponent;
  let http: HttpTestingController;

  const listUrl = (r: { url: string }) => /\/readings\/unassigned(\?|$)/.test(r.url);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UnassignedQueueComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();

    const fixture = TestBed.createComponent(UnassignedQueueComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    http.expectOne(listUrl).flush([queued()]);
  });

  afterEach(() => http.verify());

  it('ป้ายเชื่อมต้องมีตัวเลขทั้งสองใบ ไม่ใช่แค่บอกว่าเชื่อมกับใบไหน', () => {
    const label = component.chainLabel(component.rows()[0])!;

    expect(label).toContain('คิว #9');
    expect(label).toContain('57');
    expect(label).toContain('90');
    expect(label).toContain('33 หน่วย');
  });

  it('ไม่มีข้อต่อ → ไม่มีป้าย (การ์ดต้องไม่ขึ้นอะไรที่ไม่มีข้อมูลรองรับ)', () => {
    expect(component.chainLabel(queued({ chain: null }) as any)).toBeNull();
  });

  it('ใบก่อนหน้ายังไม่รู้บ้าน → ไม่มีปุ่มลัด มีแต่ป้ายบอกว่าเป็นตัวเดียวกัน', () => {
    const row = queued({ chain: chain({ members_id: null, house_no: null }) }) as any;

    expect(component.chainLabel(row)).toContain('คิว #9');
    expect(component.chainHouse(row)).toBeNull();
  });

  it('กดปุ่มลัด → เปิดใบนั้นพร้อมติ๊กบ้านเดียวกับใบก่อนหน้าไว้ให้', () => {
    component.openWithChain(component.rows()[0]);
    http
      .expectOne((r) => r.url.includes('/readings/unassigned/12'))
      .flush({ ...queued(), candidates: [], suggested: null });

    expect(component.selectedMemberId).toBe(7);
    expect(component.canAssign()).toBe(true);
  });

  it('เปิดตามปกติ (ไม่ได้กดปุ่มลัด) → ต้องไม่ติ๊กบ้านให้เอง', () => {
    component.open(component.rows()[0]);
    http
      .expectOne((r) => r.url.includes('/readings/unassigned/12'))
      .flush({ ...queued(), candidates: [], suggested: null });

    expect(component.selectedMemberId).toBeNull();
  });

  it('จับคู่ใบหนึ่งเสร็จ → ไฮไลต์ใบที่เป็นมิเตอร์ตัวเดียวกันให้เห็น', async () => {
    // จับคู่ใบ #9 (ใบก่อนหน้าของ #12) — พอเสร็จแล้ว #12 ต้องถูกชี้ให้เห็น
    component.open(component.rows()[0]);
    http
      .expectOne((r) => r.url.includes('/readings/unassigned/12'))
      .flush({ ...queued({ id: 9, chain: null }), candidates: [], suggested: null });

    component.selectedMemberId = 7;
    component.assign();

    http.expectOne((r) => r.url.endsWith('/water-rates/active')).flush({ id: 1 });
    http.expectOne((r) => r.url.includes('/readings/unassigned/9/assign')).flush({ ok: true });
    // reload หลังออกบิล — คิวที่เหลือคือใบ #12 ซึ่งชี้ว่าต่อจาก #9
    http.expectOne(listUrl).flush([queued({ id: 12, chain: chain({ id: 9 }) })]);

    expect(component.highlightedId()).toBe(12);
  });

  it('ป้ายทิศทาง: บอกทิศ ระยะ และเตือนว่าใช้ตัดสินใจไม่ได้เมื่อระยะต่ำกว่าที่ GPS แยกออก', () => {
    const badge = component.directionBadge({
      house_no: '206/1',
      relative: {
        distance_meters: 0.2,
        bearing_deg: 90,
        relative_direction: 'ขวา',
        within_threshold: true,
        reliable: false,
        from_sequence: false
      }
    } as any)!;

    expect(badge).toContain('ด้านขวา');
    expect(badge).toContain('0.2 เมตร');
    expect(badge).toContain('206/1');
    // ป้ายที่ดูแม่นระดับเซนติเมตรต้องบอกความจริงว่ามันอยู่ใต้ความคลาดเคลื่อนของเครื่อง
    expect(badge).toContain('GPS');
  });

  it('ป้ายทิศทาง: ระยะเกินความคลาดเคลื่อนแล้ว ไม่ต้องมีคำเตือนต่อท้าย', () => {
    const badge = component.directionBadge({
      house_no: '206/1',
      relative: {
        distance_meters: 12,
        bearing_deg: 0,
        relative_direction: 'บน',
        within_threshold: false,
        reliable: true,
        from_sequence: false
      }
    } as any)!;

    expect(badge).toContain('ด้านบน');
    expect(badge).not.toContain('⚠️');
  });

  it('ป้ายทิศทาง: พิกัดซ้ำกันเป๊ะ → บอกว่าทิศมาจากลำดับตำแหน่ง ไม่ใช่จากพิกัด', () => {
    const badge = component.directionBadge({
      house_no: '206/1',
      relative: {
        distance_meters: 0,
        bearing_deg: null,
        relative_direction: 'ขวา',
        within_threshold: true,
        reliable: true,
        from_sequence: true
      }
    } as any)!;

    expect(badge).toContain('ลำดับตำแหน่ง');
  });

  it('ป้ายทิศทาง: ไม่มีพิกัดให้เทียบ → ไม่ต้องขึ้นป้าย', () => {
    expect(component.directionBadge({ house_no: '206/1' } as any)).toBeNull();
    expect(
      component.directionBadge({ house_no: '206/1', relative: null } as any)
    ).toBeNull();
  });

  it('ไม่มีใบไหนต่อจากใบที่เพิ่งจับคู่ → ไม่ต้องไฮไลต์อะไรเลย', () => {
    component.open(component.rows()[0]);
    http
      .expectOne((r) => r.url.includes('/readings/unassigned/12'))
      .flush({ ...queued({ id: 9, chain: null }), candidates: [], suggested: null });

    component.selectedMemberId = 7;
    component.assign();

    http.expectOne((r) => r.url.endsWith('/water-rates/active')).flush({ id: 1 });
    http.expectOne((r) => r.url.includes('/readings/unassigned/9/assign')).flush({ ok: true });
    http.expectOne(listUrl).flush([queued({ id: 20, chain: null })]);

    expect(component.highlightedId()).toBeNull();
  });
});
