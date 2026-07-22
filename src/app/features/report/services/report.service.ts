import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/api.config';

/** เรื่องที่ลูกบ้านแจ้ง (โครงเดียวกับที่หลังบ้านส่งกลับมา) */
export interface Report {
  id: number;
  members_id: number;
  account_id: number;
  category: string;
  detail: string;
  photo: string | null;
  status: 'Pending' | 'InProgress' | 'Resolved';
  admin_reply: string | null;
  replied_by: number | null;
  replied_date: string | null;
  create_date: string;
  modify_date: string | null;
  /** บ้านเจ้าของเรื่อง (หลังบ้าน join มาให้) */
  member: {
    id: number;
    house_no: string;
    fname: string;
    lname: string;
    phone: string;
  } | null;
  /** ผู้ดูแลที่ตอบกลับ (null = ยังไม่มีใครตอบ) */
  replier: { id: number; fname: string; lname: string } | null;
}

/** ข้อมูลที่ลูกบ้านส่งตอนแจ้งเรื่องใหม่ */
export interface CreateReportPayload {
  members_id: number;
  category: string;
  detail: string;
  photo?: string | null;
}

@Injectable({ providedIn: 'root' })
export class ReportService {
  private http = inject(HttpClient);

  // ==========================================
  // ฝั่งลูกบ้าน — /me/* อ่าน id บัญชีจาก JWT ไม่รับจากหน้าเว็บ
  // ==========================================

  /** เรื่องที่บ้านของฉันแจ้งไว้ (ใหม่สุดก่อน) */
  getMyReports(): Observable<Report[]> {
    return this.http.get<Report[]>(`${API_BASE_URL}/me/reports`);
  }

  /** แจ้งเรื่องใหม่ — หลังบ้านเช็คว่า members_id เป็นบ้านที่บัญชีนี้ดูแลจริง */
  createMyReport(payload: CreateReportPayload): Observable<Report> {
    return this.http.post<Report>(`${API_BASE_URL}/me/reports`, payload);
  }

  // ==========================================
  // ฝั่งเจ้าหน้าที่ — เห็นทุกบ้าน
  // ==========================================

  getReports(): Observable<Report[]> {
    return this.http.get<Report[]>(`${API_BASE_URL}/reports`);
  }

  /**
   * ตอบกลับ และ/หรือ เปลี่ยนสถานะ (ส่งมาแค่อย่างใดอย่างหนึ่งก็ได้)
   * replied_by หลังบ้านอ่านจาก token เอง ไม่ต้องส่งมา
   */
  replyReport(
    id: number,
    payload: { admin_reply?: string; status?: string }
  ): Observable<Report> {
    return this.http.patch<Report>(`${API_BASE_URL}/reports/${id}`, payload);
  }

  deleteReport(id: number): Observable<any> {
    return this.http.delete(`${API_BASE_URL}/reports/${id}`);
  }
}
