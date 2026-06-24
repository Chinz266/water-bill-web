import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImageCroppedEvent, ImageCropperComponent } from 'ngx-image-cropper';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
// ปรับแก้ Path ให้ชี้ไปที่ไฟล์ meter-reading.ts ให้ถูกต้อง
import { MeterReadingService } from '../../services/meter-reading.service'; 
import { toast } from 'ngx-sonner'; 

@Component({
  selector: 'app-meter-cropper',
  standalone: true,
  imports: [CommonModule, ImageCropperComponent],
  // ปรับชื่อไฟล์ให้ตรงกับแถบด้านซ้ายมือ
  templateUrl: './meter-cropper.html',
  styleUrls: ['./meter-cropper.css']
})
export class MeterCropperComponent {
  imageChangedEvent: Event | null = null;
  croppedImage: SafeUrl = '';
  croppedBlob: Blob | null | undefined = null;
  
  maintainAspectRatio = false; // ปรับให้มีความยืดหยุ่น (Freeform) เป็นค่าเริ่มต้นตามคำขอผู้ใช้
  aspectRatio = 3 / 1;
  
  transform: any = {
    rotate: 0,
    flipH: false,
    flipV: false,
    scale: 1
  };
  
  aiResult: any = null;
  isLoading = false;

  constructor(
    private sanitizer: DomSanitizer,
    private meterService: MeterReadingService 
  ) {}

  fileChangeEvent(event: Event): void {
    this.imageChangedEvent = event;
    this.aiResult = null; 
    this.resetImage();
  }

  imageCropped(event: ImageCroppedEvent) {
    if (event.objectUrl) {
      this.croppedImage = this.sanitizer.bypassSecurityTrustUrl(event.objectUrl);
    }
    this.croppedBlob = event.blob; 
  }

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

  uploadToBackend() {
    if (!this.croppedBlob) return;
    this.isLoading = true;
    this.aiResult = null;

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
      },
      error: (err) => {
        this.isLoading = false;
        console.error('Error:', err);
        toast.error('เชื่อมต่อ API ไม่สำเร็จ เช็คให้ชัวร์ว่า NestJS รันอยู่ไหมครับ', { id: toastId });
      }
    });
  }
}