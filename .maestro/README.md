# Maestro — เทสต์ UI อัตโนมัติบน SUNMI V3

Flow ในโฟลเดอร์นี้สั่งแอปบน**เครื่องจริง**ผ่าน USB ให้กดเหมือนคน แล้วตรวจสิ่งที่ขึ้นบนจอ
ครอบคลุมส่วนที่ Jest (`npm run test:ci`) ทดสอบไม่ได้ — หน้าจอ เครื่องพิมพ์จริง และการคุยกับ server จริง

| flow | ตรวจอะไร |
|---|---|
| `01_home` | เปิดแอปแล้วถึงหน้าหลัก ไม่มีแถบเตือน "ยังไม่ได้เชื่อมเครื่องพิมพ์" (SUNMI ใช้เครื่องพิมพ์ในตัว) |
| `02_printer_test` | ตั้งค่า → ทดสอบเครื่องพิมพ์ → ต้องขึ้น "พิมพ์ผ่านเครื่องพิมพ์ในตัว (SUNMI)" — **มีสลิปออกมา 1 ใบ** |
| `03_check_update` | ตั้งค่า → ตรวจหาอัปเดต → "เป็นเวอร์ชันล่าสุดแล้ว" (หรือดาวน์โหลดได้ถ้ามี OTA ใหม่) |
| `04_resync_c7` | ตั้งค่า → ดึงใบ C7 ใหม่ทั้งหมด → มีแค่ปุ่มยืนยัน ไม่ถามรหัส → "ดึงใบ C7 เสร็จแล้ว" และตัวเลขบนการ์ด "ใบ C7" เท่ากับจำนวนที่บันทึก |

ไม่ครอบคลุม: การสแกนด้วยกล้อง (Maestro ป้อนภาพเข้ากล้องไม่ได้), การล็อกอิน (flow ไม่ใส่รหัสผ่าน)

## ก่อนรัน

1. **ติดตั้ง Maestro** (ใช้ Homebrew ไม่ได้บน Mac เครื่องนี้ เพราะ Xcode 16.2 เก่าเกิน Homebrew ปฏิเสธทุกอย่าง)
   ```bash
   mkdir -p ~/.maestro && cd ~/.maestro
   curl -L -o maestro.zip https://github.com/mobile-dev-inc/Maestro/releases/download/cli-2.12.1/maestro.zip
   unzip -q maestro.zip && rm maestro.zip
   export PATH="$HOME/.maestro/maestro/bin:$PATH"
   ```
   ต้องมี Java 17 (มีอยู่แล้ว: zulu-17) และพื้นที่ว่างราว 400 MB
2. **เสียบ SUNMI** เปิด USB debugging แล้ว `adb devices` ต้องเห็นเครื่อง
3. **ติดตั้งแอปตัวทดสอบ** (`com.donnytang.myapp.dev`) — ไม่ทับแอปตัวจริงและข้อมูลในเครื่อง
   ```bash
   cd android && rm -rf app/build/generated/assets/createReleaseUpdatesResources app/build/intermediates/assets/release/app.manifest
   ./gradlew :app:assembleRelease -Pmbus.appIdSuffix=.dev
   adb install -r app/build/outputs/apk/release/app-release.apk
   ```
4. **ล็อกอินในแอปตัวทดสอบด้วยมือหนึ่งครั้ง** และตั้ง Environment เป็น **Test** — flow ไม่ล็อกอินให้ และจะไม่ล้าง session
5. ใส่กระดาษในเครื่องพิมพ์ และต่อ wifi ที่ออกเน็ตได้

## รัน

```bash
export PATH="$HOME/.maestro/maestro/bin:$PATH"
maestro test .maestro                       # ทุก flow ตามลำดับใน config.yaml
maestro test .maestro/02_printer_test.yaml  # flow เดียว
maestro test .maestro --test-output-dir /tmp/maestro-out   # เก็บภาพหน้าจอผลลัพธ์ไว้ดู
```

รันกับแอปตัวจริงแทน: `maestro test -e APP_ID=com.donnytang.myapp .maestro` — **ระวัง** flow 02 พิมพ์สลิปจริง และ flow 04 ดึงใบ C7 ของ environment ที่ตั้งไว้ในเครื่อง

## ข้อควรรู้

- **แท็บด้านล่างไม่มีข้อความ** flow จึงแตะตามตำแหน่ง (`subflows/open_settings.yaml`, 83% / 91% ของจอ) ถ้าเปลี่ยนจำนวนหรือลำดับแท็บ ต้องแก้ตรงนั้น
- กล่อง Alert ของ Android ใช้ปุ่ม `OK` ที่ระบบใส่ให้เมื่อโค้ดไม่ได้กำหนดปุ่มเอง
- flow 03 และ 04 ต้องคุยกับ server จริง — ถ้า `mbus-test.dhammakaya.network` ล่มหรือเน็ตใช้ไม่ได้ จะขึ้น "ดึงใบ C7 ไม่สำเร็จ / Network Error" และ flow ล้ม ซึ่งเป็นผลที่ถูกต้อง (แอปแจ้ง error ได้ชัด) แต่ไม่ใช่การยืนยันว่าดึงสำเร็จ
- **build บน Mac ต้องมี header `expo-channel-name`** ใน AndroidManifest (`UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY`) ไม่งั้นปุ่มตรวจหาอัปเดตขึ้น "ตรวจหาอัปเดตไม่สำเร็จ" เพราะ server ของ Expo ตอบว่าขาด channel — EAS ใส่ให้เองตอน build แต่ build บน Mac ไม่ได้ใส่ จนกว่าจะเพิ่มไว้ในไฟล์
