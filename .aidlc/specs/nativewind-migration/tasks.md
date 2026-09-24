# Tasks — nativewind-migration

## Summary
- **Total tasks**: 19 ใน 6 phase *(เพิ่ม 2.2b หลังพบข้อบังคับของ toolchain — ดู audit 2026-09-24)*
- **Execution waves**: 6 (เรียงลำดับล้วน ไม่มี wave ขนาน — D4-7)
- **Strategy**: แบ่งตามความเสี่ยง — baseline → toolchain → พิสูจน์ OTA → token → UI → verify (D4-1, D4-3)
- **Testing approach**: ไม่เพิ่ม test (D4-6) — ยืนยันด้วย baseline เทียบผล + คนที่หน้างาน
- **Derived from**: `design.md` (C1–C8), `decisions-design.md` (D3), `decisions-tasks.md` (D4)

## Overview

**เหตุผลของลำดับนี้**: scope เป็น `refactor` และเราเลือกไม่เพิ่ม test โดยอ้างว่า "wave แรกพิสูจน์ toolchain ก่อนแตะ UI" เป็นเหตุผลรองรับ — **ลำดับนี้จึงเป็นเงื่อนไขบังคับ ไม่ใช่ความชอบ** สลับลำดับเมื่อไหร่ เหตุผลที่ใช้ปิด 🔴 conflict ใน D4 ก็หายไปด้วย

Phase 3 ส่ง OTA ขึ้น production ทั้งที่**ยังไม่มีอะไรเปลี่ยนที่ผู้ใช้เห็น** — นั่นคือจุดประสงค์ ถ้า toolchain พังจะพังตอนที่ยังไม่มีอะไรให้เสีย และถ้าผ่านก็แปลว่าสมมติฐานใหญ่ที่สุด (NativeWind ไปกับ OTA ได้) เป็นจริงก่อนลงแรงแปลง UI

**Legend**: `- [ ]` ยังไม่ทำ · `- [x]` เสร็จแล้ว

---

## Task Phases

- [x] 1. Baseline — บันทึกสถานะตั้งต้น *(บังคับสำหรับ scope refactor)*
  - [x] 1.1 บันทึกค่า style ปัจจุบันของ `login.js` เป็นตารางอ้างอิง
    - **Deps**: — | **Ref**: `design.md` — Design Tokens
    - แจกแจง 13 style key พร้อมค่าทุก property ลงไฟล์ชั่วคราวหรือในคอมเมนต์ของ PR
    - ตารางนี้คือ "ความจริง" ที่ใช้เทียบตอน verify — ไม่มี test จึงต้องมีสิ่งนี้แทน
  - [x] 1.2 บันทึกจุดย้อนกลับของ production
    - **Deps**: — | **Ref**: `decisions-design.md` — D3-7
    - `eas update:list --branch production --limit 1` เก็บ Group ID ปัจจุบันไว้
    - เตรียมคำสั่ง `eas update:republish --group <id>` ให้พร้อมใช้ก่อนเริ่ม phase 3
  - [x] 1.3 ยืนยันว่าไม่มีกิจกรรมที่ active อยู่
    - **Deps**: — | **Ref**: `decisions-tasks.md` — Validation Notes ข้อ 4
    - ตรวจตาราง `projects` ว่า `datetime('now','localtime')` ไม่อยู่ในช่วง `start_time`–`end_time` ของกิจกรรมใด
    - ถ้ามีกิจกรรมกำลังดำเนินอยู่ **หยุด** รอจนจบก่อน

- [x] 2. Toolchain — ตั้งค่าโดยยังไม่แตะ UI
  - [x] 2.1 ติดตั้ง dependency ด้วยเวอร์ชันที่ระบุ
    - **Deps**: 1.1, 1.2, 1.3 | **Ref**: `design.md` — C8, Version Map
    - `npx expo install nativewind@4.2.7 tailwindcss@3.4.19` (D4-5)
    - ตรวจ `package.json` หลังติดตั้งว่าได้ `tailwindcss` สาย 3.4.x จริง **ไม่ใช่ 4.x**
  - [x] 2.2 ตั้งค่า babel และ metro
    - **Deps**: 2.1 | **Ref**: `design.md` — C4, C5
    - `babel.config.js`: เพิ่ม `jsxImportSource: "nativewind"` ให้ `babel-preset-expo` และเพิ่ม preset `nativewind/babel`
    - `metro.config.js`: ห่อด้วย `withNativeWind(config, { input: "./global.css" })`
  - [x] 2.2b สร้าง `tailwind.config.js` แบบ minimal *(เพิ่มหลังอนุมัติ — ดู audit)*
    - **Deps**: 2.2 | **Ref**: `design.md` — C1 (ส่วนที่เป็นข้อบังคับของ toolchain)
    - `withNativeWind` เรียก `tailwind.config` ทันทีตอนโหลด `metro.config.js` ไฟล์นี้จึงต้องมีก่อน ไม่ใช่การตัดสินใจเชิงออกแบบ
    - ใส่เฉพาะ `content` paths + `presets: [require('nativewind/preset')]` — **ยังไม่ใส่ token** นั่นเป็นงานของ 4.1
  - [x] 2.3 สร้าง `global.css` และ import เข้าระบบ
    - **Deps**: 2.2 | **Ref**: `design.md` — C2, C6
    - `global.css`: ใส่เฉพาะ `@tailwind base/components/utilities` — **ห้ามเขียน base style เอง** ไม่งั้นจะกระทบหน้าที่ยังไม่แปลงและสลิปที่พิมพ์
    - `app/_layout.tsx`: เพิ่ม `import "../global.css"` — ไฟล์นี้ประกอบ provider ทั้ง 6 ชั้น พังแล้วแอพไม่ขึ้นเลย
  - [x] 2.4 ยืนยันว่า bundle ผ่านโดยยังไม่แตะ `login.js`
    - **Deps**: 2.3 | **Ref**: `design.md` — Implementation ลำดับข้อ 2
    - รัน export/bundle ให้ผ่านโดยไม่มี error
    - ตรวจ `git diff --stat` ว่าแตะเฉพาะ `package.json`, `package-lock.json`, `babel.config.js`, `metro.config.js`, `tailwind.config.js`, `global.css`, `app/_layout.tsx`, `nativewind-env.d.ts`, `tsconfig.json`
    - *(สองไฟล์สุดท้าย NativeWind สร้าง/แก้ให้เองตอน metro โหลด — ไม่ได้อยู่ในแผนเดิม บันทึกไว้ที่ audit)*
    - **`app/login.js` ต้องไม่ปรากฏใน diff**

- [x] 3. พิสูจน์ OTA — สมมติฐานที่ใหญ่ที่สุด
  - [x] 3.1 ส่ง OTA ขึ้น production โดยยังไม่มีการเปลี่ยนแปลงที่มองเห็น
    - **Deps**: 2.4 | **Ref**: `design.md` — Architecture (เหตุผลที่เลือก)
    - `eas update --branch production --message "NativeWind toolchain only, no visual change"`
    - ต้องมีคำสั่ง rollback จาก 1.2 พร้อมอยู่ในมือก่อนกด
  - [x] 3.2 ยืนยันว่าแอพยังเปิดได้และทำงานปกติ
    - **Deps**: 3.1 | **Ref**: `decisions-design.md` — D3-6
    - คนที่หน้างานเปิดแอพหนึ่งเครื่อง ยืนยันว่าเข้าสู่ระบบได้ สแกนได้ พิมพ์สลิปได้
    - **ถ้าพัง**: republish ทันที แล้วกลับไปทบทวน phase 2 — แผน deploy ทั้งหมดต้องเปลี่ยนเป็น build APK

- [ ] 4. Design tokens
  - [ ] 4.1 **เติม** semantic token เข้า `tailwind.config.js` ที่สร้างไว้แล้วที่ 2.2b
    - **Deps**: 3.2 | **Ref**: `design.md` — C1, Design Tokens
    - ใส่ token 10 ตัวตามตารางในเอกสาร design ค่า hex ต้องตรงของเดิมทุกตัว
    - `content` ต้องครอบคลุม `./app/**/*.{js,jsx,ts,tsx}` และ `./components/**/*.{js,jsx,ts,tsx}`
    - ตั้ง `input` เป็น alias ของ `background` (ทั้งคู่คือ `#f8f9fa`) เพื่อให้แยกแก้ได้ทีหลัง
    - **ไม่ต้องใส่ครบ 54 สี** — ใส่เฉพาะที่หน้า login ใช้ ที่เหลือทยอยเพิ่มเมื่อแปลงหน้าอื่น
  - [ ] 4.2 **ยืนยัน**ว่า `nativewind-env.d.ts` ถูกสร้างอัตโนมัติ
    - **Deps**: 4.1 | **Ref**: `design.md` — C3 (D3-9)
    - `withNativeWind` มี `typescriptEnvPath = "nativewind-env.d.ts"` และ `disableTypeScriptGeneration = false` จึงสร้างให้เองตอน metro รัน
    - ถ้าไม่ถูกสร้างจริง ค่อยเขียนเอง
  - [ ] 4.3 ยืนยันว่า bundle ยังผ่านหลังเพิ่ม token
    - **Deps**: 4.2 | **Ref**: `design.md` — Implementation

- [ ] 5. แปลง UI — pilot ที่ `login.js`
  - [ ] 5.1 แปลง 13 style key เป็น `className`
    - **Deps**: 4.3 | **Ref**: `design.md` — C7 (D3-4)
    - เทียบกับตารางจาก 1.1 ทีละ key ห้ามข้าม
    - ค่าที่ไม่มีใน Tailwind scale ใช้ arbitrary value (`text-[26px]`, `rounded-[20px]`) — **ห้ามปัดให้เข้า scale** เพราะเป้าหมายคือหน้าตาต้องไม่เปลี่ยน
    - **ห้ามแปลงไฟล์เป็น TypeScript** — ต้องยังเป็น `.js`
  - [ ] 5.2 จัดการเงาของกล่องฟอร์ม
    - **Deps**: 5.1 | **Ref**: `design.md` — ความเสี่ยงทางเทคนิค
    - `shadowColor/Offset/Opacity/Radius` + `elevation: 5` ไม่ map ตรงกับ `shadow-*`
    - ถ้าเทียบแล้วเพี้ยน ใช้ `style={{...}}` inline เฉพาะเงา — ยังถือว่าทำตาม D3-5 เพราะ `StyleSheet.create` ถูกลบแล้ว
  - [ ] 5.3 ลบ `StyleSheet.create` ออกจาก `login.js`
    - **Deps**: 5.2 | **Ref**: `decisions-design.md` — D3-5
    - ลบทิ้งในรอบเดียวกัน ไม่คอมเมนต์ค้างไว้
    - ลบ `StyleSheet` ออกจาก import ถ้าไม่มีอะไรใช้แล้ว

- [ ] 6. Verify และ deploy *(บังคับสำหรับ scope refactor)*
  - [ ] 6.1 เทียบผลกับ baseline
    - **Deps**: 5.3 | **Ref**: task 1.1
    - ไล่ทีละ key เทียบกับตารางจาก 1.1 ว่าทุกค่าตรงกัน
    - ตรวจ `git diff --stat` ว่าไม่มีไฟล์นอก C1–C8 ถูกแตะ
  - [ ] 6.2 ยืนยันว่า bundle ผ่านและ deploy
    - **Deps**: 6.1 | **Ref**: `decisions-design.md` — D3-7
    - ทวนเงื่อนไข 1.3 ซ้ำ (ไม่มีกิจกรรม active) และเตรียม rollback ใหม่จาก group id ล่าสุด
    - `eas update --branch production`
  - [ ] 6.3 ให้คนที่หน้างานยืนยัน
    - **Deps**: 6.2 | **Ref**: `decisions-design.md` — D3-6
    - หน้า login หน้าตาเหมือนเดิม กรอกและกดเข้าสู่ระบบได้จริง
    - **ถ้าเพี้ยน**: republish ทันที ไม่ต้องพยายามแก้สดบน production

---

## Task Summary

| ID | Title | Deps | Status |
|---|---|---|---|
| 1.1 | บันทึกค่า style ปัจจุบัน | — | ✅ |
| 1.2 | บันทึกจุดย้อนกลับ production | — | ✅ |
| 1.3 | ยืนยันไม่มีกิจกรรม active | — | ✅ |
| 2.1 | ติดตั้ง dependency | 1.1–1.3 | ✅ |
| 2.2 | ตั้งค่า babel + metro | 2.1 | ✅ |
| 2.2b | สร้าง tailwind.config.js แบบ minimal | 2.2 | ✅ |
| 2.3 | สร้าง global.css + import | 2.2 | ✅ |
| 2.4 | ยืนยัน bundle ผ่าน (ยังไม่แตะ UI) | 2.3 | ✅ |
| 3.1 | OTA ขึ้น production (ไม่มีการเปลี่ยนแปลงที่เห็น) | 2.4 | ✅ |
| 3.2 | ยืนยันแอพยังทำงานปกติ | 3.1 | ✅ |
| 4.1 | เติม token เข้า tailwind.config.js | 3.2 | ⬜ |
| 4.2 | ยืนยัน nativewind-env.d.ts ถูกสร้างเอง | 4.1 | ⬜ |
| 4.3 | ยืนยัน bundle หลังเพิ่ม token | 4.2 | ⬜ |
| 5.1 | แปลง 13 style key เป็น className | 4.3 | ⬜ |
| 5.2 | จัดการเงากล่องฟอร์ม | 5.1 | ⬜ |
| 5.3 | ลบ StyleSheet.create | 5.2 | ⬜ |
| 6.1 | เทียบผลกับ baseline | 5.3 | ⬜ |
| 6.2 | bundle + deploy | 6.1 | ⬜ |
| 6.3 | คนหน้างานยืนยัน | 6.2 | ⬜ |

*(18 task — phase 1 มี 3, phase 2 มี 4, phase 3 มี 2, phase 4 มี 3, phase 5 มี 3, phase 6 มี 3)*

## Requirements Coverage

ไม่มี — scope `refactor` ข้ามเฟส requirements จึงไม่มี `US-*` ให้ map ตาราง traceability อ้างกับ design component แทน (ดูหัวข้อถัดไป)

## Design Coverage

| Component | Task |
|---|---|
| C1 `tailwind.config.js` | 2.2b (โครง), 4.1 (token) |
| C2 `global.css` | 2.3 |
| C3 `nativewind-env.d.ts` | 4.2 (ยืนยันการสร้างอัตโนมัติ) |
| C4 `babel.config.js` | 2.2 |
| C5 `metro.config.js` | 2.2 |
| C6 `app/_layout.tsx` | 2.3 |
| C7 `app/login.js` | 5.1, 5.2, 5.3 |
| C8 `package.json` | 2.1 |

**Coverage**: 8/8 component มี task รองรับครบ · 0 entity · 0 endpoint

## Testing Coverage

- **unit / integration / e2e / load / pbt**: ไม่มี — D4-6 เลือกไม่เพิ่ม test
- **สิ่งที่ใช้แทน**: task 1.1 (baseline) เทียบกับ 6.1 (verify) และการยืนยันของมนุษย์ที่ 3.2 กับ 6.3
- **coverage_summary**: 0/8 component มี automated test — เป็นมติที่บันทึกเหตุผลไว้ใน `decisions-tasks.md` § Validation Notes

## Definition of Done

- [ ] ทุก task ติ๊ก `[x]` แล้ว
- [ ] ค่า style ทุกตัวใน 6.1 ตรงกับ baseline จาก 1.1
- [ ] `git diff --stat` ไม่มีไฟล์นอก C1–C8
- [ ] `app/login.js` ยังเป็น `.js` ไม่มี `StyleSheet.create` เหลือ
- [ ] `package.json` มี `tailwindcss` สาย 3.4.x ไม่ใช่ 4.x
- [ ] คนที่หน้างานยืนยันแล้วที่ 3.2 และ 6.3
- [ ] อัปเดต `CLAUDE.md` และ blueprints ด้วยผลจริง (รวมถึงคำตอบว่า OTA ใช้ได้หรือไม่)

## Execution Waves

D4-7 เลือกเรียงลำดับล้วน แต่ละ phase จึงเป็น wave ของตัวเอง ไม่มีการทำงานขนานและไม่มีโอกาสที่ file ownership จะชนกัน

| Wave | Phase | Deps ที่คลายแล้ว | ไฟล์ที่เป็นเจ้าของ |
|---|---|---|---|
| 1 | 1. Baseline | — | *(อ่านอย่างเดียว ไม่แก้ไฟล์)* |
| 2 | 2. Toolchain | wave 1 | `package.json`, `package-lock.json`, `babel.config.js`, `metro.config.js`, `global.css`, `app/_layout.tsx` |
| 3 | 3. พิสูจน์ OTA | wave 2 | *(ไม่แก้ไฟล์ — เป็นการ deploy และยืนยัน)* |
| 4 | 4. Design tokens | wave 3 | `tailwind.config.js`, `nativewind-env.d.ts` |
| 5 | 5. แปลง UI | wave 4 | `app/login.js` |
| 6 | 6. Verify + deploy | wave 5 | *(ไม่แก้ไฟล์)* |

**จุดหยุด**: จบทุก wave ต้องรายงานผลและรอผู้ใช้ยืนยันก่อนไปต่อ (D4-4) · commit หนึ่งครั้งต่อ wave ที่มีการแก้ไฟล์ คือ wave 2, 4, 5 (D4-8)

## Notes

**Technical debt ที่งานนี้สร้างขึ้นโดยตั้งใจ**
- หลังจบ pilot โปรเจกต์จะมี **สองระบบ style พร้อมกัน** — `login.js` ใช้ NativeWind ส่วนอีก 21 ไฟล์ยังใช้ `StyleSheet` เป็นสภาพชั่วคราวที่ต้องมีแผนปิด ไม่ใช่ปลายทาง
- `tailwind.config.js` จะมี token เฉพาะที่หน้า login ใช้ ยังไม่ครบ 54 สี

**งานต่อเนื่องที่ยังไม่ได้วางแผน**
- แปลงหน้าที่เหลือ เรียงจากเสี่ยงน้อยไปมาก: `bluetooth-setup.js` (150) → `main.js` (312) → `passenger_count.js` (254) → `settings.js` (508) → `scan.js` (602)
- `components/Receipt.js` และ receipt ใน `passenger_count.js` — **ควรเป็นกลุ่มสุดท้ายหรือไม่แปลงเลย** เพราะถูกแคปเป็นภาพไปพิมพ์ลงกระดาษ
- `constants/Colors.ts` + `hooks/useThemeColor` ที่เป็น dead code อยู่แล้ว ควรลบทิ้งเมื่อ NativeWind เข้าที่ ไม่ใช่ปล่อยให้เป็นระบบสีที่สามในโปรเจกต์
