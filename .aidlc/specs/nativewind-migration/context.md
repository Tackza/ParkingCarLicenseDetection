# Context Assessment

## Summary
- **Type**: Brownfield
- **Scope**: refactor
- **Stack**: JavaScript / Expo SDK 51 / React Native 0.74 / expo-sqlite
- **Architecture**: Expo Router (file-based) + React Context ซ้อน 6 ชั้น, local-first พร้อม sync loop 2 ตัว
- **Feature**: ย้ายการเขียน style จาก `StyleSheet.create` ไปเป็น NativeWind (Tailwind syntax) โดยนำร่องที่ `app/login.js` ก่อน
- **Impact**: Cross-cutting (แต่ pilot จำกัดขอบเขตไว้ที่ไฟล์เดียว + build config)
- **Complexity**: Medium — pilot เอง Low แต่การขยายผลเต็มโปรเจกต์คือ ~1,970 บรรทัด ใน 22 ไฟล์
- **Recommendations**: Personas No, Units No, NFR No

## Project Overview
- **Type**: Brownfield
- **Assessment Date**: 2026-09-24T03:57:22Z

แอพ **Mbus Register** ใช้ที่จุดตรวจรถวัดพระธรรมกาย ทำงานบนแท็บเล็ต Android ขั้นตอนคือ login → เชื่อมเครื่องพิมพ์ Bluetooth → ถ่ายรูปทะเบียน → OCR → ยืนยันข้อมูล → บันทึกลงเครื่อง → ส่งขึ้น server เบื้องหลัง → พิมพ์สลิป **แอพนี้รันอยู่จริงที่หน้างานตอนนี้**

## Technology Stack
- **Languages**: JavaScript เป็นหลัก; TypeScript เฉพาะขอบ (`app/_layout.tsx`, `hooks/`, `constants/Colors.ts`, component จาก template)
- **Frameworks**: Expo SDK 51.0.5, React Native 0.74.1, React 18.2.0, Expo Router 3.5
- **Build System**: npm + EAS Build (profile `production` → APK); OTA ผ่าน `eas update` channel `production`
- **Testing**: `jest-expo` ตั้งค่าไว้ แต่มีเทสต์เดียวคือ `ThemedText-test.tsx` ซึ่งเหลือจาก template — **ถือว่าไม่มี test suite**
- **Infrastructure**: ไม่มี cloud ของตัวเอง; เรียก API ที่ `mbus.dhammakaya.network` (prod) / `mbus-test.dhammakaya.network` (test) และ OCR ที่ Cloud Run

## Patterns & Conventions
- **Architecture pattern**: Expo Router file-based routing; provider ซ้อน `EnvironmentProvider → AuthProvider → SyncProvider → ProjectProvider → ModeProvider → PrinterProvider`
- **Data access**: async function ล้วนใน `constants/Database.js` (monolith ~1,480 บรรทัด) ไม่มี ORM ไม่มี repository layer
- **API response format**: `{ status: "success", result: ... }`; ฝั่ง registers ใช้ชื่อฟิลด์ย่อ (`reg_id`, `proj_id`, `chk_date`) แล้ว map เป็นชื่อเต็มตอนบันทึก
- **Error handling**: `try/catch` ทุกจุด แล้วเขียนลงตาราง `error_logs` ผ่าน `insertErrorLog()` / `insertErrorLogThrottled()` (ตัวหลังสำหรับ polling loop)
- **Authentication**: Bearer token จากตาราง `sessions` อ่านผ่าน `getActiveSession()`
- **Validation**: เขียนมือ inline ในแต่ละหน้าจอ ไม่มี schema library
- **Logging**: `console.log` + ตาราง `error_logs` (Settings export ออกไปดูได้ — เป็นช่องทางเดียวในการ debug หน้างาน)
- **Styling** ← หัวข้อของงานนี้: `StyleSheet.create` ใน 22 ไฟล์ ไม่มี design token ไม่มีธีม สีเขียน hex ตรงในไฟล์ **54 สีไม่ซ้ำ**

## Codebase Analysis

**Entry Points**:

| Entry Point | Type | Description |
|-------------|------|-------------|
| `app/_layout.tsx` | Root layout | ประกอบ provider ทั้ง 6 ชั้น, เรียก `setupDatabase()`, mount `CheckInSyncManager` |
| `app/index.js` | Redirect | ไม่มี user → `/login` (ในทางปฏิบัติไปทางนี้เสมอ) |
| `app/(tabs)/_layout.js` | Tab layout + sync | เป็นเจ้าของ **registers pull loop** (ทุก 30 วิ) |
| `components/CheckInSyncManager.js` | Headless | **check-ins push loop** (ทุก 10 วิ) |

**Module Dependencies**:
```
app/_layout.tsx
  └─ contexts/* ──→ constants/Database.js  (ทุก context อ่าน/เขียน SQLite ผ่านไฟล์นี้)
  └─ components/CheckInSyncManager.js ──→ Database.js + axios
app/(tabs)/*.js ──→ contexts/* + Database.js + components/Receipt.js
app/passenger_count.js ──→ Database.js (มี receipt เขียน inline ของตัวเอง)
```

**Key Abstractions**:

| Abstraction | Location | Purpose |
|-------------|----------|---------|
| `getScopeField()` / `getScopeId()` | `constants/Database.js` | คู่ที่ต้องใช้ด้วยกันเสมอ — ตัวหนึ่งเลือก "คอลัมน์" อีกตัวเลือก "ค่า" ตามโหมด |
| `getCurrentProject()` | `constants/Database.js` | เลือกกิจกรรมจากเวลาปัจจุบัน + แปลงชนิดข้อมูลจาก storage เป็น JS |
| `insertErrorLogThrottled()` | `constants/Database.js` | ยุบ error ซ้ำใน polling loop ให้เหลือ 1 แถวต่อ 5 นาที |
| `<ViewShot>` + `captureRef` | `scan.js`, `main.js`, `passenger_count.js` | สลิปถูก **render เป็น view แล้วแคปเป็นภาพ** ก่อนส่งเข้าเครื่องพิมพ์ |

**Data Flow**:
```
กล้อง → OCR (Cloud Run) → แก้ไขด้วยมือ (ถ้าต้อง) → findRegisterByPlate()
   → insertCheckIn() ลง SQLite (sync_status = 0)
   → CheckInSyncManager ส่งขึ้น /lpr/checkins เป็น multipart ทุก 10 วิ
   → render <Receipt> นอกจอ → captureRef → printPic() ออกกระดาษ
```

**Integration Points**: `mbus.dhammakaya.network/api` (login, projects, registers, checkins, print-slip), OCR service บน Cloud Run, เครื่องพิมพ์ ESC/POS ผ่าน Bluetooth

**Test Organization**: `components/__tests__/ThemedText-test.tsx` เพียงไฟล์เดียว เป็น snapshot test ที่เหลือจาก Expo template — **ไม่มี test ที่ครอบคลุมโค้ดจริงเลย ข้อนี้มีผลโดยตรงกับความเสี่ยงของงานนี้**

## Feature Impact

**Affected Areas**: Cross-cutting (build config) + Modify behavior-neutral (หนึ่งหน้าจอ)

| Area | Impact | Reason |
|------|--------|--------|
| `package.json` | Modify | เพิ่ม `nativewind` + `tailwindcss` |
| `babel.config.js` | Modify | เพิ่ม preset ของ NativeWind (ตอนนี้มีแค่ `babel-preset-expo`) |
| `metro.config.js` | Modify | ห่อด้วย `withNativeWind` (ตอนนี้เป็น default ล้วน) |
| `tailwind.config.js` | New | ต้องใส่ palette 54 สีที่ใช้จริง ไม่ใช่ค่า default ของ Tailwind |
| `global.css` | New | ไฟล์ directive ของ Tailwind |
| `app/login.js` | Modify | เป้าหมาย pilot — 75 บรรทัด style |
| `nativewind-env.d.ts` | New | type สำหรับ `className` (โปรเจกต์มี `tsconfig.json` อยู่แล้ว) |

**ไม่แตะในรอบนี้**: หน้าจออื่นทั้งหมด และโดยเฉพาะ `components/Receipt.js` + receipt ใน `passenger_count.js` ซึ่งถูกแคปเป็นภาพไปพิมพ์ลงกระดาษ — layout เพี้ยนแม้เล็กน้อยแปลว่าสลิปพิมพ์ผิด ควรเป็นกลุ่มสุดท้ายหรือไม่แปลงเลย

## Recommendations

- Story Count: Low (1–4) — pilot เป็นงานเชิงเทคนิคชุดเดียว
- Domain Boundaries: ไม่มี — ไม่ใช่งานเชิงธุรกิจ
- User Types: ไม่มีผู้ใช้ใหม่ พฤติกรรมที่ผู้ใช้เห็นต้องไม่เปลี่ยน
- Integration Points: ไม่กระทบ
- **Personas**: No — ไม่มีการเปลี่ยนพฤติกรรมที่ผู้ใช้สัมผัสได้
- **Units**: No — ขอบเขตเล็กเกินกว่าจะซอยเป็น unit
- **NFR**: No — ไม่มี NFR ใหม่ แต่มี **ข้อจำกัดเชิงเทคนิคที่ต้องพิสูจน์** คือ NativeWind ต้อง deploy ผ่าน OTA (`eas update`) ได้ ไม่ต้อง build APK ใหม่

## Scope

- **Detected scope**: `refactor`
- **Rationale**: คำขอคือ "migrate to" ซึ่งอยู่ในรายการคำที่บ่งชี้ refactor โดยตรง และเป็นการเปลี่ยนวิธีเขียน style โดย**ไม่เปลี่ยนพฤติกรรมของแอพ** — หน้า login ต้องดูและทำงานเหมือนเดิมทุกประการ
- **Phases skipped**: `requirements`, `decomposition`, `deploy` (decision gate D1 และ D2 ถูกข้ามตามไปด้วย เหลือ D3 และ D4)

## Recommended Workflow

```
        ┌─────────────────┐
        │     Context     │  ← อยู่ตรงนี้
        └────────┬────────┘
                 │
                 ▼
        ┌─────────────────┐
        │     Design      │  D3: เลือกเวอร์ชัน NativeWind,
        │                 │      วิธีวาง token, กลยุทธ์ palette
        └────────┬────────┘
                 │
                 ▼
        ┌─────────────────┐
        │      Tasks      │  D4: ลำดับงาน + เกณฑ์ยืนยันผล
        └────────┬────────┘
                 │
                 ▼
        ┌─────────────────┐
        │    Implement    │  config → tailwind palette → login.js
        └────────┬────────┘
                 │
                 ▼
        ┌─────────────────┐
        │  Build & Test   │  ยืนยันว่า bundle ผ่าน และ OTA ใช้ได้
        └─────────────────┘

ข้าม: Requirements, Decomposition, Deploy
```

## External References

| Source | Type | What was used |
|--------|------|---------------|
| `CLAUDE.md` (root) | Documentation | สถาปัตยกรรม, sync loop, ข้อควรระวัง, dead code — ใช้เป็นข้อมูลตั้งต้นของการประเมิน |
| `.claude/skills/ui-ux-pro-max/data/stacks/react-native.csv` | Design guideline | แนวทาง UI/UX เฉพาะ React Native 51 ข้อ สำหรับใช้ในเฟส design |
