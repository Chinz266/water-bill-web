import { Routes } from '@angular/router';
import { MeterCropperComponent } from './features/meter-reading/components/meter-cropper/meter-cropper';
import { BillingHistoryComponent } from './features/meter-reading/components/billing-history/billing-history';
import { HomeComponent } from './features/home/home';

export const routes: Routes = [
  { path: '', redirectTo: 'scan', pathMatch: 'full' },
  { path: 'scan', component: MeterCropperComponent },
  { path: 'history', component: BillingHistoryComponent },
  { path: 'home', component: HomeComponent },
  { path: 'members', loadComponent: () => import('./features/member/components/member-list/member-list').then(m => m.MemberListComponent) },
];