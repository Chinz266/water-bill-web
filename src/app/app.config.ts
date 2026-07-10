import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes),
    // 🌟 withFetch() = ให้ HttpClient ใช้ fetch แทน XHR
    // จำเป็นตอนทำ SSR เพราะ XHR ฝั่ง server ถูกประกาศเลิกใช้แล้ว (NG02801)
    provideHttpClient(withFetch())
  ]
};
