# WaterBillWeb — หน้าเว็บระบบจัดการค่าน้ำประปาหมู่บ้าน

หน้าเว็บ Angular ของระบบ **WaterService** — เจ้าหน้าที่ถ่ายรูปหน้าปัดมิเตอร์ ให้ AI อ่านเลขให้
แล้วระบบคิดค่าน้ำและออกบิลต่อ ส่วนลูกบ้านล็อกอินด้วยเบอร์โทรเพื่อดูบิลของตัวเองและแจ้งเรื่องได้

โปรเจกต์นี้เป็น **frontend อย่างเดียว** หลังบ้าน NestJS กับ AI service ของ Python อยู่คนละ repo
ต้องเปิดครบทั้งสามตัวถึงจะใช้งานได้จริง

---

## ภาพรวมระบบ

```
┌──────────────────┐
│  WaterBillWeb    │  ← โปรเจกต์นี้ (Angular 21 + SSR)
│  :4200           │
└────────┬─────────┘
         │ HTTP + JSON (แนบ JWT ทุก request)
         ▼
┌──────────────────┐    ส่งรูป (multipart)   ┌──────────────────────┐
│  NestJS Backend  │ ─────────────────────► │  Python AI Service   │
│  :3000           │ ◄───────────────────── │  :8000  (best.pt)    │
└────────┬─────────┘    คืนเลขที่อ่านได้      └──────────────────────┘
         │ TypeORM
         ▼
┌──────────────────┐
│  MySQL           │
│  water-bill-db   │
└──────────────────┘
```

หน้าเว็บคุยกับ **NestJS ตัวเดียว** ไม่ได้ยิงไปหา Python โดยตรง

---

## เทคโนโลยีที่ใช้

| เครื่องมือ | เวอร์ชัน | ใช้ทำอะไร |
|---|---|---|
| Angular | 21.2 | โครงหลัก (standalone components ทั้งหมด) |
| Angular SSR | 21.2 | render ฝั่ง server + prerender ทุก route ตอน build |
| TypeScript | 5.9 | ภาษาหลัก |
| ngx-image-cropper | 9.1 | ครอบตัดรูปมิเตอร์ก่อนส่งให้ AI |
| ngx-sonner | 3.1 | แจ้งเตือน (toast) |
| Vitest | 4.0 | เทส ผ่าน builder `@angular/build:unit-test` |

---

## วิธีรัน

ต้องเปิด **MySQL ใน XAMPP** ก่อน แล้วเปิด 3 terminal ตามลำดับนี้
(พาธข้างล่างเป็นของเครื่องเจ้าของโปรเจกต์ ปรับตามเครื่องที่ใช้)

**1. Python AI service** (ต้องรันก่อนเสมอ)

```bash
cd C:\Users\ajatu\Documents\WaterService\meter-vision-service
.\venv\Scripts\Activate.ps1
uvicorn main:app --port 8000
```

**2. NestJS backend**

```bash
cd C:\Users\ajatu\Documents\WaterService\water-bill-service-master
npm run start:dev
```

ดู API ทั้งหมดได้ที่ http://localhost:3000/api (Swagger)

**3. หน้าเว็บ** (โฟลเดอร์นี้)

```bash
npm install
npm start
```

เปิด http://localhost:4200

> ถ้ารัน NestJS โดยไม่เปิด Python ก่อน หน้าสแกนมิเตอร์จะขึ้นว่า "ระบบอ่านมิเตอร์ยังไม่พร้อมใช้งาน"

### ทดสอบจากมือถือในวงแลนเดียวกัน

`npm start` เปิด dev server ที่ host `0.0.0.0` อยู่แล้ว เปิดจากมือถือด้วย `http://<IP เครื่อง>:4200` ได้เลย
`API_BASE_URL` จะคิดตาม hostname ที่เปิดเว็บอยู่ให้เอง (ดูหัวข้อ [API_BASE_URL](#api_base_url-คิดจาก-hostname-ปัจจุบัน))

> ⚠️ `angular.json` ระบุ `allowedHosts` ไว้เป็น `192.168.1.174` กับ `localhost` ถ้า IP เครื่องเปลี่ยน
> ต้องเพิ่ม IP ใหม่เข้าไป ไม่งั้น dev server จะปฏิเสธ request จากมือถือ

### คำสั่งอื่น

```bash
npx ng build --configuration development   # เช็คว่าคอมไพล์ผ่าน — ใช้ตัวนี้หลังแก้โค้ดเสมอ
npm run build                              # production (มี budget + prerender 14 route)
npm test                                   # รันเทสด้วย Vitest
```

---

## 3 กติกาที่พลาดบ่อยที่สุด

### 1. Zoneless change detection

`app.config.ts` เปิด `provideZonelessChangeDetection()` — การ set property ธรรมดาใน callback ของ
`subscribe()` **จะไม่ทำให้หน้าจออัปเดต** โปรเจกต์นี้ใช้สองแบบ:

- **service** ใช้ `signal()` / `computed()` (ต้นแบบดูที่ `auth.service.ts`)
- **component** ส่วนใหญ่ `inject(ChangeDetectorRef)` แล้วเรียก `this.cdr.detectChanges()`
  ปิดท้ายทุก callback ทั้ง `next` และ `error`

ทำตามแบบไฟล์ที่กำลังแก้อยู่ **อย่าผสมสองสไตล์ในไฟล์เดียว**

### 2. SSR / prerender — ห้ามแตะ browser API ตรง ๆ

`ng build` จะ prerender ทุก route ทำให้โค้ดถูกรันบน Node จริง ๆ ตอน build
**บั๊ก SSR จึงโผล่เป็น build error ไม่ใช่ runtime error** — `localStorage`, `window`, `document`
ไม่มีตอนนั้น ทุกที่ที่ใช้ต้องกันด้วย:

```ts
private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
ngOnInit(): void {
  if (!this.isBrowser) return;   // ยิง API ตอน prerender ได้แค่ 401 เปล่า ๆ
  this.loadData();
}
```

guard ทุกตัว **คืน `true` เสมอเมื่อรันบน server** แล้วให้ฝั่ง browser เช็คซ้ำ
เช่นเดียวกับ interceptor ที่ห้ามเด้ง route หรือขึ้น toast ตอน SSR (จะได้ NG0950)

### 3. Budget ของ CSS ต่อ component

`angular.json` ตั้ง `anyComponentStyle` ไว้ warning 4kB / **error 8kB**
`meter-cropper.css` กับ `my-bills.css` ชนเพดานแล้ว สไตล์ใหม่ของสอง component นี้จึงถูกย้ายไปไว้ที่
`src/styles.css` (มีคอมเมนต์กำกับไว้) ถ้าเพิ่ม CSS แล้ว production build error ให้ย้ายไป `styles.css`
อย่าลบของเดิมทิ้ง

---

## โครงสร้างโค้ด

```
src/app/
├── app.ts / app.html          โครงหลัก — ตัดสินใจว่าจะโชว์ navbar ไหม
├── app.config.ts              zoneless + router + HttpClient(withFetch, authInterceptor)
├── app.routes.ts              route ทั้งหมด + guard
├── core/api.config.ts         API_BASE_URL — จุดเดียวของทั้งแอป
├── layout/navbar/             แถบเมนูฝั่งเจ้าหน้าที่ + ปุ่มออกจากระบบ
└── features/
    ├── auth/                  welcome / login / register, guards, interceptor, auth.service
    ├── home/                  หน้าแรกเจ้าหน้าที่ — สรุปจำนวนบ้าน + ทางลัด
    ├── member/                ทะเบียนลูกบ้าน (เพิ่ม/แก้/ลบ/ลงทะเบียนหน้ามิเตอร์)
    ├── village/               ตั้งค่าหมู่บ้าน + เรทค่าน้ำ
    ├── account/               ตั้งค่าโปรไฟล์เจ้าหน้าที่
    ├── meter-reading/         หัวใจของระบบ (ดูตารางข้างล่าง)
    ├── report/                ระบบแจ้งเรื่อง — my-reports (ลูกบ้าน) + report-list (เจ้าหน้าที่)
    └── member-portal/         ฝั่งลูกบ้าน — member-login, my-bills, portal-shared.css
```

ข้างใน `meter-reading/`:

| ไฟล์ | หน้าที่ |
|---|---|
| `components/meter-cropper/` | จดทีละหลัง — เลือกบ้าน → ครอบตัดรูป → AI อ่าน → ออกบิล |
| `components/batch-scan/` | จดหลายหลังรวดเดียว — อัปโหลดหลายรูป แล้วให้หลังบ้านจับคู่รูปกับบ้าน |
| `components/billing-history/` | ประวัติบิล + กรอง + เปลี่ยนสถานะจ่ายเงิน + สั่งพิมพ์ |
| `components/bill-print/` | เทมเพลตใบเสร็จ (A4 ทีละใบ / สลิปหลายใบต่อแผ่น) |
| `services/bill-print.service.ts` | ข้อความสถานะ/เดือน/วันครบกำหนด ใช้ร่วมกันทั้งหน้าเว็บและใบเสร็จ |
| `services/exif.ts` | อ่านวันถ่ายและพิกัดจาก EXIF ของไฟล์ต้นฉบับ (ครอปแล้ว EXIF หาย) |
| `services/geo.ts` | ระยะห่าง haversine + เลือกบ้านที่ใกล้ที่สุดแบบ "มั่นใจพอ" |
| `services/batch-queue.store.ts` | เก็บคิวสแกนไว้ใน localStorage เผื่อปิดแท็บกลางคัน |
| `services/meter-photo.ts` | เติม `API_BASE_URL` ให้ path รูปที่หลังบ้านคืนมา |

`report/` มี component ของทั้งสอง role อยู่ด้วยกัน เพราะใช้ `report.service.ts` และ
`report.constants.ts` (หมวดหมู่/สถานะ + คำไทย) ร่วมกัน

**ข้อตกลงการตั้งชื่อ:** ไฟล์ไม่มี suffix `.component` — `home.ts` / `home.html` / `home.css`
แต่ class ยังชื่อ `HomeComponent` ทุก component เป็น standalone และแยก template/style เป็นไฟล์
feature ใหม่ให้แตกโฟลเดอร์ของตัวเองที่มี `components/` + `services/`

---

## เส้นทางในเว็บ (routes)

**ฝั่งเจ้าหน้าที่** — ต้องล็อกอินด้วยอีเมล (`authGuard`)

| Path | หน้า |
|---|---|
| `/home` | หน้าแรก |
| `/scan` | สแกนมิเตอร์ทีละหลัง |
| `/scan-batch` | สแกนหลายรูปรวดเดียว (มี `canDeactivate` กันเดินออกกลางคิว) |
| `/history` | ประวัติบิล + พิมพ์ใบเสร็จ |
| `/members` | ทะเบียนลูกบ้าน |
| `/village-settings` | ตั้งค่าหมู่บ้าน + เรทค่าน้ำ |
| `/account` | ตั้งค่าโปรไฟล์ |
| `/reports` | เรื่องที่ลูกบ้านแจ้งเข้ามา |

**ฝั่งลูกบ้าน** — ล็อกอินด้วยเบอร์โทร (`memberGuard`) สลับสองหน้าด้วยแถบ `.portal-tabs`

| Path | หน้า |
|---|---|
| `/member/bills` | บิลของบ้านที่ตัวเองดูแล |
| `/member/reports` | เรื่องที่แจ้งไว้ + แจ้งเรื่องใหม่ |

**เข้าได้ตอนยังไม่ล็อกอิน** (`guestGuard`): `/welcome`, `/login`, `/register`, `/member/login`

เปิด `/` จะเด้งไป `/home` ถ้ายังไม่ล็อกอินจะถูกส่งไป `/login` โดยจำหน้าเดิมไว้ใน query param
`redirectTo` แล้วพากลับมาหลังล็อกอินเสร็จ

---

## Auth — ระบบมีผู้ใช้ 2 role

| role | ล็อกอินด้วย | หน้าแรก | guard |
|---|---|---|---|
| `admin` (เจ้าหน้าที่) | อีเมล + รหัสผ่าน | `/home` | `authGuard` |
| `member` (ลูกบ้าน) | เบอร์โทรอย่างเดียว | `/member/bills` | `memberGuard` |

- หลังบ้านคืน `{ access_token, user }` ทั้งตอน login และ register — `AuthService.storeSession()`
  เก็บลง localStorage สองคีย์ (`water-bill.admin`, `water-bill.token`) และ **ตัด `password` ทิ้งก่อนเก็บเสมอ**
- `isLoggedIn` ต้องมีทั้ง user **และ** token — เซสชันเก่าที่ไม่มี token ถือว่าไม่ได้ล็อกอิน
  (ไม่งั้นจะเข้าหน้าได้แต่กดอะไรก็ 401)
- หลังบ้านเปิด `JwtAuthGuard` แบบ global ทุก endpoint ต้องมี token ยกเว้น `/auth/*`
  `authInterceptor` แนบ `Bearer` ให้อัตโนมัติเฉพาะ request ที่ขึ้นต้นด้วย `API_BASE_URL`
  และเจอ 401 เมื่อไรจะ logout + เด้งไป `/login?redirectTo=...`
- guard ใช้ `router.createUrlTree()` ไม่ใช่ `router.navigate()` และเด้งคนที่ผิดฝั่งไปหน้าแรกของ role ตัวเอง
- ลูกบ้านสมัครได้เฉพาะเบอร์ที่มีบ้านลงทะเบียนไว้แล้ว (หลังบ้านเป็นคนตรวจ)

### API_BASE_URL คิดจาก hostname ปัจจุบัน

`core/api.config.ts` ประกอบ URL เป็น `http://<hostname ที่เปิดเว็บอยู่>:3000`

- เปิดบนคอมผ่าน localhost → `http://localhost:3000`
- เปิดบนมือถือผ่าน IP เครื่อง → `http://192.168.x.x:3000` (มือถือเข้าถึงได้จริง)

**อย่า hardcode `localhost` กลับเข้าไป** ไม่งั้นมือถือจะยิงไปหาตัวเองแล้วพังทันที
และ service ใหม่ทุกตัวต้อง import ค่านี้ ไม่ใช่เขียน URL เอง

---

## API ที่หน้าเว็บเรียกใช้

| Service | Endpoint |
|---|---|
| `AuthService` | `POST /auth/login` `/auth/register` `/auth/member/login` `/auth/member/register` |
| `MemberService` | `POST /member/all` `/member/create` `/member/register-onsite` `/member/update` `/member/remove` |
| `MeterReadingService` | `POST /meter-readings/ocr-upload` · `POST /meter-readings` · `GET /meter-readings/member/:id` |
| `MeterReadingService` | `POST /bills/scan` `/bills/scan-batch` · `GET /bills` · `GET /bills/member/:id/month` `/bills/member/:id/previous` · `PATCH /bills/:id/status` · `DELETE /bills/:id` |
| `MeterReadingService` | `GET /water-rates` `/water-rates/active` · `POST /water-rates` |
| `VillageService` | `GET /villages` `/villages/:id` · `PATCH /villages/:id` · `GET /locations/provinces` `/districts/:id` `/subdistricts/:id` |
| `AccountService` | `POST /admin/update` |
| `ReportService` | `GET|POST /me/reports` · `GET /reports` · `PATCH|DELETE /reports/:id` |
| `MemberPortalService` | `GET /me/houses` `/me/bills` `/me/admins` |

endpoint `/me/*` อ่าน id บัญชีจาก JWT ไม่รับ id จากหน้าเว็บ — ลูกบ้านจึงเห็นได้เฉพาะบ้านของตัวเอง

---

## ขั้นตอนการใช้งานจริง

### จดทีละหลัง (`/scan`)

1. เลือกบ้าน + รอบบิล (เดือน/ปี) → หน้าเว็บถาม `GET /bills/member/:id/previous`
   เพื่อเอา **เลขตั้งต้นที่หลังบ้านจะใช้คิดจริง** ไม่ใช่เดาเองจากการจดครั้งล่าสุด
2. เลือก/ถ่ายรูปหน้าปัด → อ่าน EXIF (วันถ่าย + พิกัด) จากไฟล์ต้นฉบับก่อนครอป
3. ครอบตัดเฉพาะกรอบตัวเลข แล้วส่ง `POST /meter-readings/ocr-upload` → NestJS ส่งต่อให้ Python
4. **เลขที่ AI อ่านได้จะถูกเติมลงช่องให้เฉย ๆ ไม่ได้บันทึกเอง** — คนตรวจและแก้ได้ก่อนกดบันทึก
5. กดบันทึก → `POST /bills/scan` จดมิเตอร์ + ออกบิลในทรานแซกชันเดียว
   (หลังบ้านคิด `previous_unit` / `usage_unit` / `total_amount` เองทั้งหมด)
6. ถ้าหน่วยน้ำสูงผิดปกติ หรือเลขน้อยกว่าเดือนก่อน (เปลี่ยนมิเตอร์) หลังบ้านจะบล็อกไว้
   จนกว่าจะยืนยันด้วย `confirm_high_usage` / `confirm_meter_reset`

### จดหลายหลังรวดเดียว (`/scan-batch`)

อัปโหลดรูปทั้งกอง → `POST /bills/scan-batch` อ่านทุกใบแล้วเสนอว่ารูปไหนน่าจะเป็นของบ้านหลังไหน
โดยจับคู่จาก **เลขมิเตอร์** (ยอดสะสมที่แต่ละบ้านห่างกันมาก) ไม่ใช่ GPS ซึ่งคลาดเคลื่อน 10–30 ม.
ขณะที่บ้านห่างกันแค่ 8–20 ม. — endpoint นี้ไม่เขียนอะไรลง DB คืนแค่ข้อเสนอ
คนไล่ตรวจทีละแถวแล้วกดออกบิล ซึ่งยิง `POST /bills/scan` ทีละใบเหมือนเดิม

คิวถูกเก็บไว้ใน localStorage (อายุ 3 วัน, แยกตามคนที่ล็อกอิน) เผื่อเน็ตหลุดหรือเผลอปิดแท็บ

### หลังออกบิล

- `/history` เปลี่ยนสถานะเป็น `Paid` เมื่อลูกบ้านมาจ่าย และสั่งพิมพ์ใบเสร็จได้
- ลูกบ้านเห็นบิลของตัวเองทันทีที่ `/member/bills` พร้อมรูปหน้าปัดเป็นหลักฐาน

> หัวใจของการออกแบบอยู่ที่ข้อ 4: **AI เป็นผู้ช่วยกรอกข้อมูล คนยังเป็นคนตัดสินใจ**
> อ่านผิดก็แก้ได้ทันที และมีรูปเก็บไว้เป็นหลักฐานเสมอ

---

## สไตล์โค้ดในโปรเจกต์

- **คอมเมนต์เป็นภาษาไทย** และอธิบาย *ทำไม* ไม่ใช่ *ทำอะไร* — เจ้าของโปรเจกต์ใช้อ่านทบทวนเอง
- template ใช้ control flow ใหม่ `@if` / `@for (... ; track ...)` / `@else` — **ห้ามใช้** `*ngIf` / `*ngFor`
- ข้อความบน UI เป็นภาษาไทยสุภาพ ลงท้าย "ครับ" (กลุ่มผู้ใช้คือผู้ช่วยผู้ใหญ่บ้าน)
- แจ้งเตือนด้วย `toast` จาก `ngx-sonner` และใส่ `{ id: '...' }` เสมอกันเด้งซ้ำ
- error จาก API ให้ผ่าน `extractErrorMessage(err, 'ข้อความสำรอง')` ใน `auth/services/auth-error.ts`
- ข้อความสถานะ/วันที่/ชื่อเดือน ใช้จาก `BillPrintService` (`statusLabel`, `monthLabel`, `dateLabel`, `dueDate`)
  เพื่อให้หน้าเว็บกับใบเสร็จที่พิมพ์ตรงกัน
- **CSS ใช้ custom property จาก `src/styles.css` เท่านั้น** (`--primary`, `--text-muted`, `--line`,
  `--radius`, `--shadow`, `--sp-*`) อย่าใส่ hex สดลงไป
- สไตล์ที่ใช้ร่วมกันอยู่ในไฟล์กลาง แล้ว import คู่กับไฟล์ของหน้าตัวเอง:
  `styleUrls: ['../../portal-shared.css', './ชื่อหน้า.css']` (ฝั่งลูกบ้าน) และ `auth-shared.css` (หน้า auth)
- ดีไซน์มินิมอล ตัวหนังสือใหญ่ อ่านง่ายทุกวัย มือถือมาก่อน — ไม่ใส่ gradient/เงาหนา/อนิเมชันประดับ

---

## เทส

`npm test` รัน Vitest ผ่าน `@angular/build:unit-test` เทสที่มีเน้นตรรกะที่พังแล้วเจ็บ:
อ่าน EXIF, คำนวณระยะทาง/จับคู่บ้าน, คิวสแกนใน localStorage, ตัวกรองและสถานะในหน้าประวัติบิล,
การลบ/ลงทะเบียนลูกบ้าน และการประกอบ payload ก่อนออกบิล

---

## สิ่งที่ยังค้างอยู่

- `BillPrintService` ยังใส่ชื่อ/ที่อยู่/เบอร์หน่วยงานเป็นค่าตัวอย่าง (`orgName`, `orgAddress`, `orgPhone`)
  ต้องแก้เป็นของหมู่บ้านจริงก่อนพิมพ์ใช้งาน
- `home.ts` ยังตั้งค่า `realTotalHouses` เป็น property ธรรมดาใน `subscribe()` ทั้งที่แอปเป็น zoneless
  ควรเปลี่ยนเป็น `signal()` หรือเรียก `detectChanges()` ให้เหมือนหน้าอื่น
- `angular.json` hardcode IP `192.168.1.174` ไว้ใน `allowedHosts` — ต้องแก้ทุกครั้งที่ IP เครื่องเปลี่ยน
- ยังไม่มี Docker Compose รวม service ทั้งสามตัวเพื่อ deploy
