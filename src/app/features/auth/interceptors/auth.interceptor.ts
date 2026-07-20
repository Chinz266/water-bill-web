import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID, inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { toast } from 'ngx-sonner';
import { AuthService } from '../services/auth.service';
import { API_BASE_URL } from '../../../core/api.config';

/**
 * แนบ token ไปกับทุก request ที่ยิงไปหลังบ้าน
 *
 * ตั้งแต่หลังบ้านเปิด JwtAuthGuard แบบ global ทุก endpoint ต้องมี token
 * ยกเว้น /auth/login กับ /auth/register ที่เป็น @Public()
 *
 * ถ้าเจอ 401 = token หมดอายุหรือไม่ถูกต้อง → ล้างเซสชันแล้วเด้งกลับหน้า login
 * ไม่งั้นผู้ใช้จะค้างอยู่หน้าเดิมแล้วกดอะไรก็ไม่ขึ้น โดยไม่รู้ว่าต้องล็อกอินใหม่
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  // ตอน SSR/prerender ไม่มีหน้าจอและไม่มี token — ห้ามเด้งหน้าหรือขึ้น toast ไม่งั้น build พัง (NG0950)
  const isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  const token = authService.getToken();

  // ไม่ต้องแนบ token ให้ request ที่ไม่ได้ยิงหาหลังบ้านของเรา (เช่นโหลดไฟล์ static)
  const isApiCall = req.url.startsWith(API_BASE_URL);

  const request = token && isApiCall
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(request).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && isApiCall && isBrowser) {
        authService.logout();
        // บอกผู้ใช้ด้วยว่าทำไมถูกพากลับมาหน้าล็อกอิน ไม่งั้นจะงงว่าหลุดเองเฉย ๆ
        toast.error('เซสชันหมดอายุแล้ว กรุณาเข้าสู่ระบบอีกครั้งนะครับ', { id: 'session-expired' });
        // ใช้ชื่อ param ว่า redirectTo ให้ตรงกับที่ login.ts อ่านอยู่แล้ว
        void router.navigate(['/login'], {
          queryParams: { redirectTo: router.url },
        });
      }
      return throwError(() => error);
    }),
  );
};
