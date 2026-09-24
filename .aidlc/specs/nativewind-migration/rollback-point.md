# Rollback Point — production

> สร้างโดย task 1.2 · ต้องมีอยู่ในมือก่อนกด publish ที่ task 3.1 และ 6.2
> **ไม่ใช่เอกสารอ้างอิงเฉยๆ — เป็นเงื่อนไขบังคับของ D3-7**

## สถานะ production ณ ตอนเริ่มงาน (2026-09-24)

| | |
|---|---|
| Branch | `production` (ID `535e08ca-cf89-4e87-9e7a-568652d0b086`) |
| Runtime version | 1.0.0 |
| Platforms | android, ios |
| **Group ID ปัจจุบัน** | **`55bbdb85-98b0-42e7-b437-a4ef5f1854c1`** |
| Message | "Add a settings screen listing registered vehicles not yet scanned, with contact info" |
| เผยแพร่เมื่อ | 3 วันก่อน (2026-09-21) โดย `tackpongsatorn` |
| ตรงกับ commit | `87a1481` — ฟีเจอร์ "รถที่เหลือ" |

## คำสั่งย้อนกลับ

```bash
npx eas update:republish --group 55bbdb85-98b0-42e7-b437-a4ef5f1854c1
```

คำสั่งนี้จะถามข้อความกำกับแบบ interactive และเติมค่าเริ่มต้นมาให้ — **กด Enter เพื่อรับค่านั้นได้เลย**

## ⚠️ ข้อค้นพบสำคัญ: การย้อนกลับครั้งก่อนไม่ได้เกิดขึ้นจริง

ก่อนหน้านี้ในเซสชันเดียวกัน มีการเริ่มรัน `eas update:republish --group 764f0a8f-...` เพื่อย้อนกลับไปก่อนฟีเจอร์ "รถที่เหลือ" แต่คำสั่งค้างอยู่ที่ prompt ถามข้อความกำกับ **และไม่เคยถูกรันจนจบ**

ยืนยันจาก `eas update:list`: ยอดของ branch `production` ยังเป็น `55bbdb85` ไม่ใช่ `764f0a8f` ที่ควรจะโผล่ขึ้นมาเป็นตัวล่าสุดถ้า republish สำเร็จ

**ผลที่ตามมา**
- ฟีเจอร์ "รถที่เหลือ" **ยังทำงานอยู่บนแท็บเล็ตทุกเครื่อง** ตามที่ deploy ไปเมื่อ 3 วันก่อน
- จุดย้อนกลับของงาน `nativewind-migration` จึงเป็น `55bbdb85` ไม่ใช่ `764f0a8f`
- ถ้ายังต้องการถอนฟีเจอร์ "รถที่เหลือ" ออกจริง นั่นเป็นงานแยกต่างหาก **ไม่ใช่ส่วนหนึ่งของงานนี้** และต้องตัดสินใจก่อนเริ่ม phase 3 เพราะจะเปลี่ยนว่าจุดย้อนกลับคือตัวไหน

## ขั้นตอนบังคับก่อน publish ทุกครั้ง

1. รัน `eas update:list --branch production --limit 1` เพื่อ**อ่าน Group ID ล่าสุด ณ ตอนนั้น** — อย่าใช้ค่าในเอกสารนี้ถ้ามีการ publish อื่นคั่นกลาง
2. ยืนยันเงื่อนไขของ task 1.3 ซ้ำ (ไม่มีกิจกรรมที่ active อยู่)
3. เตรียมคำสั่ง republish ไว้ในหน้าต่างที่พร้อมกด
4. จึง publish

---

## อัปเดต — หลัง task 3.1 (2026-09-24)

publish ขึ้น production แล้วด้วย group **`70ce04e7-3b6a-4d2d-89ff-d38364636626`**
(message: "NativeWind toolchain only, no visual change", commit `87eeb0e`)

**จุดย้อนกลับยังเป็น `55bbdb85` เหมือนเดิม** — คือสถานะก่อนหน้าที่ยังไม่มี NativeWind

```bash
npx eas update:republish --group 55bbdb85-98b0-42e7-b437-a4ef5f1854c1
```

ใช้คำสั่งนี้ถ้า task 3.2 พบว่าแอพเปิดไม่ขึ้นหรือทำงานผิดปกติ
