import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, catchError, of } from 'rxjs';
import { toast } from 'ngx-sonner';
import { MemberService } from '../../services/member.service';
import { AuthService } from '../../../auth/services/auth.service';

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

  // 🌟 ลูกบ้านที่กำลังจะลบ — ใช้เปิดหน้าต่างยืนยันก่อนลบจริง
  memberToDelete: any = null;

  // 🌟 ตัวแปรสำหรับเก็บสถานะความผิดพลาด (ใช้ดักข้อมูลโชว์บนหน้าจอ)
  addErrors = { house_no: '', fname: '', phone: '' };
  editErrors = { house_no: '', fname: '', phone: '' };

  private auth = inject(AuthService);

  constructor(private memberService: MemberService) { }

  ngOnInit(): void {
    this.loadMembers();
  }

  loadMembers() {
    this.members$ = this.memberService.getMembers().pipe(
      catchError(err => {
        console.error('ดึงข้อมูลสมาชิกไม่สำเร็จ:', err);
        toast.error('โหลดรายชื่อลูกบ้านไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', { id: 'member-load-error' });
        return of([]); // ถ้าดึงข้อมูลไม่สำเร็จ ให้คืนค่าเป็น array ว่าง
      })
    );
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
      errorsObj.house_no = 'กรุณากรอกบ้านเลขที่';
      isValid = false;
    }

    // 2. ดักข้อมูลชื่อจริง (ห้ามว่าง)
    if (!member.fname || member.fname.trim() === '') {
      errorsObj.fname = 'กรุณากรอกชื่อจริงเจ้าบ้าน';
      isValid = false;
    }

    // 3. ดักข้อมูลเบอร์โทรศัพท์ (ถ้ากรอก ต้องเป็นตัวเลข 9-10 หลัก)
    if (member.phone && member.phone.trim() !== '') {
      const phoneRegex = /^0\d{8,9}$/; // ขึ้นต้นด้วย 0 ตามด้วยเลข 8-9 ตัว
      // ลบแดช (-) ออกก่อนตรวจ เผื่อผู้ใช้งานกรอกแบบมีขีดมา
      const cleanPhone = member.phone.replace(/-/g, '');
      if (!phoneRegex.test(cleanPhone)) {
        errorsObj.phone = 'เบอร์โทรศัพท์ไม่ถูกต้อง (ต้องมี 9-10 หลัก เช่น 0812345678)';
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

    // หลังบ้านบังคับ create_by (คอลัมน์ห้ามเป็น NULL) — ใช้ id ของแอดมินที่ล็อกอินอยู่
    this.memberService.addMember({ ...this.newMember, create_by: this.auth.admin()?.id }).subscribe({
      next: () => {
        this.closeAddModal();
        toast.success('เพิ่มบ้านใหม่เรียบร้อยแล้ว', { id: 'member-added' });
        this.loadMembers(); // 🌟 โหลดรายชื่อใหม่ให้ตารางอัปเดตทันที
      },
      error: (err: any) => {
        console.error('Add member error:', err);
        toast.error('เพิ่มข้อมูลไม่สำเร็จ กรุณาตรวจสอบข้อมูลอีกครั้ง', { id: 'member-add-error' });
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
      next: () => {
        this.closeEditModal();
        toast.success('บันทึกการแก้ไขเรียบร้อยแล้ว', { id: 'member-updated' });
        this.loadMembers();
      },
      error: (err: any) => {
        const errorMsg = err.error?.message || err.message || 'ไม่ทราบสาเหตุ';
        console.error('Update member error:', err);
        toast.error(`แก้ไขข้อมูลไม่สำเร็จ: ${errorMsg}`, { id: 'member-update-error' });
      }
    });
  }

  // --- 🗑️ ถามยืนยันก่อนลบ (แทน confirm() ของเบราว์เซอร์) ---
  askDelete(member: any) {
    this.memberToDelete = member;
  }

  cancelDelete() {
    this.memberToDelete = null;
  }

  confirmDelete() {
    if (!this.memberToDelete) return;

    const id = this.memberToDelete.id;
    this.memberToDelete = null;
    this.deleteMember(id);
  }

  // --- 🗑️ ฟังก์ชันสำหรับ ลบข้อมูล (Delete) ---
  deleteMember(id: number) {
    this.memberService.deleteMember(id).subscribe({
      next: () => {
        toast.success('ลบข้อมูลบ้านเรียบร้อยแล้ว', { id: 'member-deleted' });
        this.loadMembers();
      },
      error: (err: any) => {
        const errorMsg = err.error?.message || err.message || 'ไม่ทราบสาเหตุ';
        console.error('Delete member error:', err);
        toast.error(`ลบข้อมูลไม่สำเร็จ: ${errorMsg}`, { id: 'member-delete-error' });
      }
    });
  }
}
