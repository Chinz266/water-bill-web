import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/api.config';

@Injectable({
  providedIn: 'root'
})
export class MemberService {
  private baseUrl = `${API_BASE_URL}/member`;

  constructor(private http: HttpClient) {}

  // 1. ดึงข้อมูลรายชื่อบ้านทั้งหมด
  getMembers(): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/all`, {}); 
  }

  // 2. บันทึกข้อมูลบ้านพักหลังใหม่
  addMember(data: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/create`, data);
  }

  // 🌟 3. อัปเดตข้อมูลลูกบ้าน (ตรงตาม Swagger POST /member/update)
  updateMember(data: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/update`, data);
  }

  // 🌟 4. ลบข้อมูลลูกบ้านออกจากฐานข้อมูล (ตรงตาม Swagger POST /member/remove)
  deleteMember(id: number): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/remove`, { id });
  }
}