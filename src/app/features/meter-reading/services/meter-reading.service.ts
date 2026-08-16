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

  /**
   * อ่านรูปหลายใบพร้อมกันแล้วให้หลังบ้านเดาว่ารูปไหนเป็นของบ้านหลังไหน
   *
   * หลังบ้านจับคู่จาก **เลขมิเตอร์** ไม่ใช่ GPS — เลขมิเตอร์เป็นยอดสะสมที่แต่ละบ้าน
   * ห่างกันมาก จึงชี้กลับไปหาบ้านต้นทางได้เอง ส่วน GPS มือถือคลาดเคลื่อน 10–30 ม.
   * ขณะที่บ้านห่างกันแค่ 8–20 ม. จึงใช้เป็นแค่ตัวช่วยตัดสินตอนเลขแยกไม่ออก
   *
   * ⚠️ endpoint นี้ไม่เขียนอะไรลงฐานข้อมูล คืนแค่ข้อเสนอให้คนตรวจ
   *    ออกบิลจริงต้องยิง /bills/scan ทีละหลัง เพราะด่านกันข้อมูลผิดอยู่ที่นั่น
   */
  scanBatch(formData: FormData): Observable<any> {
    return this.http.post(`${this.apiUrl}/bills/scan-batch`, formData);
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
    /**
     * พิกัดจุดที่ยืนถ่ายรูป (จาก EXIF) — หลังบ้านเก็บไว้เรียนรู้ตำแหน่งมิเตอร์ของบ้านหลังนี้
     * EXIF ไม่มีค่าความคลาดเคลื่อนติดมา จึงไม่มี gps_accuracy_m ให้ส่ง
     */
    latitude?: number;
    longitude?: number;
    /** วันเวลาที่กดชัตเตอร์จริง (ISO) เก็บเป็นหลักฐานคู่กับรูป */
    captured_at?: string;
    /** รูปหน้าปัดเป็น data URL — หลังบ้านเก็บเป็นไฟล์แล้วบันทึก path ไว้ */
    meter_photo?: string;
    /** ยืนยันว่าเลขที่ต่ำลงเกิดจากเปลี่ยนมิเตอร์/มิเตอร์ครบรอบ ไม่ใช่จดผิด */
    confirm_meter_reset?: boolean;
    /** เลขปิดของมิเตอร์ตัวเก่า (ใช้คู่กับ confirm_meter_reset) */
    old_meter_final_unit?: number;
    /**
     * จำนวนหลักบนหน้าปัดที่ AI อ่านได้ — หลังบ้านเอาไปเทียบกับที่บ้านหลังนี้เคยอ่านได้
     * เพื่อจับเคส "อ่านหลักหาย/หลักเกิน" ซึ่งทำให้ยอดคลาดสิบเท่าในครั้งเดียว
     *
     * ⚠️ ส่งเฉพาะตอนที่เลขยังเป็นค่าที่ AI อ่านมาเป๊ะ ๆ — คนแก้เลขเองเมื่อไหร่ต้องไม่ส่ง
     * เพราะจำนวนหลักที่ AI นับไว้จะไม่ตรงกับเลขที่จะบันทึกจริง (หลังบ้านข้ามด่านนี้ให้เอง)
     */
    meter_digits?: number;
    /** ยืนยันว่าจำนวนหลักที่เปลี่ยนไปถูกต้อง (เช่นเพิ่งเปลี่ยนมิเตอร์เป็นรุ่นคนละหลัก) */
    confirm_digit_change?: boolean;
    /**
     * ความมั่นใจของ AI ตอนอ่านเลข เป็นค่าดิบ 0–1 (หลังบ้านตัดที่ 0.85)
     *
     * ด่านนี้จับเคสที่เลขคลาดไปหลักเดียว เช่น 1250 → 1258 ซึ่งลอดด่านหน่วยน้ำกับ
     * ด่านจำนวนหลักไปได้สบาย เพราะยอดยังดูปกติทุกทาง
     *
     * ⚠️ ส่งเฉพาะตอนที่เลขยังเป็นค่าที่ AI อ่านมาเป๊ะ ๆ เงื่อนไขเดียวกับ meter_digits —
     *    เลขที่คนเทียบกับหน้าปัดแล้วพิมพ์เองเชื่อได้กว่าค่าที่ AI เดา ไม่ควรโดนด่านนี้บล็อก
     *    (ไม่ส่ง = หลังบ้านข้ามด่านให้ แล้วเก็บ read_confidence เป็น NULL ซึ่งถูกแล้ว)
     */
    read_confidence?: number;
    /** ยืนยันว่าเทียบกับรูปแล้วเลขที่ AI อ่านมาไม่ชัดนั้นถูกต้อง */
    confirm_low_confidence?: boolean;
    /** ยืนยันว่าเป็นรูปที่ถ่ายใหม่จริง ไม่ใช่รูปเดิมที่ถูกส่งซ้ำ (พิกัดตรงกันเป๊ะทุกทศนิยม) */
    confirm_duplicate_location?: boolean;
    /** ยืนยันว่าใช้รูปถูกใบ ทั้งที่วันถ่ายเก่ากว่ารอบที่กำลังออก */
    confirm_stale_photo?: boolean;
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
