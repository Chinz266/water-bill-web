import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/api.config';

// เรทค่าน้ำที่ใช้อยู่จริงในระบบ (หลังบ้านคืน price_per_unit มาเป็น string เช่น '15.00')
export interface WaterRate {
  id: number;
  price_per_unit: string | number;
  status: string;
  create_date?: string;
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
  private apiUrl = API_BASE_URL;

  constructor(private http: HttpClient) { }

  // 1. ฟังก์ชันส่งรูปภาพไปให้ AI ประมวลผล
  uploadCroppedImage(formData: FormData): Observable<any> {
    return this.http.post(`${this.apiUrl}/meter-readings/ocr-upload`, formData);
  }

  // 🌟 2. ดึงเรทค่าน้ำที่ใช้งานอยู่ตอนนี้ (ห้าม hardcode id เพราะเรทเปลี่ยนได้ทุกปี)
  getActiveWaterRate(): Observable<WaterRate> {
    return this.http.get<WaterRate>(`${this.apiUrl}/water-rates/active`);
  }

  // ประวัติเรทค่าน้ำทั้งหมด (ใหม่สุดก่อน) — ใช้ในหน้าตั้งค่า
  getWaterRates(): Observable<WaterRate[]> {
    return this.http.get<WaterRate[]>(`${this.apiUrl}/water-rates`);
  }

  // ตั้งเรทค่าน้ำใหม่ — หลังบ้านจะปิดเรทเก่าให้อัตโนมัติ เรทใหม่มีผลกับบิลที่ออกหลังจากนี้
  createWaterRate(pricePerUnit: number, createBy: number): Observable<WaterRate> {
    return this.http.post<WaterRate>(`${this.apiUrl}/water-rates`, {
      price_per_unit: pricePerUnit,
      status: 'Active',
      create_by: createBy
    });
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

  /** บิลของบ้านหลังนี้ในเดือน/ปีที่ระบุ — null ถ้ายังไม่เคยออกบิล (1 บ้านมีบิลได้เดือนละใบ) */
  getBillForMonth(memberId: number, month: string, year: string): Observable<any> {
    return this.http.get(
      `${this.apiUrl}/bills/member/${memberId}/month?month=${month}&year=${year}`
    );
  }

  /**
   * เลขตั้งต้นที่หลังบ้านจะใช้คิดหน่วยน้ำของเดือนนั้นจริง ๆ
   * คืน { previous_unit, source, bill } — source บอกว่ามาจากบิลเดือนก่อนหรือเลขตอนลงทะเบียนบ้าน
   * ต้องถามหลังบ้าน ไม่ใช่เดาเองจาก "การจดครั้งล่าสุด" ไม่งั้นเลขบนจอกับยอดที่ออกจะคนละตัว
   */
  getPreviousUnit(memberId: number, month: string, year: string): Observable<any> {
    return this.http.get(
      `${this.apiUrl}/bills/member/${memberId}/previous?month=${month}&year=${year}`
    );
  }

  /**
   * 5. จดมิเตอร์ + ออกบิล ในคำสั่งเดียว
   *
   * เดิมยิงสองรอบ (สร้าง meter_reading → สร้างบิล) ซึ่งถ้ารอบสองล้ม เช่นโดนด่าน
   * กันบิลซ้ำเดือนหรือด่านหน่วยน้ำผิดปกติ แถวที่จดไปแล้วจะค้างเป็นขยะในตาราง
   * ตอนนี้หลังบ้านตรวจให้ผ่านก่อนแล้วค่อยเขียนทั้งคู่ในทรานแซกชันเดียว
   *
   * ไม่มี previous_unit / usage_unit / total_amount ใน payload โดยตั้งใจ — หลังบ้านคิดเองทั้งหมด
   */
  saveBillFromScan(payload: {
    members_id: number;
    water_rates_id: number;
    current_unit: number;
    reading_date?: string;
    create_by?: number;
    /** true = ลบบิลเดือนเดียวกันใบเดิมทิ้งแล้วออกใหม่ */
    replace?: boolean;
    /** true = ยืนยันว่าหน่วยน้ำที่สูงผิดปกตินั้นถูกต้อง (หลังบ้านบล็อกไว้จนกว่าจะยืนยัน) */
    confirm_high_usage?: boolean;
    /** เดือนบิลแบบ 2 หลัก ('01'-'12') — มาจากที่เจ้าหน้าที่เลือก ไม่ใช่วันที่กดบันทึก */
    billing_month: string;
    billing_year: string;
  }): Observable<any> {
    return this.http.post(`${this.apiUrl}/bills/scan`, payload);
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
