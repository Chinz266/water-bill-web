import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/api.config';

/** ธงหนึ่งใบที่ระบบติดไว้ตอนจดมิเตอร์ */
export interface ReadingFlag {
  id: number;
  meter_readings_id: number;
  flag_type: string;
  detail: string | null;
  /** admin.id ของคนที่กดยืนยันข้ามด่าน — null = ระบบติดธงเอง ไม่มีใครกด */
  confirmed_by: number | null;
  create_date: string;
  reading: {
    reading_date: string | null;
    meter_unit: number | null;
    entry_method: string | null;
  };
  member: { id: number; house_no: string; name: string } | null;
}

/** การแก้ข้อมูลหนึ่งครั้ง — หลังบ้านเขียนอย่างเดียว ไม่มีทางแก้หรือลบแถวนี้ */
export interface ReadingLog {
  id: number;
  meter_readings_id: number;
  bills_id: number | null;
  old_unit: string | number | null;
  new_unit: string | number | null;
  old_total_amount: string | number | null;
  new_total_amount: string | number | null;
  /** รูปเดิมที่ถูกลบทิ้งตอนแนบรูปใหม่ — เก็บชื่อไฟล์ไว้ตอบว่ารูปเดิมหายไปไหน */
  old_photo_path: string | null;
  new_photo_path: string | null;
  reason: string | null;
  edited_by: number;
  edited_role: 'owner' | 'staff';
  edited_at: string;
  editor?: { id: number; fname?: string | null; lname?: string | null } | null;
  member?: { id: number; house_no: string } | null;
}

export interface FlagSummary {
  since: string;
  days: number;
  flags: { flag_type: string; total: number; confirmed_by_person: number }[];
}

export interface HousekeepingStatus {
  photo_retention_days: number;
  purgeable_paid_bills: number;
  pending_unassigned: number;
  stale_unassigned: number;
}

/**
 * หน้าสอบทาน — ธงที่ระบบติดไว้ และงานเก็บกวาดระบบ
 *
 * แยกจาก /bills เพราะคนละคำถาม: /bills ตอบว่า "ใครต้องจ่ายเท่าไหร่"
 * ส่วนที่นี่ตอบว่า "ข้อมูลที่เอาไปคิดเงินนั้นเชื่อได้แค่ไหน"
 */
@Injectable({ providedIn: 'root' })
export class AuditService {
  private http = inject(HttpClient);
  private apiUrl = API_BASE_URL;

  flags(params: { flag_type?: string; members_id?: number; limit?: number } = {}): Observable<ReadingFlag[]> {
    const query = new URLSearchParams();
    if (params.flag_type) query.set('flag_type', params.flag_type);
    if (params.members_id) query.set('members_id', String(params.members_id));
    if (params.limit) query.set('limit', String(params.limit));

    return this.http.get<ReadingFlag[]>(`${this.apiUrl}/audit/flags?${query.toString()}`);
  }

  /**
   * ประวัติการแก้ข้อมูล — ใส่ bills_id เพื่อดูเฉพาะของบิลใบเดียว
   *
   * แยกจาก flags เพราะคนละคำถาม: flags คือ "ระบบสงสัยอะไร" ส่วนตรงนี้คือ "คนไปแก้อะไรไว้"
   */
  readingLogs(params: { bills_id?: number; members_id?: number; limit?: number } = {}): Observable<ReadingLog[]> {
    const query = new URLSearchParams();
    if (params.bills_id) query.set('bills_id', String(params.bills_id));
    if (params.members_id) query.set('members_id', String(params.members_id));
    if (params.limit) query.set('limit', String(params.limit));

    return this.http.get<ReadingLog[]>(`${this.apiUrl}/audit/reading-logs?${query.toString()}`);
  }

  summary(days = 30): Observable<FlagSummary> {
    return this.http.get<FlagSummary>(`${this.apiUrl}/audit/flags/summary?days=${days}`);
  }

  housekeeping(): Observable<HousekeepingStatus> {
    return this.http.get<HousekeepingStatus>(`${this.apiUrl}/audit/housekeeping`);
  }

  /**
   * สั่งเก็บกวาดเดี๋ยวนี้ โดยไม่ต้องรอ cron
   *
   * ⚠️ ลบไฟล์รูปของบิลที่จ่ายแล้วและเก่าเกิน 1 ปี — **กู้คืนไม่ได้**
   *    ให้ดู housekeeping() ก่อนเสมอว่าจะหายอะไรไปบ้าง
   */
  runHousekeeping(): Observable<{
    overdue_marked: number;
    photos_purged: number;
    unassigned_discarded: number;
    orphan_files_removed: number;
  }> {
    return this.http.post<any>(`${this.apiUrl}/audit/housekeeping/run`, {});
  }
}
