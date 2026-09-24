// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// withNativeWind อ่าน global.css แล้วคอมไพล์ utility class ของ Tailwind
// เป็น style object ของ React Native ตอน build — ไม่มี native module และไม่มี runtime ใหม่
// input ต้องชี้ไปไฟล์ที่มีอยู่จริง ไม่งั้น metro จะล้มตอนเริ่ม
module.exports = withNativeWind(config, { input: './global.css' });
