import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/api.config';

/** ข้อมูลโปรไฟล์ผู้ดูแลที่แก้ได้จากหน้าตั้งค่า (ไม่รวมรหัสผ่าน) */
export interface AdminProfilePayload {
  id: number;
  fname: string;
  lname: string;
  phone: string;
  // รูปโปรไฟล์แบบ base64 data URL, null = ลบรูป, undefined = ไม่แตะรูปเดิม
  photo?: string | null;
}

@Injectable({ providedIn: 'root' })
export class AccountService {
  private http = inject(HttpClient);

  // POST /admin/update — หลังบ้านแก้เฉพาะฟิลด์ที่ส่งไป (ไม่แตะรหัสผ่าน/บทบาท)
  updateProfile(payload: AdminProfilePayload): Observable<any> {
    return this.http.post(`${API_BASE_URL}/admin/update`, payload);
  }
}
