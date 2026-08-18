import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { authInterceptor } from './features/auth/interceptors/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes),
    // 🌟 withFetch() = ให้ HttpClient ใช้ fetch แทน XHR (เดิมจำเป็นตอนทำ SSR)
    // 🔐 withInterceptors([authInterceptor]) = แนบ JWT ให้ทุก request อัตโนมัติ
    //    ถ้าไม่มีตัวนี้ ทุกหน้าจะได้ 401 เพราะหลังบ้านเปิด guard แบบ global แล้ว
    provideHttpClient(withFetch(), withInterceptors([authInterceptor]))
  ]
};
