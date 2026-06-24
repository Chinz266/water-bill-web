import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImageCropperComponent } from 'ngx-image-cropper';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
<<<<<<< HEAD
// ปรับแก้ Path ให้ชี้ไปที่ไฟล์ meter-reading.ts ให้ถูกต้อง
import { MeterReadingService } from '../../services/meter-reading.service'; 
import { toast } from 'ngx-sonner'; 
=======
import { MeterReadingService } from '../../services/meter-reading.service';
>>>>>>> master

@Component({
  selector: 'app-meter-cropper',
  standalone: true,
  imports: [CommonModule, ImageCropperComponent],
  templateUrl: './meter-cropper.html',
  styleUrls: ['./meter-cropper.css']
})
export class MeterCropperComponent {
  // ==========================================
  // โซนประกาศตัวแปร
  // ==========================================
  imageChangedEvent: Event | null = null;
  croppedImage: SafeUrl = '';
  croppedBlob: Blob | null | undefined = null;
<<<<<<< HEAD
  
  maintainAspectRatio = false; // ปรับให้มีความยืดหยุ่น (Freeform) เป็นค่าเริ่มต้นตามคำขอผู้ใช้
  aspectRatio = 3 / 1;
  
  transform: any = {
    rotate: 0,
    flipH: false,
    flipV: false,
    scale: 1
  };
  
=======

>>>>>>> master
  aiResult: any = null;
  isLoading = false;
  isSaving = false;
  saveSuccess = false;

  constructor(
    private sanitizer: DomSanitizer,
    private meterReadingService: MeterReadingService
  ) {}

  // ==========================================
  // โซนฟังก์ชันจัดการรูปภาพ (เลือกรูป & ครอปรูป)
  // ==========================================
  fileChangeEvent(event: Event): void {
    this.imageChangedEvent = event;
<<<<<<< HEAD
    this.aiResult = null; 
    this.resetImage();
=======
    // รีเซ็ตค่าผลลัพธ์เก่าทิ้งเวลาเลือกรูปใหม่
    this.aiResult = null;
    this.saveSuccess = false;
>>>>>>> master
  }

  imageCropped(event: any) {
    this.croppedImage = this.sanitizer.bypassSecurityTrustUrl(event.objectUrl);
    this.croppedBlob = event.blob;
  }

<<<<<<< HEAD
  toggleAspectRatio(): void {
    this.maintainAspectRatio = !this.maintainAspectRatio;
  }

  rotateLeft(): void {
    this.transform = {
      ...this.transform,
      rotate: (this.transform.rotate || 0) - 90
    };
  }

  rotateRight(): void {
    this.transform = {
      ...this.transform,
      rotate: (this.transform.rotate || 0) + 90
    };
  }

  flipHorizontal(): void {
    this.transform = {
      ...this.transform,
      flipH: !this.transform.flipH
    };
  }

  flipVertical(): void {
    this.transform = {
      ...this.transform,
      flipV: !this.transform.flipV
    };
  }

  zoomIn(): void {
    this.transform = {
      ...this.transform,
      scale: (this.transform.scale || 1) + 0.1
    };
  }

  zoomOut(): void {
    this.transform = {
      ...this.transform,
      scale: Math.max(0.1, (this.transform.scale || 1) - 0.1)
    };
  }

  resetImage(): void {
    this.transform = {
      rotate: 0,
      flipH: false,
      flipV: false,
      scale: 1
    };
  }

=======
  // ==========================================
  // โซนฟังก์ชันคุยกับหลังบ้าน (NestJS)
  // ==========================================
  
  // 1. ส่งรูปไปสแกนเลข
>>>>>>> master
  uploadToBackend() {
    if (!this.croppedBlob) return;

    this.isLoading = true;
    this.aiResult = null;
    this.saveSuccess = false;

<<<<<<< HEAD
    const toastId = toast.loading('กำลังวิเคราะห์รูปภาพด้วย AI...');

    this.meterService.uploadCroppedImage(this.croppedBlob).subscribe({
      next: (response) => {
        this.isLoading = false;
        this.aiResult = response;
        if (response && response.success) {
          toast.success(`วิเคราะห์สำเร็จ! เลขมิเตอร์คือ ${response.read_unit}`, { id: toastId });
        } else {
          toast.error(`วิเคราะห์ไม่สำเร็จ: ${response.message || 'ได้ตัวเลขไม่ครบถ้วน'}`, { id: toastId });
        }
=======
    const formData = new FormData();
    // ตั้งชื่อไฟล์จำลองให้ NestJS รับไปใช้งาน
    formData.append('file', this.croppedBlob, 'meter-cropped.jpg');

    this.meterReadingService.uploadCroppedImage(formData).subscribe({
      next: (res) => {
        this.isLoading = false;
        this.aiResult = res; // เก็บผลลัพธ์ที่ได้จาก AI มาแสดงหน้าจอ
>>>>>>> master
      },
      error: (err) => {
        this.isLoading = false;
        console.error('Error:', err);
        toast.error('เชื่อมต่อ API ไม่สำเร็จ เช็คให้ชัวร์ว่า NestJS รันอยู่ไหมครับ', { id: toastId });
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
      },
      error: (err) => {
        this.isSaving = false;
        console.error('Save error:', err);
        alert('❌ บันทึกไม่สำเร็จ รบกวนเช็ค Terminal ฝั่ง NestJS หน่อยครับ');
      }
    });
  }
}