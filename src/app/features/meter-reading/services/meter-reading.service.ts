import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

// เรทค่าน้ำที่ใช้อยู่จริงในระบบ (หลังบ้านคืน price_per_unit มาเป็น string เช่น '15.00')
export interface WaterRate {
  id: number;
  price_per_unit: string | number;
  status: string;
}

// การจดมิเตอร์ 1 ครั้งของบ้าน 1 หลัง
export interface MeterReading {
  id: number;
  reading_date: string;
  meter_unit: number;
  members_id: number;
}

@Injectable({
  providedIn: 'root'
})
export class MeterReadingService {
  // เปลี่ยน URL ให้ตรงกับพอร์ตของ NestJS หลังบ้าน
  private apiUrl = 'http://localhost:3000'; // 🌟 แก้ไข URL ให้ตรงกับพอร์ตของ NestJS หลังบ้าน

  constructor(private http: HttpClient) { }

  // 1. ฟังก์ชันส่งรูปภาพไปให้ AI ประมวลผล
  uploadCroppedImage(formData: FormData): Observable<any> {
    return this.http.post(`${this.apiUrl}/meter-readings/ocr-upload`, formData);
  }

  // 🌟 2. ดึงเรทค่าน้ำที่ใช้งานอยู่ตอนนี้ (ห้าม hardcode id เพราะเรทเปลี่ยนได้ทุกปี)
  getActiveWaterRate(): Observable<WaterRate> {
    return this.http.get<WaterRate>(`${this.apiUrl}/water-rates/active`);
  }

  // 🌟 3. ดึงประวัติการจดมิเตอร์ของบ้านหลังหนึ่ง (เรียงใหม่สุดมาก่อน) เอาไว้หาเลขมิเตอร์เดือนที่แล้ว
  getReadingsByMember(memberId: number): Observable<MeterReading[]> {
    return this.http.get<MeterReading[]>(`${this.apiUrl}/meter-readings/member/${memberId}`);
  }

  // 🌟 4. บันทึกการจดมิเตอร์ลงฐานข้อมูล — ต้องทำก่อนสร้างบิลเสมอ เพราะบิลอ้างถึง meter_readings_id
  createMeterReading(payload: {
    reading_date: string;
    meter_unit: number;
    members_id: number;
    create_by?: number;
  }): Observable<MeterReading> {
    return this.http.post<MeterReading>(`${this.apiUrl}/meter-readings`, payload);
  }

  // 5. ฟังก์ชันสร้างบิลค่าน้ำ (ต้องใช้ id จริงจากขั้นตอนก่อนหน้าทั้งหมด)
  saveBill(payload: {
    meter_readings_id: number;
    water_rates_id: number;
    previous_unit: number;
    current_unit: number;
    create_by?: number;
  }): Observable<any> {
    const now = new Date();
    const body = {
      ...payload,
      // หลังบ้านเก็บเดือน/ปีเป็น string และคาดหวังเดือนแบบ 2 หลัก ('01'-'12')
      billing_month: String(now.getMonth() + 1).padStart(2, '0'),
      billing_year: String(now.getFullYear())
    };
    return this.http.post(`${this.apiUrl}/bills`, body);
  }

  // 🌟 6. ฟังก์ชันสำหรับดึงประวัติบิลทั้งหมดจากฐานข้อมูล
  getBills(): Observable<any> {
    return this.http.get(`${this.apiUrl}/bills`);
  }

  // 🌟 ฟังก์ชันส่งคำสั่งเปลี่ยนสถานะ PENDING <-> PAID
  updatePaymentStatus(id: number, status: string): Observable<any> {
    const payload = { payment_status: status };
    return this.http.patch(`${this.apiUrl}/bills/${id}/status`, payload);
  }

  deleteBill(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/bills/${id}`);
  }
}
