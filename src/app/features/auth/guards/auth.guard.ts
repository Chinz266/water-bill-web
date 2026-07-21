import { PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

// กันหน้าฝั่งเจ้าหน้าที่ — ต้องล็อกอินและต้องเป็น role admin เท่านั้น
// (ลูกบ้านที่เผลอพิมพ์ URL ฝั่งเจ้าหน้าที่จะถูกพากลับหน้าบิลของตัวเอง)
export const authGuard: CanActivateFn = (_route, state) => {
  // ตอน prerender ยังไม่รู้ว่าใครล็อกอินอยู่ ปล่อยผ่านไปก่อน แล้วให้ฝั่ง browser เช็คซ้ำ
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;

  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAdmin()) return true;
  if (auth.isMember()) return router.createUrlTree(['/member/bills']);

  // ยังไม่ได้ล็อกอิน → พาไปหน้าทางเข้าให้เลือกก่อนว่าเป็นลูกบ้านหรือเจ้าหน้าที่
  // (redirectTo ถูกส่งต่อผ่านปุ่มบนหน้า welcome ไปถึงหน้า login พอสำเร็จจะพากลับมาที่เดิม)
  return router.createUrlTree(['/welcome'], { queryParams: { redirectTo: state.url } });
};

// กันหน้าฝั่งลูกบ้าน — ต้องล็อกอินด้วยบัญชีลูกบ้าน (role member)
// เจ้าหน้าที่ที่หลงเข้ามาจะถูกพากลับหน้าแรกฝั่งตัวเอง
export const memberGuard: CanActivateFn = (_route, state) => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;

  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isMember()) return true;
  if (auth.isAdmin()) return router.createUrlTree(['/home']);

  return router.createUrlTree(['/member/login'], { queryParams: { redirectTo: state.url } });
};

// กันไม่ให้คนที่ล็อกอินอยู่แล้ววนกลับมาหน้า login/register (ของทั้งสองฝั่ง)
// พาไปหน้าแรกตาม role ของบัญชีที่ล็อกอินค้างไว้
export const guestGuard: CanActivateFn = () => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;

  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.isLoggedIn() ? router.createUrlTree([auth.homeUrl()]) : true;
};
