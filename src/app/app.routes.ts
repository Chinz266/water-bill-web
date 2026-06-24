import { Routes } from '@angular/router';
import { MeterCropperComponent } from './features/meter-reading/components/meter-cropper/meter-cropper';
import { BillingHistoryComponent } from './features/meter-reading/components/billing-history/billing-history';

export const routes: Routes = [
  { path: '', redirectTo: 'scan', pathMatch: 'full' },
  { path: 'scan', component: MeterCropperComponent },
  { path: 'history', component: BillingHistoryComponent } // 🌟 เปิดเส้นทางนี้ให้ใช้งานได้ครับ
];