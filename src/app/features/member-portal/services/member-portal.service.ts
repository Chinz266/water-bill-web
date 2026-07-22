import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/api.config';

/**
 * ข้อมูลฝั่งลูกบ้าน — หลังบ้านกรองให้แล้วว่าเห็นได้เฉพาะบ้านที่ผูกกับบัญชีตัวเอง
 * (endpoint /me/* อ่าน id บัญชีจาก JWT ไม่รับ memberId จากหน้าเว็บ)
 */
@Injectable({ providedIn: 'root' })
export class MemberPortalService {
  private apiUrl = API_BASE_URL;
  private http = inject(HttpClient);

  /** บ้านทุกหลังที่บัญชีนี้ดูแล (บางคนดูแลหลายหลัง เช่น บ้านตัวเอง + บ้านญาติ) */
  getMyHouses(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/me/houses`);
  }

  /** บิลของทุกบ้านที่ดูแล พร้อมข้อมูลบ้าน/การจดมิเตอร์/เรทค่าน้ำ (โครงเดียวกับฝั่งเจ้าหน้าที่) */
  getMyBills(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/me/bills`);
  }

  /** ข้อมูลผู้ดูแลไว้ติดต่อ (ชื่อ + เบอร์โทร) */
  getAdmins(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/me/admins`);
  }
}
