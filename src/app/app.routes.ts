import { Routes } from '@angular/router';
import { MeterCropperComponent } from './features/meter-reading/components/meter-cropper/meter-cropper';
import { BillingHistoryComponent } from './features/meter-reading/components/billing-history/billing-history';
import { HomeComponent } from './features/home/home';
import { authGuard, guestGuard, memberGuard } from './features/auth/guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },

  // 🌟 หน้าที่เข้าได้ตอนยังไม่ได้ล็อกอิน (ถ้าล็อกอินอยู่แล้วจะเด้งไปหน้าแรกตาม role)
  {
    path: 'welcome',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/components/welcome/welcome').then(m => m.WelcomeComponent),
  },
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/components/login/login').then(m => m.LoginComponent),
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/components/register/register').then(m => m.RegisterComponent),
  },

  // 🌟 หน้าที่ต้องล็อกอินก่อนถึงจะเข้าได้
  { path: 'home', component: HomeComponent, canActivate: [authGuard] },
  { path: 'scan', component: MeterCropperComponent, canActivate: [authGuard] },
  { path: 'history', component: BillingHistoryComponent, canActivate: [authGuard] },
  {
    path: 'members',
    canActivate: [authGuard],
    loadComponent: () => import('./features/member/components/member-list/member-list').then(m => m.MemberListComponent),
  },
  {
    path: 'village-settings',
    canActivate: [authGuard],
    loadComponent: () => import('./features/village/components/village-settings/village-settings').then(m => m.VillageSettingsComponent),
  },

  // 🏠 พอร์ทัลลูกบ้าน — URL แยกจากฝั่งเจ้าหน้าที่ ล็อกอินด้วยเบอร์โทร
  {
    path: 'member/login',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/member-portal/components/member-login/member-login').then(m => m.MemberLoginComponent),
  },
  {
    path: 'member/bills',
    canActivate: [memberGuard],
    loadComponent: () => import('./features/member-portal/components/my-bills/my-bills').then(m => m.MyBillsComponent),
  },
];
