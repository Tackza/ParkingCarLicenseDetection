// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// withNativeWind อ่าน global.css แล้วคอมไพล์ utility class ของ Tailwind
// เป็น style object ของ React Native ตอน build — ไม่มี native module และไม่มี runtime ใหม่
// input ต้องชี้ไปไฟล์ที่มีอยู่จริง ไม่งั้น metro จะล้มตอนเริ่ม
//
// ⚠️ inlineRem: 16 — จำเป็น ห้ามลบ
// ค่า default ของ NativeWind คือ 14 (อิงขนาดฟอนต์เริ่มต้นของ React Native)
// แต่ scale ของ Tailwind คิดบนฐาน 1rem = 16px แบบเว็บ ถ้าปล่อยเป็น 14 ทุก class
// ที่ใช้หน่วย rem จะหดลง 12.5% เงียบๆ เช่น mb-5 ได้ 17.5px แทนที่จะเป็น 20px
// และ p-4 ได้ 14px แทน 16px — ไม่มี error ให้เห็น รู้ได้ทางเดียวคือวัดเทียบ
module.exports = withNativeWind(config, { input: './global.css', inlineRem: 16 });
