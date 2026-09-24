// tailwind.config.js
//
// ไฟล์นี้ต้องมีอยู่ ไม่งั้น metro.config.js โหลดไม่ผ่านเลย — withNativeWind เรียก
// tailwind.config ทันทีตอนโหลด ไม่ได้รอถึงตอน build (ดู nativewind/dist/metro/index.js)
//
// ตอนนี้ยังเป็นโครงเปล่า ยังไม่มี design token — semantic token จะถูกเติมที่ task 4.1
// หลังจากพิสูจน์แล้วว่า toolchain และ OTA ใช้งานได้จริง

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
    extend: {
      // ⬅️ semantic token (primary, background, surface, text, border, ...) มาที่นี่ใน task 4.1
      // ค่าทั้งหมดต้องตรงกับ hex เดิมใน baseline-login-styles.md ทุกตัว
    },
  },

  plugins: [],
};
