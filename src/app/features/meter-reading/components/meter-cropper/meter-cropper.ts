import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImageCropperComponent } from 'ngx-image-cropper';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { MeterReadingService } from '../../services/meter-reading.service';
import { toast } from 'ngx-sonner';

@Component({
  selector: 'app-meter-cropper',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './meter-cropper.html',
  styleUrls: ['./meter-cropper.css']
})
export class MeterCropperComponent {
rotateLeft() {
throw new Error('Method not implemented.');
}
rotateRight() {
throw new Error('Method not implemented.');
}
flipHorizontal() {
throw new Error('Method not implemented.');
}
flipVertical() {
throw new Error('Method not implemented.');
}
zoomIn() {
throw new Error('Method not implemented.');
}
zoomOut() {
throw new Error('Method not implemented.');
}
resetImage() {
throw new Error('Method not implemented.');
}
  // ==========================================
  // โซนประกาศตัวแปร
  // ==========================================
  imageChangedEvent: Event | null = null;
  croppedImage: SafeUrl = '';
  croppedBlob: Blob | null | undefined = null;
  aiResult: any = null;
  isLoading = false;
  isSaving = false;
  saveSuccess = false;
maintainAspectRatio: any;
aspectRatio: number|undefined;
transform: any;

  constructor(
    private sanitizer: DomSanitizer,
    private meterReadingService: MeterReadingService
  ) {}

  // ==========================================
  // โซนฟังก์ชันจัดการรูปภาพ (เลือกรูป & ครอปรูป)
  // ==========================================
  fileChangeEvent(event: Event): void {
    this.imageChangedEvent = event;
    // รีเซ็ตค่าผลลัพธ์เก่าทิ้งเวลาเลือกรูปใหม่
    this.aiResult = null;
    this.saveSuccess = false;
  }

  imageCropped(event: any) {
    this.croppedImage = this.sanitizer.bypassSecurityTrustUrl(event.objectUrl);
    this.croppedBlob = event.blob;
  }

  // ==========================================
  // โซนฟังก์ชันคุยกับหลังบ้าน (NestJS)
  // ==========================================
  
  // 1. ส่งรูปไปสแกนเลข
  uploadToBackend() {
    if (!this.croppedBlob) return;

    this.isLoading = true;
    this.aiResult = null;
    this.saveSuccess = false;

    const formData = new FormData();
    // ตั้งชื่อไฟล์จำลองให้ NestJS รับไปใช้งาน
    formData.append('file', this.croppedBlob, 'meter-cropped.jpg');

    this.meterReadingService.uploadCroppedImage(formData).subscribe({
      next: (res) => {
        this.isLoading = false;
        this.aiResult = res; // เก็บผลลัพธ์ที่ได้จาก AI มาแสดงหน้าจอ
      },
      error: (err) => {
        this.isLoading = false;
        console.error('Error:', err);
        toast.error('เชื่อมต่อ API ไม่สำเร็จ เช็คให้ชัวร์ว่า NestJS รันอยู่ไหมครับ', { id: 'api-error' });
      }
    });
  }

  // 2. กดยืนยันบันทึกตัวเลขลงฐานข้อมูล
  confirmAndSave() {
    if (!this.aiResult || !this.aiResult.read_unit) return;
    
    this.isSaving = true;
    this.saveSuccess = false;

    this.meterReadingService.saveBill(this.aiResult.read_unit).subscribe({
      next: (response) => {
        this.isSaving = false;
        this.saveSuccess = true;
        toast.success('✅ บันทึกสำเร็จ!', { id: 'save-success' });
      },
      error: (err) => {
        this.isSaving = false;
        console.error('Save error:', err);
        toast.error('❌ บันทึกไม่สำเร็จ รบกวนเช็ค Terminal ฝั่ง NestJS หน่อยครับ', { id: 'save-error' });
      }
    });
  }
}