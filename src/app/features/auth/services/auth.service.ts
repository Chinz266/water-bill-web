import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

// หน้าตาของ admin ที่หลังบ้านคืนกลับมา (ตัด password ทิ้งก่อนเก็บเสมอ)
export interface Admin {
  id: number;
  fname: string;
  lname: string;
  email: string;
  role: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  fname: string;
  lname: string;
  email: string;
  password: string;
}

const STORAGE_KEY = 'water-bill.admin';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private baseUrl = 'http://localhost:3000/auth';

  private http = inject(HttpClient);
  // ตอน SSR/prerender ไม่มี localStorage ต้องเช็คก่อนทุกครั้ง
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private currentAdmin = signal<Admin | null>(this.readStoredAdmin());

  readonly admin = this.currentAdmin.asReadonly();
  readonly isLoggedIn = computed(() => this.currentAdmin() !== null);
  readonly displayName = computed(() => {
    const admin = this.currentAdmin();
    return admin ? `${admin.fname} ${admin.lname}`.trim() : '';
  });

  // POST /auth/login — หลังบ้านยังไม่คืน JWT คืนมาแค่ข้อมูล admin
  login(payload: LoginPayload): Observable<Admin> {
    return this.http
      .post<Admin & { password?: string }>(`${this.baseUrl}/login`, payload)
      .pipe(tap((admin) => this.storeAdmin(admin)));
  }

  // POST /auth/register — สมัครเสร็จหลังบ้านคืน admin กลับมา เลยล็อกอินให้เลย
  register(payload: RegisterPayload): Observable<Admin> {
    return this.http
      .post<Admin & { password?: string }>(`${this.baseUrl}/register`, payload)
      .pipe(tap((admin) => this.storeAdmin(admin)));
  }

  logout(): void {
    this.currentAdmin.set(null);
    if (this.isBrowser) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  private storeAdmin(raw: Admin & { password?: string }): void {
    // หลังบ้านส่ง password ติดกลับมาด้วย ห้ามเก็บลง localStorage เด็ดขาด
    const { password, ...admin } = raw;
    this.currentAdmin.set(admin);
    if (this.isBrowser) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(admin));
    }
  }

  private readStoredAdmin(): Admin | null {
    if (!this.isBrowser) return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Admin) : null;
    } catch {
      return null;
    }
  }
}
