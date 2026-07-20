import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/api.config';

// ตรงกับ VillageEntity ฝั่งหลังบ้าน
export interface Village {
  id: number;
  provinces_id: number;
  districts_id: number;
  subdistricts_id: number;
  village_name: string;
  village_no: string;
  headman_name: string | null;
  deputy_headman_name: string | null;
  phone: string | null;
  billing_month: string | null;
  create_by: number;
  create_date: string;
  modify_by: number | null;
  modify_date: string | null;
}

// ส่งเฉพาะฟิลด์ที่หน้าตั้งค่าแก้ได้ (ตรงกับ UpdateVillageDto)
export interface UpdateVillagePayload {
  village_name?: string;
  village_no?: string;
  headman_name?: string;
  deputy_headman_name?: string;
  phone?: string;
  billing_month?: string;
}

@Injectable({ providedIn: 'root' })
export class VillageService {
  private baseUrl = `${API_BASE_URL}/villages`;
  private http = inject(HttpClient);

  getVillages(): Observable<Village[]> {
    return this.http.get<Village[]>(this.baseUrl);
  }

  getVillage(id: number): Observable<Village> {
    return this.http.get<Village>(`${this.baseUrl}/${id}`);
  }

  // PATCH /villages/:id — modify_by หลังบ้านอ่านจาก token เอง ไม่ต้องส่งมา
  updateVillage(id: number, payload: UpdateVillagePayload): Observable<Village> {
    return this.http.patch<Village>(`${this.baseUrl}/${id}`, payload);
  }
}
