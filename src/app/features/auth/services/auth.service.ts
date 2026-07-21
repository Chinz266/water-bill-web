import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { API_BASE_URL } from '../../../core/api.config';

/** ระบบมีผู้ใช้ 2 แบบ — เจ้าหน้าที่หมู่บ้าน (ล็อกอินด้วยอีเมล) กับลูกบ้าน (ล็อกอินด้วยเบอร์โทร) */
export type UserRole = 'admin' | 'member';

// หน้าตาของบัญชีที่หลังบ้านคืนกลับมา (ตัด password ทิ้งก่อนเก็บเสมอ)
// บัญชีลูกบ้านไม่มีอีเมล/ชื่อ-สกุล มีแค่เบอร์โทร ฟิลด์พวกนี้เลยเป็น optional
export interface AppUser {
  id: number;
  fname?: string | null;
  lname?: string | null;
  email?: string | null;
  phone?: string | null;
  role: UserRole;
}

/** ชื่อเดิมที่โค้ดส่วนอื่นเรียกใช้อยู่ — เก็บไว้เพื่อไม่ให้ต้องแก้ทั้งโปรเจกต์ */
export type Admin = AppUser;

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

/** ลูกบ้านเข้าระบบด้วยเบอร์โทรอย่างเดียว (ไม่มีรหัสผ่าน) */
export interface MemberAuthPayload {
  phone: string;
}

// หลังบ้านคืน { access_token, user } ทั้งตอน login และ register
export interface AuthResult {
  access_token: string;
  user: AppUser;
}

const STORAGE_KEY = 'water-bill.admin';
const TOKEN_KEY = 'water-bill.token';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private baseUrl = `${API_BASE_URL}/auth`;

  private http = inject(HttpClient);
  // ตอน SSR/prerender ไม่มี localStorage ต้องเช็คก่อนทุกครั้ง
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private currentAdmin = signal<AppUser | null>(this.readStoredAdmin());
  private currentToken = signal<string | null>(this.readStoredToken());

  readonly admin = this.currentAdmin.asReadonly();
  /** ชื่อที่สื่อความหมายกว่าเมื่อผู้ใช้อาจเป็นลูกบ้าน — ชี้ข้อมูลก้อนเดียวกับ admin */
  readonly user = this.currentAdmin.asReadonly();

  // ต้องมีทั้งข้อมูลผู้ใช้ "และ" token ถึงจะถือว่าล็อกอินอยู่จริง
  // ถ้าเช็คแค่ข้อมูลผู้ใช้ เซสชันเก่าที่ไม่มี token จะทำให้เข้าหน้าได้แต่กดอะไรก็ 401
  readonly isLoggedIn = computed(() => this.currentAdmin() !== null && this.currentToken() !== null);

  // บัญชีเก่าที่บันทึกไว้ก่อนระบบมี role ให้ถือเป็นเจ้าหน้าที่ (ตอนนั้นมีแต่เจ้าหน้าที่)
  readonly role = computed<UserRole>(() => this.currentAdmin()?.role ?? 'admin');
  readonly isAdmin = computed(() => this.isLoggedIn() && this.role() === 'admin');
  readonly isMember = computed(() => this.isLoggedIn() && this.role() === 'member');

  readonly displayName = computed(() => {
    const user = this.currentAdmin();
    if (!user) return '';
    // ลูกบ้านไม่มีชื่อ-สกุลในบัญชี ใช้เบอร์โทรแทนจะได้ไม่โชว์ช่องว่าง
    const fullName = `${user.fname ?? ''} ${user.lname ?? ''}`.trim();
    return fullName || user.phone || '';
  });

  /** หน้าแรกของแต่ละ role — ใช้ตอนล็อกอินเสร็จและตอน guard เด้งกลับ */
  readonly homeUrl = computed(() => (this.role() === 'member' ? '/member/bills' : '/home'));

  // ==========================================
  // เจ้าหน้าที่หมู่บ้าน (ล็อกอินด้วยอีเมล)
  // ==========================================

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

  // ==========================================
  // ลูกบ้าน (ล็อกอินด้วยเบอร์โทรที่แจ้งไว้กับหมู่บ้าน)
  // ==========================================

  // POST /auth/member/login
  loginMember(payload: MemberAuthPayload): Observable<AuthResult> {
    return this.http
      .post<AuthResult>(`${this.baseUrl}/member/login`, payload)
      .pipe(tap((result) => this.storeSession(result)));
  }

  // POST /auth/member/register — หลังบ้านจะยอมให้สมัครเฉพาะเบอร์ที่มีบ้านลงทะเบียนไว้แล้ว
  registerMember(payload: MemberAuthPayload): Observable<AuthResult> {
    return this.http
      .post<AuthResult>(`${this.baseUrl}/member/register`, payload)
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
    const { password, ...user } = result.user as AppUser & { password?: string };
    this.currentAdmin.set(user);
    this.currentToken.set(result.access_token);
    if (this.isBrowser) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
      localStorage.setItem(TOKEN_KEY, result.access_token);
    }
  }

  private readStoredToken(): string | null {
    if (!this.isBrowser) return null;
    return localStorage.getItem(TOKEN_KEY);
  }

  private readStoredAdmin(): AppUser | null {
    if (!this.isBrowser) return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as AppUser) : null;
    } catch {
      return null;
    }
  }
}
