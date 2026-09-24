# Baseline — `app/login.js` style ก่อนแปลง

> สร้างโดย task 1.1 · ใช้เทียบที่ task 6.1 · **นี่คือ "ความจริง" ที่ใช้แทน test** เพราะ D4-6 เลือกไม่เพิ่ม test
> อ้างอิงจาก `app/login.js` ณ commit `2f78e2f`

## ข้อค้นพบ

มี **13 style key** ถูกนิยามไว้ แต่ใช้จริงใน JSX เพียง **12 ตัว**

- **`subtitle` ไม่ถูกอ้างถึงที่ไหนเลย** — เป็น dead style
  - หน้า login มี `<Text style={styles.title}>` สองครั้ง (อีโมจิรถ และ "ระบบลงทะเบียนรถ") ไม่มีที่ไหนใช้ `subtitle`
  - **ข้อเสนอ**: ไม่ต้องแปลง ให้ลบทิ้งไปพร้อม `StyleSheet.create` ที่ task 5.3 — ถ้าแปลงมันจะเป็นการย้าย dead code ข้ามระบบเปล่าๆ
  - ต้องได้รับการยืนยันก่อน เพราะเป็นการลบของที่ไม่ได้อยู่ในแผนเดิม

## ตารางอ้างอิง

| # | Key | ค่าปัจจุบัน | className ที่เสนอ | ตรงเป๊ะ? |
|---|---|---|---|---|
| 1 | `container` | `flex: 1`<br>`backgroundColor: '#f8f9fa'` | `flex-1 bg-background` | ✅ |
| 2 | `loadingContainer` | `flex: 1`<br>`justifyContent: 'center'`<br>`alignItems: 'center'`<br>`backgroundColor: '#f8f9fa'` | `flex-1 justify-center items-center bg-background` | ✅ |
| 3 | `content` | `flex: 1`<br>`justifyContent: 'center'`<br>`paddingHorizontal: 30` | `flex-1 justify-center px-[30px]` | ✅ arbitrary |
| 4 | `logoContainer` | `alignItems: 'center'`<br>`marginBottom: 20` | `items-center mb-5` | ✅ 20px = `mb-5` |
| 5 | `title` | `fontSize: 26`<br>`fontWeight: 'bold'`<br>`color: '#2c3e50'`<br>`marginBottom: 1` | `text-[26px] font-bold text-text mb-px` | ✅ arbitrary |
| 6 | `subtitle` | `fontSize: 16`<br>`fontWeight: 'bold'`<br>`color: '#7f8c8d'` | *(ไม่แปลง — dead style)* | — |
| 7 | `formContainer` | `backgroundColor: '#fff'`<br>`borderRadius: 20`<br>`padding: 25`<br>`shadowColor: '#000'`<br>`shadowOffset: {0, 2}`<br>`shadowOpacity: 0.1`<br>`shadowRadius: 8`<br>`elevation: 5` | `bg-surface rounded-[20px] p-[25px]` + **เงาแยก** | ⚠️ ดูด้านล่าง |
| 8 | `inputContainer` | `marginBottom: 20` | `mb-5` | ✅ |
| 9 | `label` | `fontSize: 14`<br>`fontWeight: '600'`<br>`color: '#2c3e50'`<br>`marginBottom: 8` | `text-sm font-semibold text-text mb-2` | ✅ 14px, 8px ตรง scale |
| 10 | `input` | `backgroundColor: '#f8f9fa'`<br>`borderRadius: 12`<br>`padding: 15`<br>`fontSize: 16`<br>`borderWidth: 1`<br>`borderColor: '#e9ecef'` | `bg-input rounded-xl p-[15px] text-base border border-border` | ✅ 12px = `rounded-xl` |
| 11 | `loginButton` | `backgroundColor: '#3498db'`<br>`borderRadius: 12`<br>`padding: 16`<br>`alignItems: 'center'`<br>`marginTop: 10` | `bg-primary rounded-xl p-4 items-center mt-2.5` | ✅ 16px = `p-4`, 10px = `mt-2.5` |
| 12 | `loginButtonDisabled` | `backgroundColor: '#95a5a6'` | `bg-primary-muted` | ✅ |
| 13 | `loginButtonText` | `color: '#fff'`<br>`fontSize: 16`<br>`fontWeight: '600'` | `text-surface text-base font-semibold` | ✅ |

## ⚠️ เงาของ `formContainer` — ความเสี่ยงที่ระบุไว้ตั้งแต่ design

ค่าปัจจุบันคือเงาแบบ RN ล้วน ซึ่ง**ไม่มี utility ของ Tailwind ตัวไหน map ตรง**:

```
shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
shadowOpacity: 0.1, shadowRadius: 8, elevation: 5
```

`shadow-md` ของ Tailwind ให้ค่าคนละชุด และ `elevation` เป็นของ Android โดยเฉพาะซึ่ง NativeWind ไม่ได้ครอบคลุมด้วย utility มาตรฐาน

**แผนตาม design (task 5.2)**: ใช้ `style={{...}}` inline เฉพาะ 5 property นี้ ซึ่งยังถือว่าทำตาม D3-5 เพราะ `StyleSheet.create` ถูกลบแล้วจริง

## ชื่อ token ที่ต้องมีใน `tailwind.config.js` (task 4.1)

จากตารางข้างบน หน้า login ใช้ token เหล่านี้เท่านั้น:

| Token | Hex | ใช้ที่ |
|---|---|---|
| `background` | `#f8f9fa` | container, loadingContainer |
| `input` | `#f8f9fa` | input *(alias ของ background ตาม design)* |
| `surface` | `#ffffff` | formContainer, loginButtonText |
| `text` | `#2c3e50` | title, label |
| `border` | `#e9ecef` | input |
| `primary` | `#3498db` | loginButton |
| `primary-muted` | `#95a5a6` | loginButtonDisabled |

ส่วน `muted` (`#7f8c8d`), `warning`, `success`, `accent` **ยังไม่ต้องใส่ในรอบนี้** — หน้า login ไม่ได้ใช้ (ตัวเดียวที่จะใช้คือ `subtitle` ซึ่งเป็น dead style)

### ข้อสังเกตเรื่องชื่อ token

ชื่อ `text` ทำให้ได้ class ว่า `text-text` ซึ่งอ่านแล้วสะดุด ชื่อที่นิยมกว่าคือ `foreground` (`text-foreground`) แต่ **เอกสาร design ระบุชื่อ `text` ไว้แล้ว** ผมจึงคงตามนั้นในตารางนี้ ไม่เปลี่ยนเอง — ถ้าจะเปลี่ยนต้องแก้ที่ `design.md` ด้วยเพื่อไม่ให้เอกสารขัดกัน

## เกณฑ์ผ่านของ task 6.1

- ทุกแถวที่ 1–5 และ 7–13 ต้องให้ผลลัพธ์เท่าค่าเดิมทุก property
- แถวที่ 6 (`subtitle`) ต้องหายไปจากไฟล์ ไม่ใช่ถูกแปลง
- เงาของ `formContainer` ต้องดูเหมือนเดิมด้วยตา
