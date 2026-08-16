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
| Angular | 21.2 | โครงหลัก (standalone components ทั้งหมด, zoneless) |
| Angular SSR | 21.2 | render ฝั่ง server + prerender ทุก route ตอน build |
| TypeScript | 5.9 | ภาษาหลัก |
| ngx-image-cropper | 9.1 | ครอปเฉพาะช่องตัวเลขในแถวสแกน แล้วส่งให้ AI อ่านใหม่ |
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

การถ่ายรูปจากมือถือสำคัญกว่าที่คิด — **พิกัดมิเตอร์ทั้งระบบมาจาก EXIF ของรูปเท่านั้น**
ทดสอบด้วยรูปที่ก๊อปผ่านโปรแกรมแต่งรูป/แชตมาจะไม่มีพิกัดติดมา

### คำสั่งอื่น

```bash
npx ng build --configuration development   # เช็คว่าคอมไพล์ผ่าน — ใช้ตัวนี้หลังแก้โค้ดเสมอ
npm run build                              # production (มี budget + prerender ทุก route)
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
`batch-scan.css` (~6.7kB) กับ `my-bills.css` (~4.9kB) ชนเพดานแล้ว สไตล์ใหม่ของสอง component นี้
จึงถูกย้ายไปไว้ที่ `src/styles.css` (มีคอมเมนต์กำกับไว้) ถ้าเพิ่ม CSS แล้ว production build error
ให้ย้ายไป `styles.css` อย่าลบของเดิมทิ้ง

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
    ├── member/                ทะเบียนลูกบ้าน — member-list + batch-register
    ├── village/               ตั้งค่าหมู่บ้าน + เรทค่าน้ำ
    ├── account/               ตั้งค่าโปรไฟล์เจ้าหน้าที่
    ├── meter-reading/         หัวใจของระบบ (ดูตารางข้างล่าง)
    ├── report/                ระบบแจ้งเรื่อง — my-reports (ลูกบ้าน) + report-list (เจ้าหน้าที่)
    └── member-portal/         ฝั่งลูกบ้าน — member-login, my-bills, portal-shared.css
```

ข้างใน `meter-reading/`:

| ไฟล์ | หน้าที่ |
|---|---|
| `components/batch-scan/` | **หน้าสแกนหน้าเดียวของระบบ** — รูปเดียวหรือทั้งโฟลเดอร์ก็ทางนี้ |
| `components/billing-history/` | ประวัติบิล + กรอง + เปลี่ยนสถานะจ่ายเงิน + สั่งพิมพ์ |
| `components/bill-print/` | เทมเพลตใบเสร็จ (A4 ทีละใบ / สลิปหลายใบต่อแผ่น) |
| `services/bill-print.service.ts` | ข้อความสถานะ/เดือน/วันครบกำหนด ใช้ร่วมกันทั้งหน้าเว็บและใบเสร็จ |
| `services/exif.ts` | อ่านวันถ่ายและพิกัดจาก EXIF ของไฟล์ต้นฉบับ (ครอปแล้ว EXIF หาย) |
| `services/photo-file.ts` | ย่อรูปเป็น data URL ก่อนส่ง (`MAX_PHOTO_BYTES`) — canvas ทิ้ง EXIF ทั้งก้อน |
| `services/geo.ts` | ระยะ haversine, `medianCoords()`, `isFarFrom()`, `pickNearest()` แบบ "ไม่มั่นใจคืน null" |
| `services/billing-cycle.ts` | เดารอบบิลจากวันถ่ายรูป + วันจดครั้งก่อนของแต่ละบ้าน |
| `services/coords-log.ts` | รายงานพิกัดทะเบียนที่ไม่ตรงกับรูปลง terminal (ไม่เขียนทับให้เอง) |
| `services/batch-queue.store.ts` | เก็บคิวสแกนไว้ใน localStorage เผื่อปิดแท็บกลางคัน |

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
| `/scan-batch` | สแกนมิเตอร์ (มี `canDeactivate` กันเดินออกกลางคิว) |
| `/scan` | redirect มา `/scan-batch` — เหลือไว้เพราะบุ๊กมาร์กเก่ายังชี้มาที่นี่ |
| `/history` | ประวัติบิล + พิมพ์ใบเสร็จ |
| `/members` | ทะเบียนลูกบ้าน |
| `/members/batch` | ลงทะเบียนหลายบ้านจากรูปที่ถ่ายมา (มี `canDeactivate`) |
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
| `MemberService` | `POST /member/all` `/member/register-onsite` `/member/update` `/member/remove` |
| `MeterReadingService` | `POST /meter-readings/ocr-upload` · `GET /meter-readings/member/:id` |
| `MeterReadingService` | `POST /bills/scan` `/bills/scan-batch` · `GET /bills` · `GET /bills/member/:id/month` `/bills/member/:id/previous` · `PATCH /bills/:id/status` · `DELETE /bills/:id` |
| `MeterReadingService` | `GET /water-rates` `/water-rates/active` · `POST /water-rates` |
| `VillageService` | `GET /villages` `/villages/:id` · `PATCH /villages/:id` · `GET /locations/provinces` `/districts/:id` `/subdistricts/:id` |
| `AccountService` | `POST /admin/update` |
| `ReportService` | `GET\|POST /me/reports` · `GET /reports` · `PATCH\|DELETE /reports/:id` |
| `MemberPortalService` | `GET /me/houses` `/me/bills` `/me/admins` |

endpoint `/me/*` อ่าน id บัญชีจาก JWT ไม่รับ id จากหน้าเว็บ — ลูกบ้านจึงเห็นได้เฉพาะบ้านของตัวเอง

ลงทะเบียนบ้านใช้ `/member/register-onsite` เท่านั้น (ไม่ใช้ `/member/create`) เพราะมันสร้าง
บ้าน + การจดครั้งแรกในทรานแซกชันเดียว จึงไม่มีสภาพ "บ้านที่ไม่มีเลขตั้งต้น" ซึ่งทำให้บิลใบแรกคิดจาก 0

---

## พิกัดมิเตอร์มาจาก EXIF ของรูปเท่านั้น

**ทั้งแอปไม่มีการเรียก `navigator.geolocation` เหลืออยู่แล้ว และห้ามเอากลับเข้ามา** — เครื่องที่ไม่มี
GPS จริง (คอมที่ทำงานอยู่ที่ทำการ หรือมือถือที่ปิดตำแหน่ง) เดาพิกัดจากเน็ต แล้วคืนค่าที่ห่างมิเตอร์จริง
เป็นร้อยกิโล ค่าพวกนี้เคยถูกบันทึกทับจนจับคู่รูปผิดบ้านมาแล้ว

พิกัดทุกจุดอ่านจากไฟล์รูปต้นฉบับด้วย `readPhotoMetadata()` (`meter-reading/services/exif.ts`)
แล้วกรองด้วย `toCoords()` — ต้องอ่าน **ก่อน** ครอป/ย่อ เพราะ canvas ทิ้ง EXIF ทั้งก้อน
(ดู `photo-file.ts`) ที่ทำแบบนี้แล้ว: `member-list`, `batch-register`, `batch-scan`

- หน้าสแกน (`batch-scan`) **ไม่แก้พิกัดในทะเบียนเอง** เจอบ้านที่พิกัดใช้ไม่ได้ให้เรียก
  `logCoordsMismatch()` ปล่อยบรรทัดรายงานลง terminal แล้วให้คนไปกดแก้ที่หน้าทะเบียน
  (ของเดิมยิง `/member/update` ทับให้เงียบ ๆ พอจับคู่ผิดหลังทีเดียวก็ทับพิกัดที่ถูกทิ้งโดยไม่มีร่องรอย)
- หน้าทะเบียนลูกบ้าน (`member-list`) **ไม่มีชั้นตรวจพิกัดแล้ว** — แนบรูปไหนก็เอาพิกัดของรูปนั้น
  บันทึกเลย ไม่เตือนว่าผิดปกติ ไม่เสนอพิกัดจากครั้งที่จด ของพวกนั้นเป็นมรดกจากยุคที่ยังวัดพิกัด
  จากเครื่อง พอทางเข้าเหลือรูปทางเดียวก็ไม่มีอะไรให้ตรวจ

---

## ขั้นตอนการใช้งานจริง

### สแกนมิเตอร์ (`/scan-batch`) — หน้าสแกนหน้าเดียวของระบบ

โหมด "ถ่ายทีละหลัง" เดิม (`meter-cropper`) ถูกยุบรวมเข้ามาแล้ว ถ่ายรูปเดียวก็เดินทางเดียวกัน
**อย่าแยกหน้าใหม่อีก** — ของเดิมสองหน้าทำให้ด่านความปลอดภัย (พิกัด/จำนวนหลัก/หน่วยพุ่ง)
ต้องเขียนสองชุดแล้วเพี้ยนคนละแบบ

1. เลือกรูปทั้งกอง → ระบบตั้งรอบบิลตามวันถ่ายส่วนใหญ่ในกอง (`billing-cycle.ts`)
2. หน่วง 1.2 วิ แล้วยิง `POST /bills/scan-batch` เอง (กันคนเลือกเพิ่มอีกชุดแล้วยิงสองรอบ)
   endpoint นี้ **ไม่เขียนอะไรลง DB** คืนแค่เลขที่อ่านได้ + ข้อเสนอว่ารูปไหนน่าจะเป็นของบ้านไหน
3. ใบที่ผ่านทุกด่าน (`autoSavable()`) ออกบิลต่อให้ทันที ที่เหลือตกมาให้คนไล่ตรวจทีละแถว
4. ออกบิลจริงยิง `POST /bills/scan` ทีละใบเสมอ — จดมิเตอร์ + ออกบิลในทรานแซกชันเดียว
   (หลังบ้านคิด `previous_unit` / `usage_unit` / `total_amount` เองทั้งหมด)

หลังบ้านจับคู่รูปกับบ้านจาก **เลขมิเตอร์** เป็นหลัก (ยอดสะสมที่แต่ละบ้านห่างกันมาก) ไม่ใช่ GPS
ซึ่งคลาดเคลื่อน 10–30 ม. ขณะที่บ้านห่างกันแค่ 8–20 ม.

**เงื่อนไขที่ระบบออกบิลให้เอง** (`autoSavable()`) — ต้องยืนยันบ้านได้ทางใดทางหนึ่ง:

- พิกัดในรูปห่างมิเตอร์ **≤ 25 ม.** และไม่มีบ้านหลังอื่นใกล้พอ ๆ กัน (หลังรองต้องห่างกว่า
  อีกอย่างน้อย 15 ม. — `hasCloseRival()` บ้านที่มิเตอร์ติดกันเป็นแถวเข้าเกณฑ์พร้อมกันหลายหลัง
  GPS ชี้ขาดไม่ได้)
- หรือหลังบ้านชี้จากเลขมิเตอร์แบบ `high` โดยพิกัด (ถ้ามีทั้งสองฝั่ง) ไม่ค้านกันเกิน 50 ม.

**และ** ต้องไม่ติดด่านไหนเลย: AI อ่านเลข ≥ 85% · รูปมีวันถ่าย · วันถ่ายอยู่ในรอบที่กำลังออก ·
ไม่มี warning จากหลังบ้าน · หน่วยไม่พุ่งเกิน 3 เท่าของค่าเฉลี่ย (และห่างเกิน 30 หน่วย) ·
ไม่ซ้ำในกอง · ยังไม่มีบิลของรอบนี้

> เพิ่มด่านเข้าไปได้ **อย่าถอดออก** — ใบที่ระบบออกให้เองไม่มีใครตรวจซ้ำ และเดิมพันคือเงินที่
> ลูกบ้านต้องจ่าย ธง `confirm_*` (หน่วยพุ่ง / เปลี่ยนมิเตอร์ / จำนวนหลักเปลี่ยน) ไม่เคยถูกส่ง
> เป็น true เอง ใบที่ติดด่านของหลังบ้านตกมาให้คนกดยืนยันเสมอ

แถวที่พิกัดชี้ไม่ขาด (ยังไม่รู้ว่าบ้านไหน หรือมีหลังอื่นใกล้พอ ๆ กัน) จะขึ้นปุ่มบ้านใกล้เคียงสูงสุด
3 หลังให้กดเลือก (`showNearbyChoices()` / `row.nearby` — คิดไว้ล่วงหน้าที่แถว ไม่คำนวณสดใน template)

ใบไหนอ่านไม่ออกหรืออ่านมาไม่มั่นใจ กด **"ครอปแล้วอ่านใหม่"** ในแถวนั้นได้ ระบบส่งเฉพาะกรอบ
ตัวเลขกลับไปอ่านใหม่ **แล้วจับคู่บ้านให้ใหม่ตามเลขที่ได้ด้วย** (บ้านที่เสนอมาตอนแรกคิดจากเลข
ตัวเก่า ถ้าไม่คิดใหม่จะได้เลขถูกแต่บิลออกผิดบ้าน)

คิวถูกเก็บไว้ใน localStorage (อายุ 3 วัน แยกตามคนที่ล็อกอิน) เผื่อเน็ตหลุดหรือเผลอปิดแท็บ

### ลงทะเบียนบ้าน (`/members`, `/members/batch`)

ถ่ายรูปหน้าปัดตอนยืนอยู่หน้ามิเตอร์ → พิกัด + วันถ่ายมาจาก EXIF ของรูปนั้น → `register-onsite`
สร้างบ้านพร้อมเลขตั้งต้น `/members/batch` เอาไว้ถ่ายให้ครบทั้งหมู่บ้านก่อนแล้วค่อยกลับมานั่งกรอก

### หลังออกบิล

- `/history` เปลี่ยนสถานะเป็น `Paid` เมื่อลูกบ้านมาจ่าย และสั่งพิมพ์ใบเสร็จได้
- ลูกบ้านเห็นบิลของตัวเองทันทีที่ `/member/bills` พร้อมรูปหน้าปัดเป็นหลักฐาน

> หัวใจของการออกแบบ: **AI เป็นผู้ช่วยกรอกข้อมูล คนยังเป็นคนตัดสินใจ** ใบที่ระบบออกให้เอง
> ต้องผ่านด่านครบทุกข้อ ที่เหลืออ่านผิดก็แก้ได้ทันที และมีรูปเก็บไว้เป็นหลักฐานเสมอ

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

| กลุ่ม | ครอบอะไร |
|---|---|
| `exif.spec.ts` · `geo.spec.ts` | อ่าน EXIF, ระยะทาง, จับคู่บ้านแบบ "ไม่มั่นใจคืน null" |
| `billing-cycle.spec.ts` · `batch-queue.spec.ts` | เดารอบบิลจากวันถ่าย, คิวสแกนใน localStorage |
| `batch-scan.*.spec.ts` | ด่านออกบิลอัตโนมัติ, จำนวนหลัก, ครอปอ่านใหม่, ปุ่มบ้านใกล้เคียง |
| `billing-history.*.spec.ts` · `bill-print.spec.ts` | ตัวกรอง/สถานะในหน้าประวัติ + ใบเสร็จ |
| `member-list.*.spec.ts` · `batch-register.spec.ts` · `member.service.spec.ts` | ลงทะเบียน/ลบบ้าน + payload |

---

## สิ่งที่ยังค้างอยู่

- `BillPrintService` ยังใส่ชื่อ/ที่อยู่/เบอร์หน่วยงานเป็นค่าตัวอย่าง (`orgName`, `orgAddress`, `orgPhone`)
  ต้องแก้เป็นของหมู่บ้านจริงก่อนพิมพ์ใช้งาน
- `home.ts` ยังตั้งค่า `realTotalHouses` เป็น property ธรรมดาใน `subscribe()` ทั้งที่แอปเป็น zoneless
  ควรเปลี่ยนเป็น `signal()` หรือเรียก `detectChanges()` ให้เหมือนหน้าอื่น
- `angular.json` hardcode IP `192.168.1.174` ไว้ใน `allowedHosts` — ต้องแก้ทุกครั้งที่ IP เครื่องเปลี่ยน
- `CoordsReport.source` ยังมีค่า `'meter-cropper'` ค้างอยู่ทั้งที่หน้านั้นถูกยุบไปแล้ว
- ยังไม่มี Docker Compose รวม service ทั้งสามตัวเพื่อ deploy
