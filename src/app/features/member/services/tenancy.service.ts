import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/api.config';

/** ช่วงเวลาที่คนหนึ่งอยู่บ้านหลังนี้ */
export interface Tenancy {
  id: number;
  members_id: number;
  occupant_name: string;
  phone: string | null;
  start_date: string;
  /** null = คนที่อยู่ปัจจุบัน */
  end_date: string | null;
}

/**
 * ผู้อยู่อาศัยแต่ละช่วง + บิลปิดยอดตอนย้ายออก
 *
 * ═══ ปัญหาที่แก้ ═══
 *
 * ระบบเดิมรู้จักแค่ "บ้าน" ค่าน้ำทั้งเดือนจึงตกกับใครก็ตามที่ชื่ออยู่ในทะเบียน
 * ตอนสิ้นเดือน — ผู้เช่าคนใหม่ที่ย้ายเข้าวันที่ 25 ได้บิลของทั้งเดือน รวมส่วนที่
 * คนเก่าใช้ไป 24 วัน ซึ่งเถียงกันไม่จบและคนเก่าก็ตามตัวไม่ได้แล้ว
 */
@Injectable({ providedIn: 'root' })
export class TenancyService {
  private http = inject(HttpClient);
  private apiUrl = API_BASE_URL;

  /** ประวัติผู้อยู่อาศัยของบ้านหลังนี้ (ใหม่สุดขึ้นก่อน) */
  getByMember(membersId: number): Observable<Tenancy[]> {
    return this.http.get<Tenancy[]>(`${this.apiUrl}/tenancies/member/${membersId}`);
  }

  /** เริ่มสัญญาของผู้อยู่อาศัยรายใหม่ — หลังบ้านปิดรายเดิมให้อัตโนมัติ */
  start(payload: {
    members_id: number;
    occupant_name: string;
    phone?: string;
    start_date?: string;
    create_by?: number;
  }): Observable<Tenancy> {
    return this.http.post<Tenancy>(`${this.apiUrl}/tenancies/start`, payload);
  }

  /**
   * ย้ายออก — จดมิเตอร์ครั้งสุดท้าย ออกบิลปิดยอด แล้วปิดสัญญา
   *
   * บิลที่ได้ต่างจากบิลประจำเดือนสองอย่าง:
   *   1. `due_date` = วันย้ายออกเลย ไม่ยืดตามรอบชำระของหมู่บ้าน (ย้ายแล้วตามเก็บไม่ได้)
   *   2. ทบยอดค้างเก่าทั้งหมดเข้าใบนี้ เพราะเป็นใบสุดท้ายที่เรียกเก็บจากคนนี้ได้
   *
   * ด่านกันข้อมูลผิดทุกด่านของการออกบิลปกติยังทำงานครบ — ปุ่ม confirm_* จึงต้องมี
   * ให้ส่งเหมือนกัน เผื่อโดนตีกลับ
   */
  moveOut(payload: {
    members_id: number;
    water_rates_id: number;
    current_unit: number;
    moved_at?: string;
    new_occupant_name?: string;
    new_occupant_phone?: string;
    meter_photo?: string;
    entry_method?: 'ocr' | 'manual' | 'manual_after_ocr_fail';
    meter_digits?: number;
    read_confidence?: number;
    latitude?: number;
    longitude?: number;
    gps_accuracy_m?: number;
    captured_at?: string;
    create_by?: number;
    confirm_high_usage?: boolean;
    confirm_meter_reset?: boolean;
    confirm_digit_change?: boolean;
    confirm_low_confidence?: boolean;
    confirm_duplicate_location?: boolean;
    confirm_stale_photo?: boolean;
    replace?: boolean;
  }): Observable<any> {
    return this.http.post(`${this.apiUrl}/tenancies/move-out`, payload);
  }
}
