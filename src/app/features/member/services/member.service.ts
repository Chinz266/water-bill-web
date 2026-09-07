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

  /**
   * ลงทะเบียนบ้านแบบ "ไปยืนที่มิเตอร์" — ตัวที่หลังบ้านแนะนำให้ใช้แทน /member/create
   *
   * สร้างบ้าน + การจดครั้งแรกในทรานแซกชันเดียว จึงไม่มีสภาพ "บ้านที่ไม่มีเลขตั้งต้น"
   * ซึ่งอันตรายกว่าไม่มีบ้านเลย เพราะบิลใบแรกจะคิดจาก 0 (ดู member.service.ts ฝั่งหลังบ้าน)
   *
   * พิกัดมาจาก EXIF ของรูปหน้าปัดเท่านั้น (ไม่ใช่จิ้มหมุดบนแผนที่ ไม่ใช่วัดจากเครื่อง) —
   * รูปถูกกดชัตเตอร์ตอนยืนอยู่หน้ามิเตอร์จริง ค่าที่ได้จึงเป็นตำแหน่งมิเตอร์เสมอ
   * และไม่มี `gps_accuracy_m` ติดมาด้วย จึงไม่ส่งขึ้นไป
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
    initial_meter_unit: number;
    /**
     * วันที่จดเลขตั้งต้น (YYYY-MM-DD) — เอามาจากวันถ่ายรูปหน้าปัด ไม่ใช่วันที่กดบันทึก
     *
     * วันนี้คือจุดเริ่มรอบบิลใบแรกของบ้านหลังนี้ ถ้าลงเป็นวันที่กรอกข้อมูลย้อนหลัง
     * รอบแรกจะสั้นหรือยาวกว่าความจริงไปเป็นสัปดาห์ แล้วหน่วยน้ำต่อวันของบ้านหลังนี้
     * จะเทียบกับเดือนอื่นไม่ได้ทั้งปี
     */
    reading_date?: string;
    /** รูปหน้าปัดตอนลงทะเบียน ส่งเป็น data URL */
    meter_photo?: string;
  }): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/register-onsite`, data);
  }

  // 🌟 3. อัปเดตข้อมูลลูกบ้าน (ตรงตาม Swagger POST /member/update)
  updateMember(data: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/update`, data);
  }

  /**
   * แก้เลขมิเตอร์ตั้งต้นของบ้านที่ลงทะเบียนไปแล้ว (POST /member/initial-reading)
   *
   * แยกจาก updateMember() เพราะเป็นคนละเรื่องกัน: อันนั้นแก้ข้อมูลบ้าน ส่วนอันนี้แก้
   * "การจดมิเตอร์ครั้งแรก" ซึ่งเป็นเส้นเริ่มต้นที่บิลใบแรกเอาไปลบ — หลังบ้านจึงบังคับ
   * ให้กรอกเหตุผลทุกครั้งและเก็บลง meter_reading_logs ไว้ตามรอยย้อนหลัง
   */
  updateInitialReading(data: {
    id: number;
    initial_meter_unit: number;
    reason: string;
    changed_by?: number;
  }): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/initial-reading`, data);
  }

  /**
   * เลขตั้งต้นของบ้านหลังนี้ = การจดครั้งแรกสุด
   *
   * `/member/all` ไม่ได้ส่งค่านี้มาด้วย (คืนแค่ตารางลูกบ้าน) จึงต้องถามจากประวัติการจด
   * แล้วหยิบรายการที่ id น้อยที่สุด — หลังบ้านเรียงให้ใหม่สุดขึ้นก่อน และ reading_date
   * เป็น date ล้วน วันเดียวกันจึงเรียงไม่ออก ต้องดู id เป็นตัวตัดสินเหมือนฝั่งหลังบ้าน
   */
  getInitialReading(memberId: number): Observable<any> {
    return this.http.get<any>(`${API_BASE_URL}/meter-readings/member/${memberId}`);
  }

  // 🌟 4. ลบข้อมูลลูกบ้านออกจากฐานข้อมูล (ตรงตาม Swagger POST /member/remove)
  deleteMember(id: number): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/remove`, { id });
  }
}