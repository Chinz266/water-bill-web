import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/api.config';

/**
 * จุดที่ถ่ายรูปอยู่ทางไหนของพิกัดที่ลงทะเบียนไว้ของบ้านหลังหนึ่ง
 *
 * ⚠️ `reliable: false` = ระยะที่วัดได้ต่ำกว่าความคลาดเคลื่อนของ GPS มือถือ (3-30 ม.)
 *    ทิศที่ได้จึงเป็นเสียงรบกวน ไม่ใช่ตำแหน่งจริง — แสดงให้ดูได้ แต่ห้ามใช้ตัดสินใจ
 */
export interface RelativeDirection {
  distance_meters: number;
  bearing_deg: number | null;
  relative_direction: 'บน' | 'ล่าง' | 'ซ้าย' | 'ขวา' | null;
  /** ระยะอยู่ในเกณฑ์ ≤ 0.3 ม. */
  within_threshold: boolean;
  reliable: boolean;
  /** ทิศนี้มาจาก sequence_index เพราะพิกัดซ้ำกันเป๊ะ */
  from_sequence: boolean;
}

/** บ้านที่เป็นไปได้ของรูปกำพร้าใบหนึ่ง (เกณฑ์เดียวกับหน้าอัปรูปทั้งชุด) */
export interface UnassignedCandidate {
  members_id: number;
  house_no: string;
  name: string;
  previous_unit: number;
  usage_unit: number;
  typical_usage: number | null;
  already_billed: boolean;
  score: number;
  distance_m: number | null;
  /** ทิศทางของจุดที่ถ่าย เทียบกับพิกัดที่ลงทะเบียนของบ้านหลังนี้ (null = ขาดพิกัด) */
  relative?: RelativeDirection | null;
}

/**
 * บ้านที่คนหน้างานเลือกไว้แล้ว ตอนที่รูปถูกด่านตีกลับ
 *
 * ไม่ได้มาจาก candidates — แถวที่ติดด่านคือแถวที่เลข "ไม่เข้า" พอดี บ้านที่ถูกต้อง
 * จึงมักไม่ติดอันดับ ซึ่งเป็นเรื่องปกติของเคสนี้ ไม่ใช่สัญญาณว่าเลือกบ้านผิด
 */
export interface UnassignedSuggested {
  members_id: number;
  house_no: string;
  name: string;
  previous_unit: number;
  /** null = AI อ่านเลขไม่ออก ยังคิดหน่วยไม่ได้จนกว่าคนตรวจจะพิมพ์เลขเอง */
  usage_unit: number | null;
  cluster_group_id: string | null;
  sequence_index: number | null;
}

/**
 * ใบก่อนหน้าของ "มิเตอร์ตัวเดียวกัน" ที่หลังบ้านเชื่อมให้ — null = เชื่อมไม่ได้
 *
 * เกิดจากการถ่ายมิเตอร์ตัวเดิมซ้ำคนละวัน (15 ส.ค. ได้ 57, 18 ส.ค. ได้ 90)
 * พอใบแรกถูกจับคู่กับบ้านแล้ว ใบหลังก็ตอบได้ทันทีว่าเป็นบ้านเดียวกัน
 */
export interface ChainLink {
  id: number;
  captured_at: string | null;
  meter_unit: number;
  /** หน่วยที่ใช้ไประหว่างสองใบ */
  usage_unit: number;
  days_apart: number;
  distance_m: number;
  status: 'Pending' | 'Assigned' | 'Discarded';
  /** บ้านที่ใบก่อนถูกจับคู่ไปแล้ว — null = ใบก่อนก็ยังไม่รู้ว่าบ้านไหน */
  members_id: number | null;
  house_no: string | null;
  /** ใบก่อนอยู่ในกลุ่มมิเตอร์ที่ติดกัน — พิกัดแยกตัวซ้าย/ขวาไม่ได้ ต้องตรวจเลขให้ดี */
  cluster_group_id: string | null;
}

/** รูปมิเตอร์ที่ยังออกบิลไม่ได้ — ไม่รู้ว่าบ้านไหน หรือรู้แล้วแต่ด่านตีกลับ */
export interface UnassignedReading {
  id: number;
  villages_id: number | null;
  /** บ้านที่คนหน้างานเลือกไว้ — null = รูปกำพร้าแท้ ๆ ยังไม่รู้ว่าของใคร */
  members_id: number | null;
  /** รหัสด่านที่ตีกลับ (HIGH_USAGE, METER_ROLLBACK, CLUSTER_SEQUENCE_MISMATCH …) */
  blocked_code: string | null;
  /** ข้อความที่ด่านตอบกลับตอนนั้น — สิ่งเดียวกับที่คนหน้างานเห็น */
  blocked_reason: string | null;
  /** null = OCR อ่านไม่ออก ต้องให้คนเปิดรูปแล้วพิมพ์เอง */
  meter_unit: number | null;
  meter_digits: number | null;
  read_confidence: number | null;
  evidence_photo: string;
  latitude: number | null;
  longitude: number | null;
  gps_accuracy_m: number | null;
  captured_at: string | null;
  status: 'Pending' | 'Assigned' | 'Discarded';
  note: string | null;
  create_date: string;
  candidates?: UnassignedCandidate[];
  suggested?: UnassignedSuggested | null;
  /** ใบก่อนหน้าของมิเตอร์ตัวเดียวกัน (หลังบ้านคิดให้ทุกครั้งที่ดึงคิว) */
  chain?: ChainLink | null;
}

/**
 * คิวรูปที่ยังไม่รู้ว่าเป็นของบ้านหลังไหน — "ข้อมูลกำพร้า"
 *
 * ═══ มีไว้ทำไม ═══
 *
 * หน้างานเจอสองเคสที่คนเดินจดตัดสินเองไม่ได้: OCR อ่านเลขไม่ออก (หน้าปัดฝ้า/โคลนบัง)
 * และเคสที่อ่านออกแต่เข้าได้หลายบ้านพอ ๆ กัน
 *
 * ก่อนมีคิวนี้ คนมีทางเลือกแค่ "เดาแล้วกดไปก่อน" (จบที่บิลผิดบ้าน) หรือ "ทิ้งรูป
 * แล้วเดินกลับไปใหม่" — ทั้งสองทางแย่กว่าการยอมรับว่ายังไม่รู้แล้วให้คนที่มีเวลา
 * นั่งดูทีหลังเป็นคนตัดสิน
 *
 * ตอนจับคู่ไม่ได้ลัดด่านอะไรเลย — หลังบ้านวิ่งผ่าน POST /bills/scan ตัวเดิมทั้งหมด
 */
@Injectable({ providedIn: 'root' })
export class UnassignedService {
  private http = inject(HttpClient);
  private apiUrl = API_BASE_URL;

  /** ฝากรูปที่ตัดสินใจไม่ได้เข้าคิว — บังคับต้องมีรูป ไม่งั้นไม่เหลืออะไรให้ตัดสิน */
  create(payload: {
    meter_photo: string;
    villages_id?: number;
    /** บ้านที่คนหน้างานเลือกไว้ — ส่งมาเมื่อฝากเพราะ**ด่านตีกลับ** ไม่ใช่เพราะไม่รู้ว่าของใคร */
    members_id?: number;
    blocked_code?: string;
    blocked_reason?: string;
    meter_unit?: number;
    meter_digits?: number;
    read_confidence?: number;
    latitude?: number;
    longitude?: number;
    gps_accuracy_m?: number;
    captured_at?: string;
    note?: string;
    create_by?: number;
  }): Observable<UnassignedReading> {
    return this.http.post<UnassignedReading>(`${this.apiUrl}/readings/unassigned`, payload);
  }

  /** คิวที่รออยู่ (เก่าสุดขึ้นก่อน — ของที่ค้างนานต้องรีบตัดสินก่อนข้ามเดือน) */
  list(status = 'Pending', villagesId?: number): Observable<UnassignedReading[]> {
    const village = villagesId ? `&villages_id=${villagesId}` : '';
    return this.http.get<UnassignedReading[]>(
      `${this.apiUrl}/readings/unassigned?status=${status}${village}`
    );
  }

  /** รูปหนึ่งใบพร้อมบ้านที่เป็นไปได้ 5 อันดับ */
  getOne(id: number, month: string, year: string): Observable<UnassignedReading> {
    return this.http.get<UnassignedReading>(
      `${this.apiUrl}/readings/unassigned/${id}?month=${month}&year=${year}`
    );
  }

  /**
   * จับคู่กับบ้านแล้วออกบิล — วิ่งผ่านเส้นทางออกบิลปกติทั้งหมด
   * ส่ง `current_unit` มาด้วยเมื่อ OCR อ่านไม่ออก (หลังบ้านถือเป็นการกรอกมือ)
   */
  assign(
    id: number,
    payload: {
      /** ไม่ส่ง = ใช้บ้านที่คนหน้างานเลือกไว้ (members_id ของแถว) */
      members_id?: number;
      water_rates_id: number;
      billing_month: string;
      billing_year: string;
      current_unit?: number;
      reading_date?: string;
      create_by?: number;
      replace?: boolean;
      confirm_high_usage?: boolean;
      confirm_meter_reset?: boolean;
      confirm_digit_change?: boolean;
      confirm_low_confidence?: boolean;
      confirm_duplicate_location?: boolean;
      confirm_stale_photo?: boolean;
    }
  ): Observable<any> {
    return this.http.post(`${this.apiUrl}/readings/unassigned/${id}/assign`, payload);
  }

  /** ตีทิ้ง — รูปที่เบลอจนอ่านไม่ออกหรือถ่ายผิดของ (ลบไฟล์รูปทิ้งด้วย) */
  discard(id: number, note?: string, resolvedBy?: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/readings/unassigned/${id}/discard`, {
      note,
      resolved_by: resolvedBy
    });
  }
}
