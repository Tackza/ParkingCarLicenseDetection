# External Resources

## Design Resources
- **Design tool**: none — ไม่มี Figma/Sketch ทั้ง UI ปัจจุบันเกิดจากการเขียน style ตรงในโค้ด
- **Design system docs**: none — ยังไม่มี design token หรือ palette ที่เป็นทางการ (งาน `nativewind-migration` จะสร้างขึ้นเป็นครั้งแรก)
- **Wireframes/mockups**: none
- **Palette ที่ใช้จริงในโค้ด** (สกัดจาก hex ที่ปรากฏบ่อยสุด — ใช้เป็นฐานของ `tailwind.config.js`):

| Hex | ใช้ | บทบาทที่สังเกตได้ |
|---|---|---|
| `#3498db` | 39 | น้ำเงินหลัก — ปุ่ม, ไอคอน active |
| `#f8f9fa` | 26 | พื้นหลังหน้าจอ / การ์ด |
| `#2c3e50` | 24 | ตัวอักษรเข้ม |
| `#7f8c8d` | 23 | ตัวอักษรจาง / label |
| `#e9ecef` | 21 | เส้นขอบ / เส้นคั่น |
| `#e67e22` | — | ส้มเตือน (ใช้ในรายการ "รถที่เหลือ") |
| `#27ae60` | — | เขียวสำเร็จ (ปุ่มโทร) |
| `#f39c12` | — | ส้มของโหมดสอง (ธรรมยาตรา) |
| `#fff` / `#000` | 98 / 29 | ขาว-ดำ |

## API Resources
- **OpenAPI/Swagger spec**: none — ไม่มี spec เป็นเอกสาร
- **GraphQL schema**: none
- **Existing API docs**: none — สัญญา API ทราบจากโค้ดที่เรียกใช้เท่านั้น (`/lpr/login`, `/lpr/projects`, `/lpr/registers`, `/lpr/checkins`, `/lpr/checkins/search`, `/lpr/checkins/print-slip`)
- **หมายเหตุ**: backend อยู่คนละรีโป (`mbus_payee`) ไม่ได้อยู่ในขอบเขตงานนี้

## Knowledge Resources
- **Documentation**: `CLAUDE.md` ที่ root — เอกสารสถาปัตยกรรมหลัก ดูแลต่อเนื่อง ครอบคลุม sync loop, การพิมพ์, migration, dead code และข้อควรระวัง
- **Internal wiki**: none
- **Reference implementations**:
  - `.claude/skills/ui-ux-pro-max/data/stacks/react-native.csv` — แนวทาง UI/UX เฉพาะ React Native 51 ข้อ
  - `.claude/skills/ui-ux-pro-max/data/styles.csv` / `typography.csv` / `icons.csv` — style, font pairing, ชุดไอคอน (มีหมวด Mobile แยก)
- **เอกสารภายนอกที่ต้องใช้ในเฟส design**: NativeWind v4 (การตั้งค่ากับ Expo SDK 51), Tailwind CSS config reference

## Available Tools
- [x] Web search — ใช้ยืนยันความเข้ากันของ NativeWind v4 กับ Expo SDK 51 / RN 0.74
- [ ] Design tool MCP server — ไม่มี
- [x] EAS CLI — login เป็น `tackpongsatorn` แล้ว ใช้ `eas update` ได้
- [x] iOS Simulator MCP — มีในเซสชัน แต่แอพเป็น Android-first ใช้ได้จำกัด
- [x] Built-in browser — ใช้เปิดเอกสารได้

## Notes
- **ไม่มีอุปกรณ์ Android ต่ออยู่กับเครื่องพัฒนา** — การยืนยันผลด้วยตาต้องทำผ่านการ build/OTA แล้วให้คนที่หน้างานดู หรือหาแท็บเล็ตมาต่อ
- แอพ**รันอยู่จริงที่จุดตรวจ** ของที่ deploy ต้องปลอดภัย; ย้อนกลับด้วย `eas update:republish --group <id>`
- ไม่มี test suite — การยืนยันผลของงาน refactor นี้ต้องอาศัยการเทียบด้วยตาเป็นหลัก
