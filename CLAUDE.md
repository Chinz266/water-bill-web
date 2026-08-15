# CLAUDE.md

หน้าเว็บ Angular 21 ของระบบจัดการค่าน้ำประปาหมู่บ้าน — เจ้าหน้าที่ถ่ายรูปมิเตอร์ให้ AI อ่านเลข แล้วออกบิล ส่วนลูกบ้านล็อกอินดูบิลตัวเองได้

โปรเจกต์นี้เป็น **frontend อย่างเดียว** หลังบ้าน NestJS (`:3000`) และ AI service ของ Python (`:8000`) อยู่คนละ repo

---

## คำสั่งที่ใช้บ่อย

```bash
npm start                                  # dev server :4200 (host 0.0.0.0 เปิดจากมือถือได้)
npx ng build --configuration development   # ตรวจว่าโค้ดคอมไพล์ผ่าน — ใช้ตัวนี้เช็คหลังแก้โค้ดเสมอ
npm run build                              # production (มี budget + prerender)
npm test                                   # Vitest ผ่าน @angular/build:unit-test
```

`ng build` จะ **prerender 14 route** ทุกครั้ง โค้ดจึงถูกรันบน Node จริง ๆ ตอน build — บั๊ก SSR จะโผล่เป็น build error ไม่ใช่ runtime error

---

## กติกาที่พลาดบ่อยที่สุด 3 ข้อ

### 1. Zoneless change detection

`app.config.ts` เปิด `provideZonelessChangeDetection()` การ set property ธรรมดาใน callback ของ `subscribe()` **จะไม่ทำให้หน้าจออัปเดต**

- **service** ใช้ `signal()` / `computed()` (ดู `auth.service.ts`)
- **component** ส่วนใหญ่ใช้ `private cdr = inject(ChangeDetectorRef)` แล้วเรียก `this.cdr.detectChanges()` ปิดท้ายทุก callback ทั้ง `next` และ `error` — ทำตามแบบไฟล์ข้างเคียงที่กำลังแก้อยู่ อย่าผสมสองสไตล์ในไฟล์เดียว

### 2. SSR / prerender — ห้ามแตะ browser API ตรง ๆ

`localStorage`, `window`, `document` ไม่มีตอน prerender ทุกที่ที่ใช้ต้องกันด้วย:

```ts
private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
ngOnInit(): void {
  if (!this.isBrowser) return;   // ยิง API ตอน prerender ได้แค่ 401 เปล่า ๆ
  this.loadData();
}
```

guard ทุกตัว **คืน `true` เสมอเมื่อรันบน server** แล้วให้ฝั่ง browser เช็คซ้ำ ถ้าไม่ทำ `ng build` จะพัง เช่นเดียวกับ interceptor ที่ห้ามเด้ง route หรือขึ้น toast ตอน SSR (NG0950)

### 3. Budget ของ CSS ต่อ component

`angular.json` ตั้ง `anyComponentStyle` ไว้ warning 4kB / **error 8kB** ไฟล์อย่าง `meter-cropper.css` กับ `my-bills.css` ชนเพดานแล้ว สไตล์ใหม่ของสอง component นี้จึงถูกย้ายไปไว้ใน `src/styles.css` (มีคอมเมนต์กำกับไว้ในไฟล์) ถ้าเพิ่ม CSS แล้ว production build error ให้ย้ายไป styles.css อย่าลบของเดิมทิ้ง

---

## โครงสร้าง

```
src/app/
├── app.config.ts        zoneless + router + HttpClient(withFetch, authInterceptor)
├── app.routes.ts        route ทั้งหมด + guard
├── core/api.config.ts   API_BASE_URL — จุดเดียวของทั้งแอป
├── layout/navbar/
└── features/
    ├── auth/            login / register / welcome, guards, interceptor, auth.service
    ├── home/            หน้าแรกเจ้าหน้าที่
    ├── member/          ทะเบียนลูกบ้าน
    ├── village/         ตั้งค่าหมู่บ้าน + เรทค่าน้ำ
    ├── account/         ตั้งค่าบัญชี/โปรไฟล์
    ├── meter-reading/   meter-cropper (สแกน), billing-history, bill-print
    ├── report/          ระบบแจ้งเรื่อง — my-reports (ลูกบ้าน) + report-list (เจ้าหน้าที่)
    └── member-portal/   ฝั่งลูกบ้าน — member-login, my-bills, portal-shared.css
```

`report/` มี component ของทั้งสอง role อยู่ด้วยกัน เพราะใช้ `report.service.ts` และ
`report.constants.ts` (หมวดหมู่/สถานะ + คำไทย) ร่วมกัน แยกโฟลเดอร์แล้วจะต้องก๊อปสองที่

หน้าฝั่งลูกบ้านมีแถบบนของตัวเอง (ไม่มี navbar) สไตล์ `.portal-*` อยู่ที่
`member-portal/portal-shared.css` ใช้ร่วมกันแบบเดียวกับ `auth/auth-shared.css`:
`styleUrls: ['../../portal-shared.css', './ชื่อหน้า.css']`

**ข้อตกลงการตั้งชื่อ:** ไฟล์ไม่มี suffix `.component` — `home.ts` / `home.html` / `home.css` แต่ class ยังชื่อ `HomeComponent` ทุก component เป็น standalone และแยก template/style เป็นไฟล์ (ไม่ใช้ inline) feature ใหม่ให้แตกโฟลเดอร์ของตัวเองที่มี `components/` + `services/`

---

## Auth — ระบบมีผู้ใช้ 2 role

| role                  | ล็อกอินด้วย        | หน้าแรก         | guard         |
| --------------------- | ------------------ | --------------- | ------------- |
| `admin` (เจ้าหน้าที่) | อีเมล + รหัสผ่าน   | `/home`         | `authGuard`   |
| `member` (ลูกบ้าน)    | เบอร์โทรอย่างเดียว | `/member/bills` | `memberGuard` |

ลูกบ้านมี 2 หน้า (`/member/bills`, `/member/reports`) สลับกันด้วยแถบ `.portal-tabs`

- หลังบ้านคืน `{ access_token, user }` — `AuthService.storeSession()` เก็บลง localStorage สองคีย์ (`water-bill.admin`, `water-bill.token`) และ **ตัด `password` ทิ้งก่อนเก็บเสมอ**
- `isLoggedIn` ต้องมีทั้ง user **และ** token เซสชันเก่าที่ไม่มี token ถือว่าไม่ได้ล็อกอิน
- หลังบ้านเปิด `JwtAuthGuard` แบบ global — ทุก endpoint ต้องมี token ยกเว้น `/auth/*` `authInterceptor` แนบ `Bearer` ให้อัตโนมัติเฉพาะ request ที่ขึ้นต้นด้วย `API_BASE_URL` และเจอ 401 เมื่อไรจะ logout + เด้งไป `/login?redirectTo=...`
- guard ใช้ `router.createUrlTree()` ไม่ใช่ `router.navigate()` และเด้งคนที่ผิดฝั่งไปหน้าแรกของ role ตัวเอง

### API_BASE_URL คิดจาก hostname ปัจจุบัน

`core/api.config.ts` ประกอบ URL เป็น `http://<hostname ที่เปิดเว็บอยู่>:3000` เพื่อให้ทดสอบจากมือถือในวงแลนได้ **อย่า hardcode `localhost`** กลับเข้าไป และ service ใหม่ทุกตัวต้อง import ค่านี้ ไม่ใช่เขียน URL เอง

---

## สไตล์โค้ดในโปรเจกต์

- **คอมเมนต์เป็นภาษาไทย** และเขียนอธิบาย _ทำไม_ ไม่ใช่ _ทำอะไร_ — เจ้าของโปรเจกต์ใช้อ่านทบทวนเอง เขียนต่อให้เข้ากับความหนาแน่นของไฟล์ที่แก้อยู่
- template ใช้ control flow ใหม่ `@if` / `@for (... ; track ...)` / `@else` — ห้ามใช้ `*ngIf` / `*ngFor`
- ข้อความบน UI เป็นภาษาไทยแบบสุภาพ ลงท้าย "ครับ" (กลุ่มผู้ใช้คือผู้ช่วยผู้ใหญ่บ้าน)
- แจ้งเตือนด้วย `toast` จาก `ngx-sonner` และใส่ `{ id: '...' }` เสมอกันเด้งซ้ำ
- error message จาก API ให้ผ่าน `extractErrorMessage(err, 'ข้อความสำรอง')` ใน `auth/services/auth-error.ts`
- ข้อความสถานะ/รูปแบบวันที่/ชื่อเดือน ใช้จาก `BillPrintService` (`statusLabel`, `monthLabel`, `dateLabel`, `dueDate`) เพื่อให้หน้าเว็บกับใบเสร็จที่พิมพ์ตรงกัน
- **CSS ใช้ custom property จาก `src/styles.css` เท่านั้น** (`--primary`, `--text-muted`, `--line`, `--radius`, `--shadow`, `--sp-*`) อย่าใส่ hex สดลงไป
- ดีไซน์ยึดแนวมินิมอล ตัวหนังสือใหญ่ อ่านง่ายทุกวัย มือถือมาก่อน — ไม่ใส่ gradient/เงาหนา/อนิเมชันประดับ

---

## หมายเหตุ

`README.md` เขียนไว้ตั้งแต่ช่วงต้นโปรเจกต์และ **ล้าสมัยหลายจุด** (บอกว่ายังไม่มี JWT / URL hardcode 3 ที่ / ยังไม่มีพอร์ทัลลูกบ้าน — ทั้งหมดทำไปแล้ว) ยึดโค้ดจริงเป็นหลัก ถ้าแก้อะไรที่ทำให้ README ผิดเพิ่ม ควรอัปเดตไปด้วย

---

name: pordee
description: |
Ultra-compressed Thai+English communication mode. Cuts ~60-75% of output
tokens by speaking simple Thai while preserving technical accuracy.
Triggers:
"/pordee" / "/pordee full" / "พอดี" / "พอดีโหมด" / "พูดสั้นๆ" → enable full
"/pordee lite" → enable lite
"/pordee stop" / "หยุดพอดี" / "พูดปกติ" → disable
"/pordee-stats" / "/pordee-stats --share" → show token usage stats

---

pordee — โหมดพูดไทยกระชับ
Persistence
ACTIVE EVERY RESPONSE. ห้าม drift. ห้าม revert. Off only via `หยุดพอดี`, `พูดปกติ`, or `/pordee stop`.
Rules
Drop:
Polite particles: ครับ, ค่ะ, นะคะ, นะครับ, จ้ะ, จ้า
Hedging: อาจจะ, น่าจะ, ค่อนข้างจะ, จริงๆ, จริงๆแล้ว, ความจริงแล้ว, อันที่จริง
Filler: ก็, ก็คือ, นั่นคือ, แบบว่า, เอ่อ, อืม
Pleasantries: ยินดีครับ, ได้เลยครับ, แน่นอน, แน่นอนครับ
English-style filler that leaks in: just, really, basically, actually, simply
Verbose → terse swaps:
Verbose Terse
เนื่องจาก / เพราะว่า เพราะ
หากว่า / ในกรณีที่ ถ้า
ดำเนินการ X X
พิจารณา ดู
ในการที่จะ เพื่อ
มีความจำเป็นต้อง ต้อง
อย่างไรก็ตาม แต่
ดังนั้น เลย
ทำการแก้ไข แก้
ทำการตรวจสอบ เช็ก / ดู
มีความเป็นไปได้ อาจ
ทำให้เกิด ทำให้
โดยทั่วไปแล้ว ปกติ
Pattern: `[ของ] [ทำ] [เหตุผล]. [ขั้นต่อ].`
Levels
Level Trigger Behavior
lite `/pordee lite` Drop polite particles + hedging + pleasantries. Grammar intact. Professional Thai prose.
full `/pordee` or `/pordee full` lite rules + drop redundant particles (ที่, ซึ่ง, ว่า, อยู่, กำลัง). Drop nominalizer prefixes (การ-, ความ-) when root verb works. Fragments OK. Short synonyms.
Examples
Dev — "ทำไม React component ถึง re-render?"
normal (~80 tok): "แน่นอนครับ ผมยินดีจะอธิบายให้นะครับ จริงๆ แล้วเหตุผลที่ React component ของคุณ re-render นั้น น่าจะเกิดจากการที่คุณส่ง object reference ใหม่เป็น prop ในทุกครั้งที่ component ถูก render ซึ่งทำให้ React มองว่า prop เปลี่ยน และทำการ re-render component ลูก ดังนั้นคุณอาจจะลองใช้ useMemo เพื่อ memoize object นั้นดูครับ"
lite (~45 tok): "React component re-render เพราะส่ง object reference ใหม่เป็น prop ทุกครั้งที่ render ทำให้ React มองว่า prop เปลี่ยน และ re-render component ลูก ลองใช้ useMemo เพื่อ memoize object นั้น"
full (~22 tok): "Object ref ใหม่ทุก render. Inline object prop = ref ใหม่ = re-render. ห่อด้วย `useMemo`."
Daily — "เที่ยวเชียงใหม่ ไปเดือนไหนดี"
normal (~75 tok): "ครับ ถ้าคุณอยากไปเที่ยวเชียงใหม่ ผมแนะนำว่าน่าจะไปช่วงเดือนพฤศจิกายนถึงกุมภาพันธ์ครับ เพราะว่าเป็นช่วงที่อากาศเย็นสบาย ไม่ร้อนเกินไป และไม่มีฝนตกบ่อยเหมือนช่วงอื่นๆ จริงๆ แล้วเดือนธันวาคมก็เป็นเดือนที่นิยมที่สุดเลยนะครับ แต่ก็จะคนเยอะหน่อย"
lite (~30 tok): "ไปเชียงใหม่ ช่วงพฤศจิกายน-กุมภาพันธ์ดีที่สุด อากาศเย็นสบาย ไม่ร้อน ฝนน้อย ธันวาคมนิยมที่สุดแต่คนเยอะ"
full (~12 tok): "พ.ย.-ก.พ. ดีสุด. อากาศเย็น, ฝนน้อย. ธ.ค. คนเยอะ."
Stats
`/pordee-stats` — แสดงสถิติ token ของ session ปัจจุบัน (output tokens, cache-read tokens, estimated tokens saved, USD saved)
`/pordee-stats --share` — สรุปสถิติ 1 บรรทัด copy-paste ได้
`/pordee-stats --all` — สถิติรวมทุก session (lifetime)
`/pordee-stats --since 7d` — สถิติย้อนหลัง 7 วัน (ใช้ `Nd` หรือ `Nh`)

---

Auto-Clarity
Drop pordee briefly (write normal Thai), resume after:
Security warnings (`Warning:`, ⚠️)
Irreversible actions (DROP TABLE, rm -rf, git push --force, git reset --hard, git branch -D)
Multi-step sequences where order matters
User asks "อะไรนะ", "พูดอีกที", "อธิบายชัดๆ", "ไม่เข้าใจ", "งง", "ขยายความ"
Boundaries (NEVER pordee)
Code blocks → byte-for-byte unchanged
Commits, PRs, code review comments → normal English
Error messages → exact quote
File paths, URLs, identifiers, function names → exact
Stack traces → exact
Technical English terms (token, function, async, middleware, hook, plugin, build, deploy, error, bug, fix) → keep English
