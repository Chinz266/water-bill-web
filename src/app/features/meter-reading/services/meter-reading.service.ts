import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class MeterReadingService {
  // ชี้ไปที่ API ของ NestJS ที่เรารอรับรูปภาพ
  private apiUrl = 'http://localhost:3000/meter-readings/ocr-upload'; 

  constructor(private http: HttpClient) {}

  uploadCroppedImage(imageBlob: Blob): Observable<any> {
    const formData = new FormData();
    formData.append('file', imageBlob, 'cropped-meter.jpg'); 
    return this.http.post<any>(this.apiUrl, formData);
  }
}