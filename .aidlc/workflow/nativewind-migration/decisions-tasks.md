# Tasks Decisions (D4)

## Context Summary

จากเอกสาร design ที่อนุมัติแล้ว:

- **Components**: 8 — ไฟล์ใหม่ 3 (`tailwind.config.js`, `global.css`, `nativewind-env.d.ts`), แก้ไข 5 (`babel.config.js`, `metro.config.js`, `app/_layout.tsx`, `app/login.js`, `package.json`)
- **Entities**: 0 · **Endpoints**: 0 · **Integrations**: 0 (ไม่แตะ DB และ API)
- **Version ที่ resolve แล้ว**: `nativewind@4.2.7`, `tailwindcss@3.4.19` (ต้อง pin ห้ามปล่อยตาม latest)
- **มติจาก D3 ที่ผูกกับเฟสนี้**: ไม่เพิ่ม test (D3-8) · ยืนยันด้วย bundle ผ่าน + คนหน้างานหนึ่งเครื่อง (D3-6) · OTA เข้า production โดยตรงพร้อมเตรียม rollback (D3-7)
- **ความเสี่ยงที่ระบุไว้**: OTA อาจใช้ไม่ได้ (ยังไม่พิสูจน์) · เงาของกล่องฟอร์มอาจเพี้ยน · `global.css` อาจกระทบหน้าที่ยังไม่แปลงรวมถึงสลิปที่พิมพ์
- **ผู้ทำงาน**: คนเดียว (solo)

---

## Decision Questions

### D4-1: กลยุทธ์ซอยงาน
**Question**: จะแบ่ง 8 component เป็น task อย่างไร
- 1) **แบ่งตามความเสี่ยง** — พิสูจน์ toolchain และ OTA ให้ผ่านก่อน แล้วค่อยแตะ UI ถ้าพังจะรู้ทันทีว่าพังที่ชั้นไหน **(Recommended)**
- 2) **แบ่งตามไฟล์** — หนึ่งไฟล์หนึ่ง task เรียงตามลำดับที่ต้องพึ่งพากัน
- 3) **ก้อนเดียว** — ทำทั้งหมดใน task เดียวแล้วค่อยตรวจตอนจบ
- 4) Other (please specify): _______

**Answer**: 1) แบ่งตามความเสี่ยง — พิสูจน์ toolchain และ OTA ให้ผ่านก่อน แล้วค่อยแตะ UI

---

### D4-2: ขนาดของแต่ละ task
**Question**: แต่ละ task ควรใหญ่แค่ไหน
- 1) **single-concern** — หนึ่ง task จบหนึ่งเรื่องที่ตรวจผลได้เอง (เช่น "ตั้ง babel+metro แล้ว bundle ผ่าน") **(Recommended)**
- 2) **atomic** — หนึ่งไฟล์หนึ่ง task ละเอียดที่สุด แต่ task ที่แก้ config เดี่ยวๆ จะตรวจผลไม่ได้จนกว่าจะครบชุด
- 3) **multi-concern** — รวมหลายเรื่องต่อ task ลดจำนวน task แต่ย้อนกลับยากเมื่อพัง
- 4) Other (please specify): _______

**Answer**: 1) single-concern — หนึ่ง task จบหนึ่งเรื่องที่ตรวจผลได้เอง

---

### D4-3: ลำดับความสำคัญของ component
**Question**: จะทำอะไรก่อน
- 1) **toolchain → OTA → token → UI** — ตั้ง config ให้ bundle ผ่านโดยยังไม่แตะ `login.js` แล้วทดสอบ OTA ทันที ก่อนลงแรงแปลง UI **(Recommended)**
- 2) **token → toolchain → UI** — เขียน `tailwind.config.js` ให้ครบก่อน
- 3) **UI ก่อน** — แปลง `login.js` แล้วค่อยจัดระเบียบ token ทีหลัง
- 4) Other (please specify): _______

**Answer**: 1) toolchain → OTA → token → UI

---

### D4-4: จุดหยุดให้ยืนยันระหว่างทาง
**Question**: จะให้ผมหยุดรอคุณยืนยันตอนไหนบ้าง (D3-8 ตัด test ออกแล้ว การยืนยันจึงเป็นของมนุษย์ล้วน)
- 1) **หยุดทุก wave** — จบแต่ละกลุ่มงานแล้วรายงานผลรอยืนยันก่อนไปต่อ **(Recommended)**
- 2) **หยุดเฉพาะก่อน deploy** — ทำงานรวดเดียวจนจบ แล้วมาขอยืนยันก่อนส่งขึ้น production
- 3) **ไม่ต้องหยุด** — ทำจนจบทั้งหมดรวมถึง deploy แล้วค่อยรายงาน
- 4) Other (please specify): _______

**Answer**: 1) หยุดให้ยืนยันทุก wave

---

### D4-5: วิธีติดตั้ง dependency
**Question**: จะติดตั้ง `nativewind` และ `tailwindcss` อย่างไร ให้ได้เวอร์ชันที่ต้องการจริง
- 1) **`npx expo install nativewind@4.2.7 tailwindcss@3.4.19`** — ระบุเวอร์ชันตรงตัว และให้ Expo ตรวจความเข้ากันกับ SDK 51 ไปด้วย **(Recommended)**
- 2) **`npm install --save-exact`** — pin เป๊ะไม่มี `^` แต่ข้ามการตรวจของ Expo
- 3) **`npm install nativewind tailwindcss`** — ปล่อยตาม latest ⚠️ **จะได้ Tailwind v4 ซึ่งทำให้ `tailwind.config.js` ถูกเมิน** ตามที่บันทึกไว้ในเอกสาร design
- 4) Other (please specify): _______

**Answer**: 1) npx expo install nativewind@4.2.7 tailwindcss@3.4.19 (ระบุเวอร์ชันตรงตัว)

---

### D4-6: ชนิดของ test ที่จะรวมในงานนี้
**Question**: จะเพิ่ม test ไหม (D3-8 ตอบว่าไม่เพิ่ม — ถามซ้ำที่นี่เพราะเป็นจุดตัดสินระดับ task และเป็นโอกาสสุดท้ายที่จะเปลี่ยนใจ)
- 1) **ไม่เพิ่ม ตามมติ D3-8** — ยืนยันด้วย bundle ผ่าน + คนหน้างาน **(Recommended)**
- 2) **เพิ่ม smoke test** — เทสต์เดียวที่ยืนยันว่า `login.js` เรนเดอร์ได้ไม่ throw ราคาถูก จับกรณีแอพพังตอนบูตได้
- 3) **เพิ่ม snapshot test** — จับการเปลี่ยนแปลงของ tree ที่ render ออกมา แต่จะ fail ทันทีที่แปลง className ซึ่งเป็นสิ่งที่เราตั้งใจทำ จึงได้ประโยชน์น้อย
- 4) Other (please specify): _______

**Answer**: 1) ไม่เพิ่ม test ตามมติ D3-8

---

### D4-7: การทำงานขนาน
**Question**: จะรัน task แบบขนานไหม
- 1) **เรียงลำดับล้วน** — แต่ละ task พึ่งผลของ task ก่อนหน้า และงานทั้งหมดเล็กพอจนการขนานไม่ช่วย **(Recommended)**
- 2) **ขนานบางส่วน** — เช่น เขียน token คู่ไปกับการตั้ง config
- 3) Other (please specify): _______

**Answer**: 1) เรียงลำดับล้วน ไม่ทำงานขนาน

---

### D4-8: จังหวะการ commit
**Question**: จะ commit เมื่อไหร่
- 1) **commit ต่อ wave** — ได้จุดย้อนกลับที่มีความหมาย และ diff อ่านรู้เรื่อง **(Recommended)**
- 2) **commit ต่อ task** — ย้อนกลับได้ละเอียดที่สุด แต่จะมี commit ที่ตัวมันเองยังทำงานไม่ได้
- 3) **commit เดียวตอนจบ** — ประวัติสะอาด แต่ถ้าพังต้องย้อนทั้งหมด
- 4) Other (please specify): _______

**Answer**: 1) commit ต่อ wave

---

## Decisions Summary
<!-- Machine-readable compact summary. Downstream phases: read ONLY this section. -->
<!-- Auto-populated after user fills answers. One line per decision. -->
- D4-1 Breakdown: risk-ordered (toolchain before UI)
- D4-2 Granularity: single-concern, each task independently verifiable
- D4-3 Priority: toolchain → OTA proof → tokens → UI
- D4-4 Checkpoints: stop for user confirmation after every wave
- D4-5 Install: npx expo install with exact versions (nativewind@4.2.7, tailwindcss@3.4.19)
- D4-6 Tests: none added (per D3-8)
- D4-7 Parallelism: sequential only
- D4-8 Commits: one per wave

---

**Instructions**: เติมคำตอบในช่อง `**Answer**:` ด้านบน แล้วตอบว่า "done"

---

## Validation Notes — 2026-09-24T04:29:01Z

ตรวจกฎ D4 ทั้ง 11 ข้อ ติดหนึ่งข้อ

### 🔴 No Testing Strategy → **แก้ด้วยตัวเลือก 2 (Keep current, มีเหตุผลรองรับ)**

**เงื่อนไขที่ทำให้ติด**: D4-6 = ไม่เพิ่ม test + D3-7 = OTA เข้า production โดยตรง

**มติของผู้ใช้**: คงไว้ไม่เพิ่ม test โดยอ้างเหตุผลหลักคือ **ขอบเขตจำกัดอยู่ที่หน้าเดียว**

**เหตุผลรองรับครบชุด** (ต้องรักษาให้ครบทุกข้อ ไม่ใช่เลือกทำบางข้อ):
1. ขอบเขตจำกัดที่ `app/login.js` หน้าเดียว ไม่แตะ logic ไม่แตะ DB ไม่แตะ API
2. **wave แรกพิสูจน์ toolchain โดยยังไม่แตะ `login.js` เลย** (D4-3) — config ที่ผิดจะถูกจับตั้งแต่ตอน bundle ก่อนมีอะไรขึ้น production
3. เตรียมคำสั่ง `eas update:republish` ไว้ก่อนกด publish ทุกครั้ง (D3-7)
4. ส่งนอกช่วงเวลากิจกรรม — ตรวจจากตาราง `projects` ว่าไม่มีกิจกรรมที่ active
5. หยุดให้ผู้ใช้ยืนยันทุก wave (D4-4)

**ความเสี่ยงที่ยังเหลืออยู่และยอมรับแล้ว**: ไม่มี test อัตโนมัติจับกรณี babel/metro config ผิดจนแอพ crash ตอนบูต ตัวลดความเสี่ยงคือข้อ 2 ข้างบน ซึ่งทำให้กรณีนี้ถูกจับก่อนถึง production — **ข้อ 2 จึงเป็นเงื่อนไขบังคับ ไม่ใช่ลำดับที่สลับได้**
