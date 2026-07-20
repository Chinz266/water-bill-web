import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, catchError, of } from 'rxjs';
import { toast } from 'ngx-sonner';
import { MemberService } from '../../services/member.service';
import { MeterReadingService } from '../../../meter-reading/services/meter-reading.service';
import { AuthService } from '../../../auth/services/auth.service';
import { extractErrorMessage } from '../../../auth/services/auth-error';
import { Village, VillageService } from '../../../village/services/village.service';

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

  // 🌟 หมู่บ้านจริงจากระบบ — บ้านทุกหลังต้องสังกัดหมู่บ้าน (เลิก hardcode villages_id: 1)
  villages: Village[] = [];

  showAddModal: boolean = false;
  // initial_unit = เลขมิเตอร์ ณ วันลงทะเบียน เอาไว้เป็นจุดตั้งต้นให้บิลเดือนแรกคิดถูก
  newMember: any = { house_no: '', fname: '', lname: '', phone: '', villages_id: null, initial_unit: null };

  showEditModal: boolean = false;
  editingMember: any = { id: null, house_no: '', fname: '', lname: '', phone: '', villages_id: null };

  // 🌟 ลูกบ้านที่กำลังจะลบ — ใช้เปิดหน้าต่างยืนยันก่อนลบจริง
  memberToDelete: any = null;

  // 🌟 ตัวแปรสำหรับเก็บสถานะความผิดพลาด (ใช้ดักข้อมูลโชว์บนหน้าจอ)
  addErrors = { house_no: '', fname: '', phone: '' };
  editErrors = { house_no: '', fname: '', phone: '' };

  private auth = inject(AuthService);

  constructor(
    private memberService: MemberService,
    private meterReadingService: MeterReadingService,
    private villageService: VillageService
  ) { }

  ngOnInit(): void {
    this.loadMembers();

    this.villageService.getVillages().subscribe({
      next: (villages) => {
        this.villages = villages ?? [];
      },
      error: (err) => {
        console.error('โหลดรายชื่อหมู่บ้านไม่สำเร็จ:', err);
        toast.error('โหลดรายชื่อหมู่บ้านไม่สำเร็จ กรุณาลองเปิดหน้านี้ใหม่', { id: 'village-load-error' });
      }
    });
  }

  /** ชื่อหมู่บ้านไว้โชว์ใน dropdown เช่น "หมู่ 4 — หมู่บ้านอยู่สบาย" */
  villageLabel(village: Village): string {
    return [village.village_no, village.village_name].filter(Boolean).join(' — ');
  }

  loadMembers() {
    this.members$ = this.memberService.getMembers().pipe(
      catchError(err => {
        console.error('ดึงข้อมูลสมาชิกไม่สำเร็จ:', err);
        toast.error(extractErrorMessage(err, 'โหลดรายชื่อลูกบ้านไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), { id: 'member-load-error' });
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
    // มีหมู่บ้านเดียว (กรณีปกติของระบบหมู่บ้านเดี่ยว) เลือกให้เลย ไม่ต้องให้ผู้ใช้กดเอง
    if (this.newMember.villages_id === null && this.villages.length === 1) {
      this.newMember.villages_id = this.villages[0].id;
    }
    this.showAddModal = true;
  }

  closeAddModal() {
    this.showAddModal = false;
    this.newMember = { house_no: '', fname: '', lname: '', phone: '', villages_id: null, initial_unit: null };
    this.addErrors = { house_no: '', fname: '', phone: '' }; // ล้าง error ทิ้ง
  }

  saveMember() {
    if (!this.validateMember(this.newMember, this.addErrors)) return;

    if (!this.newMember.villages_id) {
      toast.error('กรุณาเลือกหมู่บ้านก่อนบันทึกนะครับ', { id: 'need-village' });
      return;
    }

    const adminId = this.auth.admin()?.id;

    // หลังบ้านบังคับ create_by (คอลัมน์ห้ามเป็น NULL) — ใช้ id ของแอดมินที่ล็อกอินอยู่
    this.memberService.addMember({ ...this.newMember, create_by: adminId }).subscribe({
      next: (created: any) => {
        const memberId = created?.id;
        const initialUnit = Number(this.newMember.initial_unit);
        const hasInitial =
          this.newMember.initial_unit !== null &&
          this.newMember.initial_unit !== '' &&
          !isNaN(initialUnit) &&
          initialUnit >= 0;

        // ถ้ากรอกเลขมิเตอร์เริ่มต้นมา ให้บันทึกเป็นการจดครั้งแรกของบ้านหลังนี้
        // เดือนถัดไปเวลาออกบิล ระบบจะใช้เลขนี้เป็น "เลขครั้งก่อน" ให้อัตโนมัติ
        if (memberId && hasInitial) {
          this.meterReadingService
            .createMeterReading({
              reading_date: new Date().toISOString().slice(0, 10),
              meter_unit: initialUnit,
              members_id: memberId,
              create_by: adminId
            })
            .subscribe({
              next: () => {
                this.closeAddModal();
                toast.success('เพิ่มบ้านใหม่และบันทึกเลขมิเตอร์เริ่มต้นแล้ว', { id: 'member-added' });
                this.loadMembers();
              },
              error: (err) => {
                // บ้านถูกเพิ่มสำเร็จแล้ว แค่บันทึกเลขตั้งต้นไม่ผ่าน — ไม่ต้องลบบ้านทิ้ง
                console.error('Save initial reading error:', err);
                this.closeAddModal();
                toast.warning(
                  'เพิ่มบ้านแล้ว แต่บันทึกเลขมิเตอร์เริ่มต้นไม่สำเร็จ กรุณาไปจดที่หน้าสแกนมิเตอร์',
                  { id: 'member-added-no-reading' }
                );
                this.loadMembers();
              }
            });
        } else {
          this.closeAddModal();
          toast.success('เพิ่มบ้านใหม่เรียบร้อยแล้ว', { id: 'member-added' });
          this.loadMembers(); // 🌟 โหลดรายชื่อใหม่ให้ตารางอัปเดตทันที
        }
      },
      error: (err: any) => {
        console.error('Add member error:', err);
        toast.error(extractErrorMessage(err, 'เพิ่มข้อมูลไม่สำเร็จ กรุณาตรวจสอบข้อมูลอีกครั้ง'), { id: 'member-add-error' });
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
    this.editingMember = { id: null, house_no: '', fname: '', lname: '', phone: '', villages_id: null };
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
        console.error('Update member error:', err);
        toast.error(extractErrorMessage(err, 'แก้ไขข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), { id: 'member-update-error' });
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
        console.error('Delete member error:', err);
        toast.error(extractErrorMessage(err, 'ลบข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), { id: 'member-delete-error' });
      }
    });
  }
}
