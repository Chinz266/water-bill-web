import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/api.config';

/** มิเตอร์หนึ่งตัวที่เคยติดตั้งให้บ้านหลังหนึ่ง */
export interface Meter {
  id: number;
  members_id: number;
  serial_no: string | null;
  /** จำนวนหลักบนหน้าปัด (นับเลขศูนย์นำหน้าด้วย) */
  digits: number | null;
  installed_at: string;
  /** null = ตัวที่ใช้อยู่ปัจจุบัน */
  removed_at: string | null;
  initial_unit: number;
  /** เลขปิด ณ วันถอด */
  final_unit: number | null;
  /** null = หน่วยค้างของตัวนี้ยังรอคิดเข้าบิลใบถัดไป */
  residual_billed_at: string | null;
  note: string | null;
}

/**
 * ทะเบียนมิเตอร์ของแต่ละบ้าน
 *
 * ═══ ทำไมต้องบันทึกตอนเปลี่ยน ไม่ใช่ตอนออกบิล ═══
 *
 * ของเดิมกรอกเลขปิดของมิเตอร์ตัวเก่าตอนออกบิล ซึ่งพังในทางปฏิบัติ เพราะคนที่
 * เปลี่ยนมิเตอร์ (ช่าง) กับคนที่เดินจดรอบถัดไปมักคนละคน และห่างกันเป็นสัปดาห์ —
 * คนจดไม่มีทางรู้เลขปิดของตัวที่ถูกถอดไปแล้ว น้ำที่ใช้ก่อนถอดจึงหายทุกครั้ง
 *
 * บันทึกตอนเปลี่ยนแล้วหลังบ้านจะบวกหน่วยค้างเข้าบิลใบถัดไปให้เอง แล้วมาร์กว่า
 * คิดแล้ว ไม่คิดซ้ำอีก
 */
@Injectable({ providedIn: 'root' })
export class MetersService {
  private http = inject(HttpClient);
  private apiUrl = API_BASE_URL;

  /** ประวัติมิเตอร์ทุกตัวของบ้านหลังนี้ (ใหม่สุดขึ้นก่อน) */
  getByMember(membersId: number): Observable<Meter[]> {
    return this.http.get<Meter[]>(`${this.apiUrl}/meters/member/${membersId}`);
  }

  /**
   * ลงทะเบียนมิเตอร์ตัวปัจจุบัน (บ้านที่เข้าระบบก่อนมีทะเบียน)
   *
   * ไม่ไปยุ่งกับเลขตั้งต้นของบิลเลย — ตารางนี้เก็บ "ตัวตนของมิเตอร์" ไม่ใช่
   * "เลขที่ใช้คิดเงิน" กรอก digits ไว้ด้วยจะทำให้ด่านจับ OCR อ่านหลักหาย/เกิน
   * ทำงานตั้งแต่บิลใบแรกของบ้านนี้
   */
  register(payload: {
    members_id: number;
    serial_no?: string;
    digits?: number;
    installed_at?: string;
    initial_unit?: number;
    note?: string;
    create_by?: number;
  }): Observable<Meter> {
    return this.http.post<Meter>(`${this.apiUrl}/meters/register`, payload);
  }

  /**
   * เปลี่ยนมิเตอร์ใหม่ — ปิดทะเบียนตัวเก่าและเปิดตัวใหม่ในทรานแซกชันเดียว
   * คืน `residual_unit` = หน่วยที่จะถูกบวกเข้าบิลใบถัดไปให้เห็นตั้งแต่ตอนกรอก
   */
  replace(payload: {
    members_id: number;
    old_final_unit: number;
    new_initial_unit?: number;
    new_serial_no?: string;
    new_digits?: number;
    replaced_at?: string;
    note?: string;
    create_by?: number;
  }): Observable<{ removed: Meter; installed: Meter; residual_unit: number }> {
    return this.http.post<{ removed: Meter; installed: Meter; residual_unit: number }>(
      `${this.apiUrl}/meters/replace`,
      payload
    );
  }
}
