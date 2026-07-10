import { PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

// กันหน้าที่ต้องล็อกอินก่อนถึงจะเข้าได้
export const authGuard: CanActivateFn = (_route, state) => {
  // ตอน prerender ยังไม่รู้ว่าใครล็อกอินอยู่ ปล่อยผ่านไปก่อน แล้วให้ฝั่ง browser เช็คซ้ำ
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;

  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isLoggedIn()) return true;

  // จำหน้าที่ผู้ใช้ตั้งใจจะเข้าไว้ พอล็อกอินเสร็จจะพากลับมาที่เดิม
  return router.createUrlTree(['/login'], { queryParams: { redirectTo: state.url } });
};

// กันไม่ให้คนที่ล็อกอินอยู่แล้ววนกลับมาหน้า login/register
export const guestGuard: CanActivateFn = () => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;

  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.isLoggedIn() ? router.createUrlTree(['/home']) : true;
};
