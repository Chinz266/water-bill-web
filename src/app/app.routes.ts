import { Routes } from '@angular/router';
import { MeterCropperComponent } from './features/meter-reading/components/meter-cropper/meter-cropper';
import { BillingHistoryComponent } from './features/meter-reading/components/billing-history/billing-history';
import { HomeComponent } from './features/home/home';
import { authGuard, guestGuard } from './features/auth/guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },

  // 🌟 หน้าที่เข้าได้ตอนยังไม่ได้ล็อกอิน (ถ้าล็อกอินอยู่แล้วจะเด้งไป /home)
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
];
