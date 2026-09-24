# Structure

## Summary
- **Repo type**: Single repo, ไม่มี workspace
- **Key source dirs**: `app/` (หน้าจอ + routing), `components/`, `contexts/`, `constants/`, `utils/`
- **Main entry points**: `app/_layout.tsx` (root providers), `app/(tabs)/_layout.js` (registers sync), `components/CheckInSyncManager.js` (check-ins sync)

## Repository
- **Type**: Single
- **Root**: โปรเจกต์ Expo มาตรฐาน; `android/` และ `ios/` ถูก commit ไว้ (ไม่ใช่ managed workflow ล้วน)

## Key Directories

| Directory | Purpose | Key contents |
|---|---|---|
| `app/` | หน้าจอ + routing (Expo Router) | `_layout.tsx`, `index.js`, `login.js`, `bluetooth-setup.js`, `passenger_count.js`, `(tabs)/` |
| `app/(tabs)/` | แท็บหลัก | `_layout.js` (sync loop), `main.js`, `scan.js`, `settings.js` |
| `components/` | UI ที่ใช้ซ้ำ + sync manager | `Receipt.js`, `HistoryItem.js`, `CheckInSyncManager.js`, `LicensePlateDisplay.js` |
| `contexts/` | React Context ทั้ง 6 | `EnvironmentContext`, `AuthContext`, `SyncContext`, `ProjectContext`, `ModeContext`, `PrinterContext` |
| `constants/` | ฐานข้อมูล + ค่าคงที่ | `Database.js` (~1,480 บรรทัด), `provinces.js`, `Colors.ts` (dead) |
| `utils/` | ตัวช่วย | `exportUtils.js`, `speechUtils.js` |
| `.claude/skills/` | AI-DLC skills + ui-ux-pro-max | ติดตั้งไว้ในรีโป |
| `.aidlc/` | artifacts ของ AI-DLC | `specs/`, `workflow/`, `blueprints/` |

## Key Files

| File | Purpose | Notes |
|---|---|---|
| `CLAUDE.md` (root) | เอกสารสถาปัตยกรรมหลัก | ละเอียดมาก ดูแลต่อเนื่อง — อ่านก่อนแก้อะไรก็ตาม |
| `constants/Database.js` | schema + migration + ทุก query | monolith; migration gate ด้วย `PRAGMA user_version` ปัจจุบัน v8 |
| `app.config.js` | Expo config แบบ dynamic | อ่าน `APP_VARIANT` สลับชื่อแอพ/bundle id |
| `eas.json` | โปรไฟล์ build | `development` / `preview` / `production` |
| `babel.config.js` | มีแค่ `babel-preset-expo` | **จุดที่ NativeWind ต้องเพิ่ม preset** |
| `metro.config.js` | default ล้วน | **จุดที่ NativeWind ต้องห่อด้วย `withNativeWind`** |
| `tsconfig.json` | strict + alias `@/*` | มีอยู่แม้โค้ดส่วนใหญ่เป็น JS |
| `tailwind.config.js` | *(ยังไม่มี — จะสร้างใน `nativewind-migration`)* | แหล่งเดียวของ design token |
| `global.css` | *(ยังไม่มี — จะสร้าง)* | `@tailwind` directive; import จาก `app/_layout.tsx` |
| `nativewind-env.d.ts` | *(ยังไม่มี — จะสร้าง)* | type ของ prop `className` |

## Entry Points

| Entry | Type | Description |
|---|---|---|
| `app/_layout.tsx` | Root layout | ประกอบ provider 6 ชั้น, `setupDatabase()`, mount `CheckInSyncManager` |
| `app/index.js` | Redirect | ไปหน้า `/login` เสมอในทางปฏิบัติ |
| `app/(tabs)/_layout.js` | Tabs + sync | registers pull ทุก 30 วิ, intercept แท็บสแกนเพื่อเปิดกล้อง |
| `components/CheckInSyncManager.js` | Headless | check-ins push ทุก 10 วิ |

## Module Dependencies
```
app/_layout.tsx
  ├─→ contexts/EnvironmentContext ──┐
  ├─→ contexts/AuthContext ─────────┤
  ├─→ contexts/SyncContext          ├─→ constants/Database.js ──→ SQLite
  ├─→ contexts/ProjectContext ──────┤
  ├─→ contexts/ModeContext ─────────┤
  ├─→ contexts/PrinterContext ──────┘
  └─→ components/CheckInSyncManager ──→ Database.js + axios + expo-image-manipulator

app/(tabs)/scan.js ──→ Database.js, contexts/*, components/Receipt.js, ViewShot
app/(tabs)/main.js ──→ Database.js, components/Receipt.js, components/HistoryItem.js
app/passenger_count.js ──→ Database.js (receipt เขียน inline ไม่ใช้ Receipt.js)
```

**Dependency rules ที่สังเกตได้**: ทุกอย่างวิ่งเข้า `constants/Database.js` โดยตรง ไม่มีชั้นกลาง; context ไม่อ้างถึงกันเองนอกจากผ่าน provider ที่ซ้อนอยู่

## Data Flow
```
แตะแท็บสแกน → preventDefault → เปิดกล้อง → ส่ง imageUri เป็น route param
  → scan.js: detectPlate() — OCR บนเครื่องก่อน ถ้าใช้ไม่ได้ค่อย POST ไป Cloud Run → อ่าน plate/province
  → findRegisterByPlate() เทียบใบ C7 ในเครื่อง
  → โหมดหนึ่ง: push ไป passenger_count.js แล้ว insert ที่นั่น
     โหมดสอง: insertCheckIn() ที่ scan.js เลย
  → render <Receipt> นอกจอ (left: -10000) → captureRef → printPic()
  → CheckInSyncManager หยิบแถว sync_status IN (0,3,4) ส่งขึ้น server ทุก 10 วิ
```

## Key Abstractions

| Abstraction | Location | Purpose | Used by |
|---|---|---|---|
| `getScopeField()` / `getScopeId()` | `constants/Database.js` | คู่เลือกคอลัมน์/ค่า ตามโหมด — ต้องใช้คู่กันเสมอ | `settings.js`, `main.js`, query ภายใน |
| `getCurrentProject()` | `constants/Database.js` | เลือกกิจกรรมตามเวลา + แปลงชนิดข้อมูล | ทุก context และหน้าจอ |
| `insertErrorLogThrottled()` | `constants/Database.js` | ยุบ error ซ้ำใน polling loop | sync loop ทั้งสอง |
| render-then-capture | `scan.js`, `main.js`, `passenger_count.js` | พิมพ์สลิปด้วยการแคปภาพ ไม่ใช่คำสั่ง text | ทุกจุดพิมพ์ |

## Test Organization
- **Location**: `components/__tests__/`
- **Types**: snapshot เพียงอย่างเดียว
- **Coverage**: มีไฟล์เดียว (`ThemedText-test.tsx`) ซึ่งทดสอบ component ที่เป็น dead code — **ครอบคลุมโค้ดจริง 0%**
- **Run command**: `npm test` (`jest --watchAll`)

## Build & Deploy
- **Build output**: APK ผ่าน EAS Build profile `production`
- **Container**: ไม่มี
- **Deploy target**: ติดตั้งบน SUNMI V3 ที่จุดตรวจ; อัปเดตรายวันผ่าน OTA `eas update --branch production`

## Styling Layout (บริบทของงาน nativewind-migration)

| File | บรรทัด style | หมายเหตุ |
|---|---|---|
| `app/(tabs)/scan.js` | 602 | ใหญ่สุด ไฟล์รวม 1,681 บรรทัด |
| `app/(tabs)/settings.js` | 508 | มี early return กลางไฟล์ ระวังลำดับ hook |
| `app/(tabs)/main.js` | 312 | |
| `app/passenger_count.js` | 254 | มี receipt inline — ระวัง |
| `app/bluetooth-setup.js` | 150 | |
| `app/login.js` | **75** | ← **เป้าหมาย pilot** เล็กสุด ไม่มี logic ผูกกับ style |
| `components/Receipt.js` | 68 | **ห้ามแตะ** — แคปเป็นภาพไปพิมพ์ลงกระดาษ |
| อื่นๆ | ~140 | กระจายใน component ที่เหลือ |
