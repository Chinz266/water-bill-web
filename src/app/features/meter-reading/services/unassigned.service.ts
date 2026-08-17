import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/api.config';

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
}

/** รูปมิเตอร์ที่ยังไม่รู้ว่าของบ้านไหน */
export interface UnassignedReading {
  id: number;
  villages_id: number | null;
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
      members_id: number;
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
