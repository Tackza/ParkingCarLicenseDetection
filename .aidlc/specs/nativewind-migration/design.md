# Design — nativewind-migration

## Summary
- **Architecture**: ไม่เปลี่ยนสถาปัตยกรรมแอพ — เพิ่มชั้น build-time (babel + metro) ที่แปลง utility class เป็น RN style object
- **Stack**: NativeWind 4.2.7 + Tailwind CSS 3.4.19 บน Expo SDK 51.0.5 / React Native 0.74.1
- **Components**: 8 (ไฟล์ config ใหม่ 3, แก้ไข 5)
- **Entities**: 0 — ไม่แตะฐานข้อมูล
- **Endpoints**: 0 — ไม่แตะ API
- **Operations**: Skipped (scope `refactor`)
- **PBT Properties**: Skipped (D3-8)
- **Testing Strategy**: ไม่เพิ่ม test ใหม่ (D3-8) — เกณฑ์ยืนยันอยู่ในหัวข้อ Testing Strategy ด้านล่าง
- **NFR**: Skipped

## Version Map

| Package | Version | หมายเหตุ |
|---|---|---|
| `nativewind` | **4.2.7** | ตัวล่าสุดของสาย v4 ตาม D3-1 |
| `tailwindcss` | **3.4.19** | ⚠️ **ต้อง pin `^3.4.19` ห้ามปล่อยตาม latest** |

**กับดักที่ต้องระวัง**: `nativewind@4.2.7` ประกาศ `peerDependencies: { "tailwindcss": ">3.3.0" }` ซึ่ง**เปิดรับ Tailwind CSS 4.x ได้** แต่ Tailwind v4 (ปัจจุบัน 4.3.3) เขียนใหม่ทั้งหมด เปลี่ยนไปใช้ CSS-first config และ**ไม่ใช้ `tailwind.config.js` เป็นค่าเริ่มต้น** ซึ่งขัดกับ D3-3 โดยตรง ถ้าติดตั้งด้วย `npm i tailwindcss` เฉยๆ จะได้ v4 มาแล้ว config ที่เราเขียนจะถูกเมิน — ต้องระบุเวอร์ชันชัดเจนตอนติดตั้ง

*(resolved จาก npm registry ณ 2026-09-24 — ไม่ใช่ความจำ)*

## Architecture

**Pattern**: Build-time style compilation — ไม่มี runtime layer ใหม่ ไม่มี native module

```
                 เดิม                                  หลังแปลง
   ┌──────────────────────────┐          ┌──────────────────────────────┐
   │ login.js                 │          │ login.js                     │
   │   style={styles.input}   │          │   className="bg-background…" │
   │   StyleSheet.create({…}) │          │   (ไม่มี StyleSheet)          │
   └───────────┬──────────────┘          └───────────┬──────────────────┘
               │                                      │
               │                          ┌───────────▼──────────────────┐
               │                          │ babel: nativewind/babel      │
               │                          │ metro: withNativeWind        │
               │                          │   อ่าน tailwind.config.js    │
               │                          └───────────┬──────────────────┘
               ▼                                      ▼
        RN style object                        RN style object
               │                                      │
               └──────────────► React Native ◄────────┘
```

**เหตุผลที่เลือกแบบนี้** (D3-1): NativeWind v4 ทำงานที่ babel + metro เท่านั้น ไม่มี native module ผลลัพธ์จึงยังเป็น JS bundle — **คาดว่าส่งผ่าน OTA ได้ แต่ยังไม่พิสูจน์** ข้อนี้เป็นสมมติฐานที่ต้องยืนยันเป็นอย่างแรกในเฟส implement ถ้าผิด ต้อง build APK ใหม่และแผน deploy ทั้งหมดเปลี่ยน

## Components

| # | Component | ชนิด | หน้าที่ |
|---|---|---|---|
| C1 | `tailwind.config.js` | ใหม่ | นิยาม semantic token ทั้งหมด (D3-2, D3-3) + ระบุ `content` ให้ครอบคลุม `app/` และ `components/` |
| C2 | `global.css` | ใหม่ | directive ของ Tailwind (`@tailwind base/components/utilities`) |
| C3 | `nativewind-env.d.ts` | ใหม่ | type ของ prop `className` (D3-9) |
| C4 | `babel.config.js` | แก้ไข | เพิ่ม `jsxImportSource: "nativewind"` ให้ `babel-preset-expo` และเพิ่ม preset `nativewind/babel` |
| C5 | `metro.config.js` | แก้ไข | ห่อ config ด้วย `withNativeWind(config, { input: "./global.css" })` |
| C6 | `app/_layout.tsx` | แก้ไข | `import "../global.css"` — จุดที่ CSS เข้าสู่ระบบ **ไฟล์นี้เดิมไม่อยู่ในรายการผลกระทบตอน context ต้องเพิ่ม** |
| C7 | `app/login.js` | แก้ไข | เป้าหมาย pilot — แปลง 13 style key เป็น `className` แล้วลบ `StyleSheet.create` (D3-4, D3-5) |
| C8 | `package.json` | แก้ไข | เพิ่ม `nativewind@4.2.7`, `tailwindcss@^3.4.19` |

## Design Tokens (C1)

สกัดจาก hex ที่ใช้จริงในโค้ด ตาม D3-2 — **ค่าสีที่แสดงผลต้องเท่าเดิมทุกตัว**

| Token | Hex | บทบาทที่พบในโค้ด | ใช้ใน login.js |
|---|---|---|---|
| `primary` | `#3498db` | ปุ่มหลัก, ไอคอน active (39 จุดทั้งแอพ) | ปุ่มเข้าสู่ระบบ, spinner |
| `primary-muted` | `#95a5a6` | ปุ่มตอน disabled | ปุ่มตอนกำลังโหลด |
| `background` | `#f8f9fa` | พื้นหลังหน้าจอ **และ** พื้นหลังช่องกรอก | container, input |
| `surface` | `#ffffff` | พื้นการ์ด | กล่องฟอร์ม |
| `text` | `#2c3e50` | ตัวอักษรหลัก | หัวเรื่อง, label |
| `text-muted` | `#7f8c8d` | ตัวอักษรรอง | subtitle |
| `border` | `#e9ecef` | เส้นขอบ, เส้นคั่น | ขอบช่องกรอก |
| `warning` | `#e67e22` | เตือน | *(ยังไม่ใช้ในหน้านี้)* |
| `success` | `#27ae60` | สำเร็จ | *(ยังไม่ใช้ในหน้านี้)* |
| `accent` | `#f39c12` | สีของโหมดสอง (ธรรมยาตรา) | *(ยังไม่ใช้ในหน้านี้)* |

**ข้อสังเกตที่ต้องตัดสินตอน implement**: `#f8f9fa` ทำหน้าที่สองอย่าง — เป็นทั้งพื้นหลังหน้าจอและพื้นหลังช่องกรอก ในระบบ semantic ควรเป็นคนละ token (`background` กับ `input`) แม้ค่าจะเท่ากัน เพื่อให้แก้แยกกันได้ทีหลัง แต่จะทำให้ token เยอะขึ้น — ตั้ง `input` เป็น alias ของ `background` ไปก่อน

Token ที่ใส่ใน C1 ครอบคลุมทั้งแอพ ไม่ใช่แค่หน้า login เพราะไฟล์นี้จะถูกใช้ต่อในการแปลงหน้าอื่น ส่วนสีที่เหลือจาก 54 ตัว (เฉดที่ใช้ครั้งเดียว) จะทยอยเพิ่มเมื่อแปลงหน้านั้นๆ **ไม่ต้องใส่ครบ 54 ตัวในรอบนี้**

## Data Model
ไม่มี — งานนี้ไม่แตะ schema, migration หรือ query ใดๆ `PRAGMA user_version` คงที่ที่ v8

## API Specification
ไม่มี — งานนี้ไม่แตะ endpoint หรือ payload ใดๆ

## Integration Points
ไม่มีจุดเชื่อมต่อใหม่ **แต่มีจุดที่ต้องไม่กระทบ**:

| ระบบ | เหตุที่ต้องระวัง |
|---|---|
| เครื่องพิมพ์ ESC/POS | `Receipt.js` ถูก `captureRef` เป็นภาพไปพิมพ์ — **ห้ามแตะในรอบนี้** และห้ามให้ global.css ไปเปลี่ยน default style ของ `View`/`Text` |
| sync loop ทั้งสอง | ไม่เกี่ยวกับ style แต่ถ้า babel config ผิดจนแอพ crash ตอนบูต จะพาลทำให้คิวค้างส่ง |

## Implementation

**โครงไฟล์หลังทำเสร็จ**
```
tailwind.config.js        ← ใหม่ (C1)
global.css                ← ใหม่ (C2)
nativewind-env.d.ts       ← ใหม่ (C3)
babel.config.js           ← แก้ (C4)
metro.config.js           ← แก้ (C5)
app/_layout.tsx           ← แก้ (C6) import "../global.css"
app/login.js              ← แก้ (C7) เป้าหมาย pilot
package.json              ← แก้ (C8)
```

**ลำดับที่ต้องทำ** (เหตุผล: ต้องพิสูจน์ว่า toolchain รอดก่อนจะลงแรงแปลง UI)
1. ติดตั้ง dependency ด้วยเวอร์ชันที่ pin ไว้
2. ตั้งค่า C4, C5, C2, C6 แล้ว**รัน bundle ให้ผ่านก่อน โดยยังไม่แตะ login.js เลย** — ถ้าพังตรงนี้คือ toolchain ไม่ใช่โค้ด UI แยกปัญหาได้ชัด
3. เขียน C1 (token) และ C3
4. แปลง C7 ทีละ style key
5. ลบ `StyleSheet.create` ออกจาก login.js (D3-5)

**Convention ที่ต้องรักษา**
- คอมเมนต์ในไฟล์ที่แก้เป็นภาษาไทยตามของเดิม
- **ห้ามแปลงไฟล์เป็น TypeScript** — `login.js` ต้องยังเป็น `.js`
- ค่าที่ไม่มีใน Tailwind scale ใช้ arbitrary value เช่น `text-[26px]`, `rounded-[20px]` ดีกว่าปัดให้เข้า scale เพราะ scope คือ "หน้าตาต้องไม่เปลี่ยน"

**ความเสี่ยงทางเทคนิคที่ระบุได้ล่วงหน้า**

| ความเสี่ยง | ผลกระทบ | ทางรับมือ |
|---|---|---|
| **เงา (shadow) ของกล่องฟอร์ม** — `shadowColor/Offset/Opacity/Radius` + `elevation: 5` ไม่ได้ map ตรงกับ `shadow-*` ของ Tailwind | กล่องฟอร์มดูต่างจากเดิม | ใช้ `style={{...}}` inline เฉพาะเงา (ยังถือว่าลบ `StyleSheet.create` ได้ตาม D3-5) หรือ arbitrary value ถ้าทำได้ — **ตัดสินตอนเห็นผลจริง** |
| **OTA ใช้ไม่ได้** | แผน deploy ทั้งหมดเปลี่ยน ต้อง build APK | ทดสอบ `eas update` เป็นขั้นแรกหลัง config ผ่าน ก่อนลงแรงแปลง UI |
| **build ช้าบน Android** (มีกระทู้รายงานกับ NativeWind v4 + Expo Router บน SDK 51) | เสียเวลา ไม่ใช่ของพัง | เฝ้าดู ถ้าช้าจริงค่อยหา workaround |
| **`global.css` ไปเปลี่ยน default style ทั้งแอพ** | กระทบหน้าที่ยังไม่แปลง รวมถึงสลิปที่พิมพ์ | ใส่เฉพาะ `@tailwind` directive ห้ามเขียน base style เอง |

## Testing Strategy

D3-8 เลือก **ไม่เพิ่ม test** — โปรเจกต์ไม่มี test ที่ครอบคลุมโค้ดจริงอยู่แล้ว และ refactor นี้ไม่แตะ logic การเพิ่ม snapshot test ให้หน้าเดียวจึงให้ความมั่นใจน้อยกว่าต้นทุน

**เกณฑ์ยืนยันแทน** (D3-6 หลัง validation)

| ขั้น | เกณฑ์ | ใครทำ |
|---|---|---|
| 1 | `npx expo export` หรือ bundle ผ่านโดยไม่มี error | ผม |
| 2 | ตรวจ diff ว่าไม่มีไฟล์อื่นถูกแตะนอกเหนือจาก C1–C8 | ผม |
| 3 | `eas update` สำเร็จ และแอพเปิดขึ้นได้ไม่ crash | ผม + คนหน้างาน |
| 4 | หน้า login หน้าตาเหมือนเดิม กรอกและกดเข้าสู่ระบบได้จริง | **คนที่หน้างานหนึ่งเครื่อง** |

**ช่องโหว่ที่ยอมรับแล้ว**: ไม่มีใครเห็นหน้าจอใหม่ก่อนมันขึ้น production (Conflict 2 → ตัวเลือก 3) ตัวกันความเสี่ยงจึงเหลือสองอย่างและ**ทั้งคู่บังคับ**:
- เตรียมคำสั่ง `eas update:republish --group <id ปัจจุบัน>` ไว้ก่อนกด publish
- ส่ง**นอกช่วงเวลากิจกรรม** — ดูจากตาราง `projects` ว่าไม่มีกิจกรรมที่ active อยู่

## Traceability

โปรเจกต์นี้ scope เป็น `refactor` จึง**ข้ามเฟส requirements** ไม่มี `US-*` ให้ map ตาราง traceability จึงอ้างกับมติ D3 แทน ตามที่ scope กำหนด

| มติ | Component | สถานะ |
|---|---|---|
| D3-1 NativeWind v4 | C8 (pin 4.2.7) | ✅ |
| D3-2 semantic token | C1 | ✅ |
| D3-3 token ใน config เดียว | C1 | ✅ |
| D3-4 แปลงทั้งไฟล์ | C7 | ✅ |
| D3-5 ลบ StyleSheet ใน commit เดียวกัน | C7 | ✅ |
| D3-6 เกณฑ์ยืนยัน | Testing Strategy | ✅ |
| D3-7 OTA เข้า production + rollback | Testing Strategy ขั้น 3–4 | ✅ |
| D3-8 ไม่เพิ่ม test | Testing Strategy | ✅ |
| D3-9 nativewind-env.d.ts | C3 | ✅ |
| D3-10 ไม่ทำ dark mode | — | ✅ ไม่มี component |

**Coverage**: 10/10 มติถูกนำไปออกแบบครบ

**Component ที่ไม่ผูกกับมติใด** (มีเหตุผลรองรับ):
- **C2 `global.css`** และ **C6 `app/_layout.tsx`** — เป็นข้อบังคับทางเทคนิคของ NativeWind v4 ไม่ใช่ทางเลือก **C6 เป็นไฟล์ที่ไม่ได้ระบุไว้ในตารางผลกระทบตอนเฟส context** ถือเป็นส่วนขยายของขอบเขตที่เกิดจากการออกแบบ และบันทึกไว้ตรงนี้เพื่อให้เห็นชัด

## External References

| Source | Type | ใช้ทำอะไร |
|---|---|---|
| [NativeWind Installation](https://www.nativewind.dev/docs/getting-started/installation) | Documentation | ขั้นตอนตั้งค่า babel/metro/global.css |
| [nativewind/nativewind#947](https://github.com/nativewind/nativewind/discussions/947) | Issue | รายงานปัญหา build ช้าบน Android กับ Expo Router SDK 51 |
| [Expo SDK 51 changelog](https://expo.dev/changelog/2024-05-07-sdk-51) | Documentation | ยืนยันว่า SDK 51 มากับ RN 0.74 |
| npm registry (`nativewind`, `tailwindcss`) | Package registry | resolve เวอร์ชันจริงและอ่าน peerDependencies |
| `.claude/skills/ui-ux-pro-max/data/stacks/react-native.csv` | Design guideline | แนวทาง RN 51 ข้อ — ตรวจแล้วไม่มีข้อไหนขัดกับการออกแบบนี้ |
