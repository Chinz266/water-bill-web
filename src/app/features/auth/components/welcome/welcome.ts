import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';

/**
 * หน้าทางเข้าระบบ — จุดแรกที่คนยังไม่ล็อกอินเจอ
 * แยกทางเข้า "ลูกบ้าน" กับ "เจ้าหน้าที่" เป็นปุ่มใหญ่ 2 ปุ่ม
 * จะได้ไม่ต้องรู้ URL หรือไปหาลิงก์ตัวเล็ก ๆ ท้ายหน้า login
 */
@Component({
  selector: 'app-welcome',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './welcome.html',
  styleUrls: ['./welcome.css']
})
export class WelcomeComponent {}
