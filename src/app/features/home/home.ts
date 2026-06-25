import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MemberService } from '../member/services/member.service'; // 🌟 ดึง Service ลูกบ้านมาใช้

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './home.html', // (เช็คชื่อไฟล์ html ของลูกพี่ด้วยนะครับ)
  styleUrls: ['./home.css']
})
export class HomeComponent implements OnInit {
  // ตัวแปรเก็บจำนวนบ้าน (ค่าเริ่มต้นเป็น null เพื่อทำสถานะโหลด)
  realTotalHouses: number | null = null; 
  // ตัวแปรเก็บชื่อเดือนปัจจุบัน
  currentMonth: string = '';

  constructor(private memberService: MemberService) {
    // โค้ดดึงชื่อเดือนปัจจุบัน (ภาษาไทย) แบบเรียลไทม์
    const months = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    this.currentMonth = months[new Date().getMonth()];
  }

  ngOnInit(): void {
    // 🌟 วิ่งไปถามหลังบ้าน (NestJS) ว่าตอนนี้มีข้อมูลลูกบ้านกี่หลัง
    this.memberService.getMembers().subscribe({
      next: (members) => {
        // นับจำนวนข้อมูลที่ได้มา แล้วเอาไปโชว์
        this.realTotalHouses = members ? members.length : 0;
      },
      error: (err) => {
        console.error('ดึงข้อมูลจริงไม่สำเร็จ:', err);
        this.realTotalHouses = 0; // ถ้าหลังบ้านพัง ให้โชว์เป็น 0 ไปก่อน
      }
    });
  }
}