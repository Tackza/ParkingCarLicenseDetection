# Design Decisions (D3)

## Context Summary

- **Type / Scope**: Brownfield / `refactor` — เปลี่ยนวิธีเขียน style โดยไม่เปลี่ยนพฤติกรรม
- **Stack**: JavaScript / Expo SDK 51.0.5 / React Native 0.74.1 / React 18.2.0
- **Pilot**: `app/login.js` (75 บรรทัด style) — หน้าจอเล็กที่สุด ไม่มี logic ผูกกับ style
- **ของเดิม**: `StyleSheet.create` ใน 22 ไฟล์ ~1,970 บรรทัด, ไม่มี design token, hex 54 สีไม่ซ้ำ
- **Palette ที่ใช้จริง**: `#3498db` (39), `#f8f9fa` (26), `#2c3e50` (24), `#7f8c8d` (23), `#e9ecef` (21), `#e67e22`, `#27ae60`, `#f39c12`
- **ข้อจำกัดสำคัญ**: ไม่มี test suite; แอพรันอยู่จริงที่จุดตรวจ; `Receipt.js` ถูกแคปเป็นภาพไปพิมพ์ลงกระดาษ
- **ที่ตรวจแล้ว**: NativeWind v4 ใช้กับ Expo SDK 51 / RN 0.74 ได้; `react-native-reanimated ~3.10.1` ที่มีอยู่ตรงกับที่ RN 0.74 ต้องการ
- **คำถาม Operations & Observability ถูกข้าม** ตามกติกาของ scope `refactor`

---

## Decision Questions

### D3-1: เวอร์ชันหลักของ NativeWind
**Question**: จะใช้ NativeWind สายไหน (เป็นการเลือก major version track ซึ่งมีวิธีตั้งค่าและเส้นทาง migrate ต่างกันจริง ไม่ใช่แค่เลขเวอร์ชัน)
- 1) **v4** — สายที่มีคนใช้กับ Expo SDK 51 จริงจนมีเอกสาร/กระทู้รองรับ เข้ากับ reanimated ~3.10 ที่เรามีอยู่ **(Recommended)**
- 2) **v5** — สายใหม่กว่า มีคู่มือ migrate from v4 แต่ยังไม่พบหลักฐานการใช้กับ SDK 51 ที่เก่าขนาดนี้
- 3) ไม่ใช้ NativeWind — หาทางอื่นที่ให้ DX คล้าย Tailwind
- 4) Other (please specify): _______

**Answer**: 1) NativeWind v4 — สายที่มีหลักฐานการใช้กับ Expo SDK 51 / RN 0.74 จริง และเข้ากับ reanimated ~3.10.1 ที่โปรเจกต์มีอยู่

---

### D3-2: กลยุทธ์เรื่องสีและ design token
**Question**: จะจัดการสี 54 ตัวที่กระจายอยู่อย่างไร
- 1) **สกัดเป็น semantic token** — ตั้งชื่อตามบทบาท (`primary`, `surface`, `text`, `muted`, `border`, `warning`, `success`) แล้ว map สีเดิมเข้าไป ได้ระบบที่ขยายต่อได้ **(Recommended)**
- 2) **map 1:1 ตามที่เป็น** — ใส่ hex ทั้ง 54 ตัวเป็น token ชื่อตามค่าสี เปลี่ยนน้อยที่สุด เสี่ยงน้อยที่สุด แต่ไม่ได้แก้ปัญหาความไม่สม่ำเสมอ
- 3) **ใช้ palette default ของ Tailwind** — ทิ้งสีเดิม ใช้ `blue-500` ฯลฯ **หน้าตาแอพจะเปลี่ยน** ซึ่งขัดกับ scope `refactor`
- 4) Other (please specify): _______

**Answer**: 1) สกัดเป็น semantic token (primary, surface, text, muted, border, warning, success) แล้ว map สีเดิมเข้าไป — ค่าสีที่แสดงผลต้องเท่าเดิมทุกประการ

---

### D3-3: ที่เก็บ token
**Question**: จะนิยาม token ไว้ที่ไหน
- 1) **`tailwind.config.js` อย่างเดียว** — แหล่งเดียว เรียบง่ายที่สุด **(Recommended)**
- 2) **CSS variables + `tailwind.config.js`** — รองรับการสลับธีมในอนาคต แต่ซับซ้อนกว่า
- 3) **ใช้ `constants/Colors.ts` ที่มีอยู่แล้วเป็นแหล่งจริง** แล้วให้ config อ่านจากมัน — หมายเหตุ: ไฟล์นี้ตอนนี้เป็น dead code ถูกใช้แค่โดย component ที่เหลือจาก template
- 4) Other (please specify): _______

**Answer**: 1) นิยามใน tailwind.config.js อย่างเดียว เป็นแหล่งจริงแหล่งเดียว

---

### D3-4: วิธีแปลง style ในไฟล์ pilot
**Question**: ใน `login.js` จะแปลงอย่างไร
- 1) **แปลงเป็น `className` ทั้งไฟล์** — ลบ `StyleSheet.create` ออกหมด พิสูจน์ได้เต็มที่ว่าแนวทางใช้ได้จริง **(Recommended)**
- 2) **ผสม** — ใช้ `className` กับ layout/สี แต่คง `StyleSheet` ไว้กับส่วนที่ซับซ้อน
- 3) **ใช้ `styled()` wrapper** — ห่อ component แล้วค่อยใส่ class
- 4) Other (please specify): _______

**Answer**: 1) แปลง app/login.js เป็น className ทั้งไฟล์ ลบ StyleSheet.create ออกหมด

---

### D3-5: ชะตากรรมของ `StyleSheet` เดิมในไฟล์ที่แปลงแล้ว
**Question**: เมื่อแปลงเสร็จ จะทำอย่างไรกับโค้ด style เดิม
- 1) **ลบทิ้งใน commit เดียวกัน** — ไม่เหลือโค้ดตาย diff อ่านง่าย ย้อนกลับด้วย git ได้อยู่แล้ว **(Recommended)**
- 2) **คอมเมนต์ทิ้งไว้ก่อน** จนกว่าจะยืนยันผลที่หน้างาน แล้วค่อยลบในรอบถัดไป
- 3) เก็บไว้ถาวรเพื่อเทียบ
- 4) Other (please specify): _______

**Answer**: 1) ลบ StyleSheet เดิมใน commit เดียวกับที่แปลง (ย้อนกลับด้วย git ได้)

---

### D3-6: เกณฑ์ยืนยันว่า pilot สำเร็จ
**Question**: จะถือว่าผ่านเมื่อไหร่ (ข้อจำกัด: ไม่มี test suite และไม่มีแท็บเล็ต Android ต่ออยู่กับเครื่องพัฒนา)
- 1) **bundle ผ่าน + เทียบภาพ before/after ด้วยตา + มีคนที่หน้างานยืนยันหนึ่งเครื่อง** **(Recommended)**
- 2) **bundle ผ่าน + เทียบภาพด้วยตา** เท่านั้น
- 3) **bundle ผ่าน** เท่านั้น
- 4) Other (please specify): _______

**Answer**: 3→แก้หลัง validation) bundle ผ่าน + ให้คนที่หน้างานยืนยันหนึ่งเครื่อง — ตัด "เทียบภาพ before/after ในเครื่องพัฒนา" ออก เพราะไม่มีอุปกรณ์ Android ต่ออยู่

---

### D3-7: ช่องทาง deploy สำหรับ pilot
**Question**: จะส่ง pilot ออกอย่างไร (ยังไม่ยืนยันว่า NativeWind ผ่าน OTA ได้ ต้องพิสูจน์)
- 1) **OTA ไป channel `preview` ก่อน** แล้วค่อยขึ้น `production` เมื่อยืนยันแล้ว — ไม่กระทบเครื่องหน้างาน **(Recommended)**
- 2) **OTA ไป `production` เลย** เหมือนที่ทำมาตลอด
- 3) **build APK ใหม่** เพราะไม่ไว้ใจว่า babel/metro จะผ่าน OTA
- 4) Other (please specify): _______

**Answer**: 2→แก้หลัง validation) OTA ไป production โดยตรง พร้อมเตรียมย้อนกลับด้วย eas update:republish ทันทีถ้าเพี้ยน

---

### D3-8: Correctness & Property-Based Testing
**Question**: งาน refactor นี้ต้องพิสูจน์ความถูกต้องระดับไหน (บังคับถาม — ปัจจุบันโปรเจกต์**ไม่มี test ที่ครอบคลุมโค้ดจริงเลย**)
- 1) **ไม่เพิ่ม test** — อาศัยการเทียบด้วยตา เพราะ refactor นี้ไม่แตะ logic และการเพิ่ม test ที่นี่ไม่คุ้ม **(Recommended)**
- 2) **เพิ่ม snapshot test ให้ `login.js`** ก่อนแปลง เพื่อจับ regression ของ tree ที่ render ออกมา
- 3) **เพิ่ม property-based test** — ไม่เหมาะกับงาน style ที่ไม่มี invariant เชิงคำนวณให้ทดสอบ
- 4) Other (please specify): _______

**Answer**: 1) ไม่เพิ่ม test — refactor นี้ไม่แตะ logic อาศัยการเทียบด้วยตาตาม D3-6

---

### D3-9: TypeScript types สำหรับ `className`
**Question**: จะเพิ่ม type ให้ prop `className` ไหม (โปรเจกต์มี `tsconfig.json` แบบ strict แต่โค้ดเกือบทั้งหมดเป็น `.js`)
- 1) **เพิ่ม `nativewind-env.d.ts`** — ตามคู่มือมาตรฐาน ไม่กระทบไฟล์ `.js` **(Recommended)**
- 2) **ข้ามไปก่อน** — ไฟล์ pilot เป็น `.js` จึงยังไม่ต้องใช้
- 3) Other (please specify): _______

**Answer**: 1) เพิ่ม nativewind-env.d.ts ตามคู่มือมาตรฐาน

---

### D3-10: Dark mode
**Question**: จะเตรียมรองรับ dark mode ไหม (แอพตอนนี้มีธีมเดียว `userInterfaceStyle: "automatic"` ใน config แต่ไม่มีโค้ดรองรับจริง)
- 1) **ไม่ทำและไม่เตรียม** — อยู่นอก scope งานนี้ ใช้กลางแจ้งตอนกลางวันเป็นหลัก **(Recommended)**
- 2) **เตรียม token ไว้** แต่ยังไม่เปิดใช้
- 3) **ทำเลยในรอบนี้** — จะทำให้ scope กลายเป็น `feature` ไม่ใช่ `refactor` แล้ว
- 4) Other (please specify): _______

**Answer**: 1) ไม่ทำและไม่เตรียม dark mode — อยู่นอก scope refactor

---

## Decisions Summary
<!-- Machine-readable compact summary. Downstream phases: read ONLY this section. -->
<!-- Auto-populated after user fills answers. One line per decision. -->
- D3-1 NativeWind version: v4
- D3-2 Color strategy: semantic tokens mapped from the existing 54 hex values (ค่าสีที่แสดงผลไม่เปลี่ยน)
- D3-3 Token location: tailwind.config.js only
- D3-4 Pilot conversion: full className in app/login.js, remove StyleSheet.create
- D3-5 Old styles: delete in the same commit
- D3-6 Verification: bundle passes + one on-site device confirms (no local visual diff — no Android device attached)
- D3-7 Deploy: OTA straight to production, with rollback via `eas update:republish` prepared before publishing
- D3-8 Correctness: no new tests; visual verification per D3-6
- D3-9 TS types: add nativewind-env.d.ts
- D3-10 Dark mode: not now, not prepared (out of refactor scope)

---

**Instructions**: เติมคำตอบในช่อง `**Answer**:` ด้านบน แล้วตอบว่า "done"

---

## Validation Notes — 2026-09-24T04:16:38Z

กฎมาตรฐานใน `validation-rules-d3.md` ไม่ติดสักข้อ (ทั้งหมดเป็นเรื่อง ORM / cloud / microservices / monorepo ซึ่งไม่เกี่ยวกับงาน styling) ข้อขัดแย้งที่พบมาจากการตรวจ `eas.json`, `app.config.js` และ `eas channel:list` กับของจริง

### 🔴 Conflict 1 — preview channel ไปไม่ถึงเครื่องหน้างาน → **แก้ด้วยตัวเลือก 2**

channel ถูกฝังตอน build เครื่องหน้างานใช้ APK จาก profile `production` จึงรับ OTA ได้เฉพาะ channel `production`; นอกจากนี้ profile `preview` ไม่ได้ตั้ง `APP_VARIANT` ทำให้ package name ชนกับ production (ติดตั้งแล้วทับแอพจริง) และ channel `preview` ยังไม่มีอยู่บน EAS

**มติ**: ส่ง OTA เข้า `production` โดยตรง และ**ต้องเตรียมคำสั่งย้อนกลับไว้ก่อนกด publish ทุกครั้ง**

**ความเสี่ยงที่ยอมรับ**: pilot จะถึงแท็บเล็ตที่ใช้งานจริงทุกเครื่องทันทีที่เปิดแอพ ตัวลดความเสี่ยงคือ (ก) ขอบเขตจำกัดที่หน้า login เท่านั้น (ข) ย้อนกลับได้ในคำสั่งเดียว (ค) ควรส่งนอกช่วงเวลากิจกรรม

### 🟡 Conflict 2 — ไม่มีอุปกรณ์สำหรับเทียบภาพ → **แก้ด้วยตัวเลือก 3**

**มติ**: ตัดการเทียบภาพในเครื่องพัฒนาออกจากเกณฑ์ เหลือ bundle ผ่าน + คนที่หน้างานยืนยัน

**ผลที่ตามมา**: ไม่มีใครเห็นหน้าจอใหม่ก่อนมันขึ้น production — ทำให้ข้อ (ค) ข้างบน (ส่งนอกเวลากิจกรรม) และความพร้อมในการย้อนกลับกลายเป็นตัวกันความเสี่ยงหลัก ไม่ใช่ทางเลือก
