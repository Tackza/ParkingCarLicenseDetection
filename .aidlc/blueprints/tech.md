# Tech

## Summary
- **Stack**: JavaScript / Expo SDK 51 + React Native 0.74 / SQLite ในเครื่อง (expo-sqlite, WAL)
- **Architecture**: Expo Router file-based + React Context, local-first พร้อม background sync 2 ลูป; ไม่มี API ของตัวเอง เรียก REST ภายนอก
- **Infra**: ไม่มี cloud ของตัวเอง — EAS Build ออกเป็น APK, EAS Update ส่ง OTA

## Stack
- **Languages**: JavaScript เป็นหลัก; TypeScript เฉพาะขอบ (`app/_layout.tsx`, `hooks/`, `constants/Colors.ts`, component จาก Expo template) — **อย่าแปลงไฟล์เป็น TS เป็นงานแถม**
- **Frameworks**: Expo 51.0.5, React Native 0.74.1, React 18.2.0, Expo Router 3.5, expo-sqlite 14
- **Build system**: npm; EAS Build (`production` → release APK)
- **Package manager**: npm (`package-lock.json`); `postinstall` เรียก `patch-package` แต่ยังไม่มีโฟลเดอร์ `patches/`
- **Testing**: `jest-expo` — มีเทสต์เดียวที่เหลือจาก template **ถือว่าไม่มี test suite**

## Architecture
- **Pattern**: Layered แบบบาง — screen (Expo Router) → context → `constants/Database.js` → SQLite; ไม่มี service/repository layer
- **API style**: REST ภายนอก, response เป็น `{ status: "success", result: ... }`

## Infrastructure
- **Cloud provider**: ไม่มีของตัวเอง
- **Compute**: แท็บเล็ต Android ที่หน้างาน
- **Database**: SQLite ในเครื่อง (`LicensePlateReader.db`, WAL mode), `PRAGMA user_version` ปัจจุบัน **v8**
- **IaC**: ไม่มี

## Patterns & Conventions
- **Architecture pattern**: provider ซ้อน `EnvironmentProvider → AuthProvider → SyncProvider → ProjectProvider → ModeProvider → PrinterProvider` (ลำดับสำคัญ inner อ่านจาก outer)
- **Data access**: async function ล้วนใน `constants/Database.js` (~1,480 บรรทัด) ทุกตัวเริ่มด้วย `await getDb()`
- **API response format**: `{ status, result }`; registers ใช้ชื่อฟิลด์ย่อแล้ว map เป็นชื่อเต็มตอนบันทึก
- **Error handling**: `try/catch` ทุกจุด → `insertErrorLog()` (ครั้งเดียว) หรือ `insertErrorLogThrottled()` (ใน polling loop)
- **Authentication**: Bearer token จาก `sessions` อ่านผ่าน `getActiveSession()`
- **Validation**: เขียนมือ inline ไม่มี schema library
- **Logging**: `console.log` + ตาราง `error_logs` (export จากหน้า Settings — ช่องทางเดียวในการ debug หน้างาน)
- **Styling** (หัวข้อของงานนี้): `StyleSheet.create` ใน 22 ไฟล์ ~1,970 บรรทัด **ไม่มี design token ไม่มีธีม** สี hex เขียนตรงในไฟล์ 54 สีไม่ซ้ำ
  - palette ไม่เป็นทางการที่ใช้จริง: `#3498db` (น้ำเงินหลัก, 39 ครั้ง), `#f8f9fa` (พื้นหลัง, 26), `#2c3e50` (ตัวอักษรเข้ม, 24), `#7f8c8d` (ตัวอักษรจาง, 23), `#e9ecef` (เส้นขอบ, 21), `#e67e22` (ส้มเตือน), `#27ae60` (เขียวสำเร็จ)
  - `constants/Colors.ts` + `hooks/useThemeColor` **มีอยู่แต่เป็น dead code** — ถูกใช้แค่โดย `ThemedText`/`ThemedView`/`Collapsible` ซึ่งเหลือจาก template ไม่มีหน้าจอจริงเรียกใช้
  - **ทิศทางที่ตัดสินแล้ว (D3, feature `nativewind-migration`)**: ย้ายไป **NativeWind 4.2.7 + Tailwind CSS 3.4.19** โดยนิยาม semantic token (`primary`, `background`, `surface`, `text`, `text-muted`, `border`, `warning`, `success`, `accent`) ไว้ใน `tailwind.config.js` เป็นแหล่งเดียว ค่าสีที่แสดงผลต้องเท่าของเดิมทุกตัว เริ่มนำร่องที่ `app/login.js`
  - ⚠️ **ต้อง pin `tailwindcss@^3.4.19`** — `nativewind@4.2.7` ประกาศ peer dep เป็น `>3.3.0` ซึ่งเปิดรับ Tailwind v4 ที่เปลี่ยนไปใช้ CSS-first config และไม่ใช้ `tailwind.config.js` ติดตั้งแบบไม่ระบุเวอร์ชันแล้ว config จะถูกเมินเงียบๆ
- **Code style**: ไม่มี ESLint config (`npm run lint` ใช้งานไม่ได้จริง); คอมเมนต์ส่วนใหญ่เป็นภาษาไทย — เขียนตามไฟล์ที่กำลังแก้
- **Naming conventions**: camelCase ใน JS, snake_case สำหรับคอลัมน์ SQLite
- **Branch strategy**: `main` เป็นหลัก, งานแยกเป็น branch `claude/*`

## Environment Configuration
- **Config approach**: **ไม่มีไฟล์ `.env`** — ค่า runtime (environment, โหมด, รหัสเครื่อง, เครื่องพิมพ์) อยู่ในตาราง `settings` ของ SQLite
- **Environments**: `prod` (ค่าเริ่มต้น) / `test` สลับจากหน้า Settings
- **Secrets management**: token เก็บในตาราง `sessions`; ไม่มี secret ฝังในโค้ด
- **ข้อควรระวัง**: base URL ของ API ถูกเขียนซ้ำเป็น ternary ใน **7 ไฟล์** เปลี่ยนทีต้องแก้ครบ

## CI/CD Pipeline
- **Tool**: EAS (ไม่มี CI ในรีโป ไม่มี GitHub Actions)
- **Stages**: build ด้วยมือ → OTA ด้วยมือ
- **Deploy target**: APK ติดตั้งบนแท็บเล็ต + OTA ผ่าน channel `production` (`checkAutomatically: ON_LOAD`, `runtimeVersion` 1.0.0)
- **ผลต่องานนี้**: NativeWind อยู่ที่ชั้น babel/metro ผลลัพธ์ยังเป็น JS bundle จึง**คาดว่า** OTA ได้ ต้องพิสูจน์

## Dependency Management
- **Lockfile**: `package-lock.json`
- **Version strategy**: pin ตามที่ Expo SDK 51 กำหนด (ใช้ `npx expo install` ไม่ใช่ `npm install` ตรงๆ สำหรับแพ็กเกจของ Expo)
- **Monorepo tooling**: ไม่มี

## Known Technical Debt
- **ไม่มี test suite** — ความเสี่ยงสูงสุดของงาน refactor นี้
- `android/` และ `ios/` ถูก commit ไว้ → **config plugin ของ Expo จะไม่ apply เอง** ต้องแก้ manifest ด้วยมือ
- `settings.js` มี `if (loading) return` กลางไฟล์ โดยมี hook ทั้งหมดอยู่เหนือมัน — เติม hook ใต้บรรทัดนั้นจอพังทันที
- `ProjectProvider` ประกาศ hook ใต้ early return รอดอยู่ได้เพราะ `AuthProvider` กันไว้ชั้นบน
- sync ทั้งสองลูปหยุดเมื่อจอดับ (`BackgroundTimer.setTimeout` = `Handler.postDelayed` ไม่มี wake lock)
- `user` ไม่เคยถูกอ่านกลับจาก SQLite ตอนเปิดแอพ
- dead code จำนวนมาก: `components/scan_normal.js`, `components/oldFile/`, `SamplePrint`+`printData`+`dummy-logo`, `SyncStatus`, `styles.js`, `OrderSlip`+`base64Image`
