// tailwind.config.js
//
// ไฟล์นี้ต้องมีอยู่ ไม่งั้น metro.config.js โหลดไม่ผ่านเลย — withNativeWind เรียก
// tailwind.config ทันทีตอนโหลด ไม่ได้รอถึงตอน build (ดู nativewind/dist/metro/index.js)
//
// semantic token ถูกเติมที่ task 4.1 หลังพิสูจน์แล้วว่า toolchain และ OTA ใช้งานได้จริง
// (update group 70ce04e7 — แท็บเล็ตหน้างานรับ update แล้วทำงานปกติ)

/** @type {import('tailwindcss').Config} */
module.exports = {
  // preset ของ NativeWind ปรับ scale และ utility ให้ตรงกับที่ React Native รองรับ
  // (RN ไม่มี CSS ครบเหมือนเว็บ เช่นไม่มี cascade ไม่มี pseudo-element)
  presets: [require('nativewind/preset')],

  // ต้องครอบคลุมทุกที่ที่เขียน className ไม่งั้น class จะถูก purge ทิ้งตอน build
  // components/ ยังไม่มีไฟล์ไหนใช้ แต่ใส่ไว้ล่วงหน้าสำหรับการแปลงหน้าอื่นในอนาคต
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
  ],

  theme: {
    // ใช้ extend ไม่ใช่แทนที่ทั้งก้อน — สีมาตรฐานของ Tailwind (white, black, ฯลฯ)
    // ยังใช้ได้อยู่ ถ้าเขียนทับจะหายหมดและ utility ที่พึ่งมันจะพังเงียบๆ
    extend: {
      // 🎨 Semantic token — ตั้งชื่อตาม "บทบาท" ไม่ใช่ตามค่าสี
      //
      // ค่าทุกตัวสกัดมาจาก hex ที่ใช้อยู่จริงในโค้ด ไม่ได้เลือกใหม่
      // scope ของงานนี้คือ refactor — หน้าตาที่ผู้ใช้เห็นต้องไม่เปลี่ยนแม้แต่พิกเซลเดียว
      // เทียบได้กับตารางใน .aidlc/specs/nativewind-migration/baseline-login-styles.md
      colors: {
        // ── ใช้ในหน้า login แล้ว (wave 5) ──
        primary: '#3498db',          // ปุ่มหลัก, ไอคอน active — สีที่ใช้บ่อยที่สุดในแอพ (39 จุด)
        'primary-muted': '#95a5a6',  // ปุ่มตอน disabled
        background: '#f8f9fa',       // พื้นหลังหน้าจอ
        input: '#f8f9fa',            // พื้นหลังช่องกรอก — ค่าเท่า background แต่แยก token ไว้
                                     // เพื่อให้เปลี่ยนสีช่องกรอกทีหลังได้โดยไม่กระทบพื้นหลังทั้งจอ
        surface: '#ffffff',          // พื้นการ์ด
        text: '#2c3e50',             // ตัวอักษรหลัก
        border: '#e9ecef',           // เส้นขอบ, เส้นคั่น

        // ── ยังไม่มีใครใช้ ใส่ไว้ให้การแปลงหน้าอื่นหยิบไปใช้ได้เลย ──
        'text-muted': '#7f8c8d',     // ตัวอักษรรอง, label จาง
        warning: '#e67e22',          // เตือน (ใช้ในรายการ "รถที่เหลือ")
        success: '#27ae60',          // สำเร็จ (ปุ่มโทร)
        accent: '#f39c12',           // สีประจำโหมดสอง (ธรรมยาตรา)
      },
    },
  },

  plugins: [],
};
