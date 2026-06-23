import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImageCroppedEvent, ImageCropperComponent } from 'ngx-image-cropper';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
// ปรับแก้ Path ให้ชี้ไปที่ไฟล์ meter-reading.ts ให้ถูกต้อง
import { MeterReadingService } from '../../services/meter-reading.service'; 

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
  
  aiResult: any = null;
  isLoading = false;

  constructor(
    private sanitizer: DomSanitizer,
    private meterService: MeterReadingService 
  ) {}

  fileChangeEvent(event: Event): void {
    this.imageChangedEvent = event;
    this.aiResult = null; 
  }

  imageCropped(event: ImageCroppedEvent) {
    if (event.objectUrl) {
      this.croppedImage = this.sanitizer.bypassSecurityTrustUrl(event.objectUrl);
    }
    this.croppedBlob = event.blob; 
  }

  uploadToBackend() {
    if (!this.croppedBlob) return;
    this.isLoading = true;
    this.aiResult = null;

    this.meterService.uploadCroppedImage(this.croppedBlob).subscribe({
      next: (response) => {
        this.isLoading = false;
        this.aiResult = response;
      },
      error: (err) => {
        this.isLoading = false;
        console.error('Error:', err);
        alert('เชื่อมต่อ API ไม่สำเร็จ เช็คให้ชัวร์ว่า NestJS รันอยู่ไหมครับ');
      }
    });
  }
}