import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

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

  // 2. ฟังก์ชันส่งตัวเลขค่าน้ำไปบันทึกลงฐานข้อมูล
  saveBill(readUnit: number | string): Observable<any> {
    // 🌟 แปลงโครงสร้าง Payload ให้ตรงกับ CreateBillDto ตามที่หลังบ้าน (NestJS) ต้องการ
    const parsedUnit = typeof readUnit === 'string' ? parseFloat(readUnit) : readUnit;
    const payload = { 
      meter_readings_id: 1,      // Mock ID ไปก่อน
      water_rates_id: 1,         // Mock ดึงเรท ID ที่ 1
      previous_unit: 0,          // สมมติเดือนที่ก่อนหน้าใช้น้ำไป 0 หน่วย (หรือแก้ Mock ตามต้องการ)
      current_unit: parsedUnit,  // เลขมิเตอร์ที่ได้จาก AI (ที่เรากด Save)
      billing_month: new Date().getMonth() + 1 + '', 
      billing_year: new Date().getFullYear() + ''
    };
    return this.http.post(`${this.apiUrl}/bills`, payload);
  }

  // 🌟 3. ฟังก์ชันสำหรับดึงประวัติบิลทั้งหมดจากฐานข้อมูล (เพิ่มตัวนี้เข้าไปครับ)
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