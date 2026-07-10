# WaterBillWeb — หน้าเว็บระบบจัดการค่าน้ำประปาหมู่บ้าน

หน้าเว็บ (Angular) ของระบบ **WaterService** ที่ให้ผู้ช่วยผู้ใหญ่บ้านถ่ายรูปหน้าปัดมิเตอร์ แล้วให้ AI อ่านเลขให้ จากนั้นระบบคำนวณค่าน้ำและออกบิลต่อให้อัตโนมัติ

โปรเจกต์นี้คือ **ส่วนหน้าเว็บอย่างเดียว** หลังบ้านกับ AI อยู่คนละโฟลเดอร์ ต้องเปิดทั้งสามตัวถึงจะใช้งานได้ครบ

---

## ภาพรวมระบบ

```
┌──────────────────┐
│  WaterBillWeb    │  ← โปรเจกต์นี้ (Angular)
│  :4200           │
└────────┬─────────┘
         │ HTTP + JSON
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
| Angular | 21.2 | โครงหลักของหน้าเว็บ (standalone components) |
| Angular SSR | 21.2 | render ฝั่ง server + prerender ตอน build |
| TypeScript | 5.9 | ภาษาหลัก |
| ngx-image-cropper | 9.1 | ให้ผู้ใช้ครอบตัดรูปมิเตอร์ก่อนส่งให้ AI |
| ngx-sonner | 3.1 | แจ้งเตือน (toast) |
| Vitest | 4.0 | เครื่องมือเขียนเทส (ยังแทบไม่ได้ใช้) |

**ข้อควรรู้ 2 ข้อ** ที่ต่างจากโปรเจกต์ Angular ทั่วไป:

1. แอปเปิด **zoneless change detection** (`provideZonelessChangeDetection()`) แปลว่าการตั้งค่าตัวแปรธรรมดาใน callback ของ `subscribe()` **จะไม่ทำให้หน้าจออัปเดต** ต้องใช้ `signal()`
2. แอปเปิด **SSR + prerender** โค้ดทุกบรรทัดจะถูกรันบน Node ตอน `ng build` ด้วย ห้ามแตะ `localStorage` หรือ `window` ตรงๆ ต้องเช็ค `isPlatformBrowser()` ก่อนเสมอ

---

## วิธีรัน

ต้องเปิด **MySQL ใน XAMPP** ก่อน แล้วเปิด 3 terminal ตามลำดับนี้

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

เปิดดู API ทั้งหมดได้ที่ http://localhost:3000/api (Swagger)

**3. หน้าเว็บ** (โฟลเดอร์นี้)

```bash
npm install
npm start
```

เปิด http://localhost:4200

> ถ้ารัน NestJS โดยไม่เปิด Python ก่อน หน้าสแกนมิเตอร์จะขึ้นว่า "ระบบอ่านมิเตอร์ยังไม่พร้อมใช้งาน"

### คำสั่งอื่น

```bash
npm run build     # build production (prerender ทุกหน้า)
npm test          # รันเทสด้วย Vitest
```

---

## โครงสร้างโค้ด

```
src/app/
├── app.ts / app.html          โครงหลัก — ตัดสินใจว่าจะโชว์ navbar ไหม
├── app.config.ts              ตั้งค่า router, HttpClient, zoneless
├── app.routes.ts              เส้นทางทั้งหมด + guard
├── layout/navbar/             แถบเมนูด้านบน + ปุ่มออกจากระบบ
└── features/
    ├── auth/                  ล็อกอิน / สมัครสมาชิก
    │   ├── services/          เรียก API + เก็บ session
    │   ├── guards/            กันคนที่ยังไม่ได้ล็อกอิน
    │   └── components/        หน้า login, register
    ├── home/                  หน้าแรก — สรุปจำนวนบ้าน
    ├── member/                รายชื่อลูกบ้าน (เพิ่ม/แก้/ลบ)
    └── meter-reading/
        ├── meter-cropper/     ถ่ายรูป → ครอบตัด → ส่งให้ AI อ่าน
        └── billing-history/   ประวัติบิล + เปลี่ยนสถานะจ่ายเงิน
```

แต่ละ feature แยกเป็นโฟลเดอร์ของตัวเอง มี `components/` กับ `services/` อยู่ข้างใน

---

## เส้นทางในเว็บ (routes)

| Path | หน้า | ต้องล็อกอิน |
|---|---|---|
| `/login` | เข้าสู่ระบบ | ไม่ต้อง |
| `/register` | สมัครสมาชิก | ไม่ต้อง |
| `/home` | หน้าแรก | ✅ |
| `/scan` | สแกนมิเตอร์ | ✅ |
| `/history` | ประวัติการใช้น้ำ | ✅ |
| `/members` | จัดการลูกบ้าน | ✅ |

เปิด `/` จะเด้งไป `/home` และถ้ายังไม่ล็อกอินจะถูกส่งต่อไป `/login` โดยจำหน้าเดิมไว้ใน query param `redirectTo` พอล็อกอินเสร็จจะพากลับมาที่หน้าเดิม

---

## ระบบล็อกอินทำงานยังไง

ใช้ **อีเมล + รหัสผ่าน** ยิงไปที่ `POST /auth/login` และ `POST /auth/register`

หลังบ้าน **ยังไม่คืน JWT** คืนมาแค่ข้อมูล admin ดังนั้นตอนนี้:

- `AuthService` เก็บ admin object ลง `localStorage` (key: `water-bill.admin`) โดย **ตัด `password` ทิ้งก่อนเก็บเสมอ** เพราะหลังบ้านส่งกลับมาด้วย
- สถานะล็อกอินเปิดออกมาเป็น signal — `isLoggedIn()`, `displayName()`, `admin()`
- `authGuard` กันหน้าที่ต้องล็อกอิน ส่วน `guestGuard` กันไม่ให้คนที่ล็อกอินอยู่แล้ววนกลับมาหน้า login
- guard ทั้งสองตัว **คืน `true` เสมอตอนรันบน server** เพราะตอน prerender ยังไม่รู้ว่าใครล็อกอินอยู่ แล้วปล่อยให้ฝั่ง browser เช็คซ้ำ ถ้าไม่ทำแบบนี้ `ng build` จะพัง

> ⚠️ guard นี้แค่ซ่อนหน้าเว็บ **ไม่ได้ป้องกัน API** ทุก endpoint ของหลังบ้านยังยิงเข้าไปได้โดยไม่ต้องล็อกอิน

---

## API ที่หน้าเว็บเรียกใช้

ทุกอันชี้ไปที่ `http://localhost:3000` (hardcode ไว้ในแต่ละ service)

| Service | Endpoint | ใช้ที่ |
|---|---|---|
| `AuthService` | `POST /auth/login`, `POST /auth/register` | หน้า login, register |
| `MemberService` | `POST /member/all` `/create` `/update` `/remove` | หน้าสมาชิก, หน้าแรก |
| `MeterReadingService` | `POST /meter-readings/ocr-upload` | หน้าสแกนมิเตอร์ |
| `MeterReadingService` | `POST /bills`, `GET /bills`, `PATCH /bills/:id/status`, `DELETE /bills/:id` | หน้าประวัติ |

---

## ขั้นตอนการใช้งานจริง 1 รอบ

1. ล็อกอิน → เข้า `/home`
2. ไปหน้า **สแกนมิเตอร์** เลือกรูปหน้าปัดมิเตอร์
3. ครอบตัดเฉพาะกรอบตัวเลข แล้วกดส่ง
4. หน้าเว็บส่งรูปไป `POST /meter-readings/ocr-upload` → NestJS ส่งต่อให้ Python → AI คืนเลขกลับมา (ราว 460 ms)
5. **เลขที่ AI อ่านได้จะถูกเติมลงช่องให้ ไม่ได้บันทึกเอง** — คนตรวจและแก้ได้ก่อนกดบันทึก
6. กดบันทึก → ระบบสร้างบิลสถานะ `PENDING`
7. ไปหน้า **ประวัติการใช้น้ำ** กดเปลี่ยนสถานะเป็น `PAID` เมื่อลูกบ้านมาจ่าย

ขั้นที่ 5 คือหัวใจของการออกแบบ: AI เป็นผู้ช่วยกรอกข้อมูล คนยังเป็นคนตัดสินใจ ถ้า AI อ่านผิดก็แก้ได้ทันที และมีรูปเก็บไว้เป็นหลักฐาน

---

## สิ่งที่ยังไม่เสร็จ / ต้องแก้ก่อนใช้งานจริง

เรียงตามความเร่งด่วน

### 🔴 1. หลังบ้านยังใช้ `phone` เป็น username แต่หน้าเว็บส่ง `email`

หน้า login/register เปลี่ยนมาใช้อีเมลแล้ว แต่ตาราง `admin` **ยังไม่มีคอลัมน์ `email`** ต้องแก้หลังบ้าน 3 ไฟล์:

- `entity/admin.entity.ts` — เพิ่ม `@Column({ type: 'varchar', length: 100, unique: true }) email!: string;`
- `dto/auth-login.dto.ts` และ `dto/auth-register.dto.ts` — เปลี่ยน field `phone` เป็น `email`
- `service/auth.service.ts` — เปลี่ยน `findOneBy({ phone })` เป็น `findOneBy({ email })`

**ถ้าไม่แก้:** สมัครสมาชิกจะได้ admin ที่ไม่มีอีเมล (TypeORM ทิ้ง field ที่ไม่ใช่คอลัมน์แบบเงียบๆ) แล้วล็อกอินไม่ได้ตลอดกาล ส่วนการล็อกอินจะพังเป็น error 500

### 🔴 2. ฐานข้อมูลยังไม่มีตาราง

`app.module.ts` ตั้ง `synchronize: false` และ DB ว่างเปล่า ต้องเปิดเป็น `true` รันหนึ่งครั้งให้สร้างตาราง แล้วปิดกลับ (ทำพร้อมข้อ 1 จบในรอบเดียว)

**ถ้าไม่แก้:** บันทึกอะไรก็ error `ER_NO_SUCH_TABLE`

### 🔴 3. ยังไม่มี JWT และรหัสผ่านเก็บเป็นข้อความธรรมดา

หลังบ้านยังไม่ได้ติดตั้ง bcrypt **ห้ามขึ้นใช้งานจริงเด็ดขาด** เมื่อทำ JWT เสร็จ ฝั่งหน้าเว็บแก้แค่ `storeAdmin()` กับเพิ่ม HTTP interceptor ไม่ต้องแตะ component

### 🟡 4. `saveBill()` ยัง hardcode ค่าไว้

[meter-reading.service.ts](src/app/features/meter-reading/services/meter-reading.service.ts) ยังส่ง `meter_readings_id: 1`, `water_rates_id: 1`, `previous_unit: 0`, `create_by: 1` แบบตายตัว ต้องเปลี่ยนเป็นค่าจริงจากลูกบ้านที่เลือกและเลขมิเตอร์เดือนก่อน

**ถ้าไม่แก้:** ทุกบิลจะผูกกับลูกบ้านคนเดียวกัน และคิดหน่วยที่ใช้จาก 0 เสมอ

### 🟡 5. หน้าสแกนยังไม่มีที่เลือกลูกบ้าน

ต้องต่อ `MemberService` เข้ากับหน้าสแกนมิเตอร์ก่อน ข้อ 4 ถึงจะแก้ได้จริง

### 🟡 6. URL หลังบ้าน hardcode อยู่ใน 3 ไฟล์

`http://localhost:3000` กระจายอยู่ใน `auth.service.ts`, `member.service.ts` และ `meter-reading.service.ts` ควรย้ายไปไว้ที่ `environments/`

### 🟢 7. `home.ts` ยังไม่ใช้ signal

[home.ts](src/app/features/home/home.ts) ตั้งค่า `realTotalHouses` เป็นตัวแปรธรรมดาใน `subscribe()` ซึ่งภายใต้ zoneless อาจไม่อัปเดตหน้าจอ ควรเปลี่ยนเป็น `signal()`

---

## แผนถัดไป

- เคลียร์ข้อ 🔴 ทั้งสามข้อ
- เพิ่มระบบอัปโหลดรูปหลักฐาน (ตอนนี้ `evidence_photo` เป็นแค่ช่องเก็บข้อความ)
- ออกบิลเป็น PDF (ตาราง `bills` มีช่อง `pdf_path` เตรียมไว้แล้ว)
- เปิดให้ลูกบ้านล็อกอินดูบิลของตัวเองได้
- ใช้พิกัด lat/lng ที่เก็บไว้ ทำแผนที่วางแผนเส้นทางเดินจดมิเตอร์
- Docker Compose รวมทุก service เพื่อ deploy ง่ายขึ้น
