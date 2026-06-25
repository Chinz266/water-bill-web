import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, catchError, of } from 'rxjs';
import { MemberService } from '../../services/member.service';

@Component({
  selector: 'app-member-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './member-list.html',
  styleUrls: ['./member-list.css']
})
export class MemberListComponent implements OnInit {
  members$!: Observable<any[]>;
  isLoading = true;
  isFetching = false;

  showAddModal: boolean = false;
  newMember = { house_no: '', fname: '', lname: '', phone: '', villages_id: 1 };

  showEditModal: boolean = false;
  editingMember: any = { id: null, house_no: '', fname: '', lname: '', phone: '', villages_id: 1 };

  // 🌟 ตัวแปรสำหรับเก็บสถานะความผิดพลาด (ใช้ดักข้อมูลโชว์บนหน้าจอ)
  addErrors = { house_no: '', fname: '', phone: '' };
  editErrors = { house_no: '', fname: '', phone: '' };

  constructor(private memberService: MemberService) { }

  ngOnInit(): void {
    this.loadMembers();
  }

  loadMembers() {
    if (this.members$) {
      // ถ้ามี Observable อยู่แล้ว ให้รีเฟรชข้อมูลใหม่
      this.members$ = this.memberService.getMembers().pipe(
        catchError(err => {
          console.error('ดึงข้อมูลสมาชิกไม่สำเร็จ:', err);
          return of([]); // ถ้าดึงข้อมูลไม่สำเร็จ ให้คืนค่าเป็น array ว่าง
        })
      );
    } else {
      // ถ้าไม่มี Observable อยู่ ให้สร้างใหม่
      this.members$ = this.memberService.getMembers().pipe(
        catchError(err => {
          console.error('ดึงข้อมูลสมาชิกไม่สำเร็จ:', err);
          return of([]); // ถ้าดึงข้อมูลไม่สำเร็จ ให้คืนค่าเป็น array ว่าง
        })
      );
    }
  }

  // --- 🌟 ฟังก์ชันหลักสำหรับดักข้อมูล (Validation Logic) ---
  validateMember(member: any, errorsObj: any): boolean {
    let isValid = true;

    // เคลียร์ค่า Error เก่าก่อนตรวจใหม่
    errorsObj.house_no = '';
    errorsObj.fname = '';
    errorsObj.phone = '';

    // 1. ดักข้อมูลบ้านเลขที่ (ห้ามว่าง)
    if (!member.house_no || member.house_no.trim() === '') {
      errorsObj.house_no = '❌ กรุณากรอกบ้านเลขที่';
      isValid = false;
    }

    // 2. ดักข้อมูลชื่อจริง (ห้ามว่าง)
    if (!member.fname || member.fname.trim() === '') {
      errorsObj.fname = '❌ กรุณากรอกชื่อจริงเจ้าบ้าน';
      isValid = false;
    }

    // 3. ดักข้อมูลเบอร์โทรศัพท์ (ถ้ากรอก ต้องเป็นตัวเลข 9-10 หลัก)
    if (member.phone && member.phone.trim() !== '') {
      const phoneRegex = /^0\d{8,9}$/; // ขึ้นต้นด้วย 0 ตามด้วยเลข 8-9 ตัว
      // ลบแดช (-) ออกก่อนตรวจ เผื่อผู้ใช้งานกรอกแบบมีขีดมา
      const cleanPhone = member.phone.replace(/-/g, '');
      if (!phoneRegex.test(cleanPhone)) {
        errorsObj.phone = '❌ รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง (ต้องมี 9-10 หลัก เช่น 0812345678)';
        isValid = false;
      }
    }

    return isValid;
  }

  // --- การจัดการเพิ่มข้อมูล ---
  openAddModal() {
    this.showAddModal = true;
  }

  closeAddModal() {
    this.showAddModal = false;
    this.newMember = { house_no: '', fname: '', lname: '', phone: '', villages_id: 1 };
    this.addErrors = { house_no: '', fname: '', phone: '' }; // ล้าง error ทิ้ง
  }

  saveMember() {
    if (!this.validateMember(this.newMember, this.addErrors)) return;

    this.memberService.addMember(this.newMember).subscribe({
      next: () => {
        this.closeAddModal();
        alert('✅ เพิ่มข้อมูลบ้านใหม่เรียบร้อยครับ!');
        window.location.reload(); // 🌟 สั่งรีเฟรชหน้าเว็บอัตโนมัติ
      },
      error: (err: any) => {
        alert('❌ เพิ่มข้อมูลไม่สำเร็จ กรุณาเช็คความถูกต้องอีกครั้งครับ');
      }
    });
  }

  // --- การจัดการแก้ไขข้อมูล ---
  openEditModal(member: any) {
    this.editingMember = { ...member };
    this.showEditModal = true;
  }

  closeEditModal() {
    this.showEditModal = false;
    this.editingMember = { id: null, house_no: '', fname: '', lname: '', phone: '', villages_id: 1 };
    this.editErrors = { house_no: '', fname: '', phone: '' }; // ล้าง error ทิ้ง
  }

  // --- 🛠️ ฟังก์ชันสำหรับ แก้ไขข้อมูล (Update) ---
  updateMember() {
    if (!this.validateMember(this.editingMember, this.editErrors)) return;

    this.memberService.updateMember(this.editingMember).subscribe({
      next: (res) => {
        this.closeEditModal();
        alert('✅ บันทึกการแก้ไขข้อมูลเรียบร้อยครับ!');
        window.location.reload(); // 🌟 สั่งรีเฟรชหน้าเว็บอัตโนมัติ
      },
      error: (err: any) => {
        const errorMsg = err.error?.message || err.message || 'ไม่ทราบสาเหตุ';
        alert(`❌ แก้ไขข้อมูลไม่สำเร็จ!\nสาเหตุ: ${errorMsg}`);
      }
    });
  }

  // --- 🗑️ ฟังก์ชันสำหรับ ลบข้อมูล (Delete) ---
  deleteMember(id: number, houseNo: string) {
    if (confirm(`❓ คุณต้องการลบข้อมูลบ้านเลขที่ "${houseNo}" ใช่หรือไม่? ข้อมูลจะหายไปถาวร`)) {
      this.memberService.deleteMember(id).subscribe({
        next: (res) => {
          alert('✅ ลบข้อมูลเรียบร้อยครับ!');
          window.location.reload(); // 🌟 สั่งรีเฟรชหน้าเว็บอัตโนมัติ
        },
        error: (err: any) => {
          const errorMsg = err.error?.message || err.message || 'ไม่ทราบสาเหตุ';
          alert(`❌ ลบข้อมูลไม่สำเร็จ!\nสาเหตุ: ${errorMsg}`);
        }
      });
    }
  }
}