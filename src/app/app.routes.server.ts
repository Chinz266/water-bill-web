import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    /**
     * หน้าที่มีพารามิเตอร์ใน URL prerender ไม่ได้ — ตอน build ยังไม่รู้ว่ามีบ้านรหัสอะไรบ้าง
     * (ต้องต่อฐานข้อมูลถึงจะรู้ ซึ่งตอน build ไม่มี)
     *
     * ใช้ Client render แทน: เสิร์ฟโครงหน้าเปล่าไปก่อนแล้วให้ฝั่งเบราว์เซอร์โหลดข้อมูลเอง
     * ซึ่งเป็นสิ่งที่หน้านี้ทำอยู่แล้ว (ngOnInit ข้ามการยิง API ตอน SSR เพราะยังไม่มี token)
     */
    path: 'members/:membersId/manage',
    renderMode: RenderMode.Client
  },
  {
    path: '**',
    renderMode: RenderMode.Prerender
  }
];
