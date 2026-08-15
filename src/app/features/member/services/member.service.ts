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

  /**
   * ลงทะเบียนบ้านแบบ "ไปยืนที่มิเตอร์" — ตัวที่หลังบ้านแนะนำให้ใช้แทน /member/create
   *
   * สร้างบ้าน + การจดครั้งแรกในทรานแซกชันเดียว จึงไม่มีสภาพ "บ้านที่ไม่มีเลขตั้งต้น"
   * ซึ่งอันตรายกว่าไม่มีบ้านเลย เพราะบิลใบแรกจะคิดจาก 0 (ดู member.service.ts ฝั่งหลังบ้าน)
   *
   * พิกัดต้องมาจากจุดที่ยืนอยู่หน้ามิเตอร์จริง ไม่ใช่จิ้มหมุดบนแผนที่ —
   * เพราะตอนจดทุกเดือนพนักงานยืนที่เดิม พิกัดสองฝั่งจะได้มาจากเซนเซอร์เดียวกัน
   */
  registerOnsite(data: {
    fname: string;
    lname: string;
    house_no: string;
    phone?: string;
    villages_id: number;
    create_by?: number;
    latitude: number;
    longitude: number;
    /** ความคลาดเคลื่อนเป็นเมตร — หลังบ้านปฏิเสธถ้าเกิน 50 */
    gps_accuracy_m?: number;
    initial_meter_unit: number;
    /** รูปหน้าปัดตอนลงทะเบียน ส่งเป็น data URL */
    meter_photo?: string;
  }): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/register-onsite`, data);
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