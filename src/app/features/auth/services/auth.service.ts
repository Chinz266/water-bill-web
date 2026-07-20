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

// หลังบ้านคืน { access_token, user } ทั้งตอน login และ register
export interface AuthResult {
  access_token: string;
  user: Admin;
}

const STORAGE_KEY = 'water-bill.admin';
const TOKEN_KEY = 'water-bill.token';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private baseUrl = 'http://localhost:3000/auth';

  private http = inject(HttpClient);
  // ตอน SSR/prerender ไม่มี localStorage ต้องเช็คก่อนทุกครั้ง
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private currentAdmin = signal<Admin | null>(this.readStoredAdmin());
  private currentToken = signal<string | null>(this.readStoredToken());

  readonly admin = this.currentAdmin.asReadonly();
  // ต้องมีทั้งข้อมูลผู้ใช้ "และ" token ถึงจะถือว่าล็อกอินอยู่จริง
  // ถ้าเช็คแค่ข้อมูลผู้ใช้ เซสชันเก่าที่ไม่มี token จะทำให้เข้าหน้าได้แต่กดอะไรก็ 401
  readonly isLoggedIn = computed(() => this.currentAdmin() !== null && this.currentToken() !== null);
  readonly displayName = computed(() => {
    const admin = this.currentAdmin();
    return admin ? `${admin.fname} ${admin.lname}`.trim() : '';
  });

  // POST /auth/login — คืน { access_token, user }
  login(payload: LoginPayload): Observable<AuthResult> {
    return this.http
      .post<AuthResult>(`${this.baseUrl}/login`, payload)
      .pipe(tap((result) => this.storeSession(result)));
  }

  // POST /auth/register — สมัครเสร็จได้ token มาเลย ไม่ต้องล็อกอินซ้ำ
  register(payload: RegisterPayload): Observable<AuthResult> {
    return this.http
      .post<AuthResult>(`${this.baseUrl}/register`, payload)
      .pipe(tap((result) => this.storeSession(result)));
  }

  logout(): void {
    this.currentAdmin.set(null);
    this.currentToken.set(null);
    if (this.isBrowser) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(TOKEN_KEY);
    }
  }

  /** token ที่ interceptor เอาไปแนบกับทุก request */
  getToken(): string | null {
    return this.currentToken();
  }

  private storeSession(result: AuthResult): void {
    // หลังบ้านตัด password ออกให้แล้ว แต่กันไว้อีกชั้นเผื่อ API เปลี่ยน
    const { password, ...admin } = result.user as Admin & { password?: string };
    this.currentAdmin.set(admin);
    this.currentToken.set(result.access_token);
    if (this.isBrowser) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(admin));
      localStorage.setItem(TOKEN_KEY, result.access_token);
    }
  }

  private readStoredToken(): string | null {
    if (!this.isBrowser) return null;
    return localStorage.getItem(TOKEN_KEY);
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
