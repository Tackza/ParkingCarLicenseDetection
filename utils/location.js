// file: utils/location.js
//
// พิกัดที่ติดไปกับ check-in (ส่งเป็น lat / long ตอนอัปโหลด — server เก็บลง Lat / Long)
//
// หลักสำคัญ: ห้ามทำให้การสแกนช้าลง และห้ามส่ง 0 แทน "ไม่มีพิกัด"
// - ใช้พิกัดล่าสุดที่เครื่องมีอยู่แล้วก่อน (ไม่ต้องรอดาวเทียม) ถ้าสดพอ
// - ไม่มีค่อยขอพิกัดใหม่ แต่รอไม่เกิน LOCATION_TIMEOUT_MS
// - ไม่ได้อนุญาต / ไม่มีสัญญาณ / หมดเวลา → null แล้วบันทึกต่อตามปกติ
//
// SUNMI V3 มี GPS (android.hardware.location.gps) ตรวจจากเครื่องจริงแล้ว

import * as Location from 'expo-location';

/** พิกัดเก่ากว่านี้ไม่ใช้ — รถจอดนิ่ง แต่เจ้าหน้าที่เดินไปมาในลานจอด */
const MAX_AGE_MS = 2 * 60 * 1000;
/** ความคลาดเคลื่อนเกินนี้ (เมตร) ถือว่าไม่น่าเชื่อถือพอจะใช้แทนการขอใหม่ */
const MAX_ACCURACY_M = 100;
/** รอพิกัดใหม่นานสุดเท่านี้ — การอ่านป้าย (~1 วิ) ทำไปพร้อมกัน */
const LOCATION_TIMEOUT_MS = 4000;

let permissionAsked = false;
let permissionGranted = false;

export const ensurePermission = async () => {
  if (permissionGranted) return true;
  try {
    const current = await Location.getForegroundPermissionsAsync();
    if (current.granted) {
      permissionGranted = true;
      return true;
    }
    // ถามครั้งเดียวต่อการเปิดแอป ถ้าปฏิเสธไปแล้วก็ไม่ถามซ้ำทุกการสแกน
    if (permissionAsked || !current.canAskAgain) return false;
    permissionAsked = true;
    const asked = await Location.requestForegroundPermissionsAsync();
    permissionGranted = asked.granted;
    return permissionGranted;
  } catch (e) {
    return false;
  }
};

const toFix = (pos) =>
  pos?.coords
    ? {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy ?? null,
    }
    : null;

/**
 * พิกัดสำหรับ check-in ที่กำลังสแกน: `{ latitude, longitude, accuracy }` หรือ null
 * ไม่ throw — การไม่มีพิกัดต้องไม่ทำให้บันทึกไม่ได้
 */
export async function getCheckInLocation() {
  try {
    if (!(await ensurePermission())) return null;

    const last = await Location.getLastKnownPositionAsync({
      maxAge: MAX_AGE_MS,
      requiredAccuracy: MAX_ACCURACY_M,
    });
    if (last) return toFix(last);

    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise((resolve) => setTimeout(() => resolve(null), LOCATION_TIMEOUT_MS)),
    ]);
    return toFix(fresh);
  } catch (e) {
    console.log('getCheckInLocation failed:', e?.message);
    return null;
  }
}
