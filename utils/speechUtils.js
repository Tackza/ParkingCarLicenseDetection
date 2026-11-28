// file: utils/speechUtils.js

// Map สำหรับตัวอักษร
const thaiCharMap = {
  'ก': 'กอ ไก่', 'ข': 'ขอ ไข่', 'ฃ': 'ขอ ฃวด', 'ค': 'คอ ควาย',
  'ฅ': 'คอ ฅน', 'ฆ': 'คอ ระฆัง', 'ง': 'งอ งู', 'จ': 'จอ จาน',
  'ฉ': 'ฉอ ฉิ่ง', 'ช': 'ชอ ช้าง', 'ซ': 'ซอ โซ่', 'ฌ': 'ชอ เฌอ',
  'ญ': 'ยอ หญิง', 'ฎ': 'ดอ ชฎา', 'ฏ': 'ตอ ปฏัก', 'ฐ': 'ถอ ฐาน',
  'ฑ': 'ทอ มณโฑ', 'ฒ': 'ทอ ผู้เฒ่า', 'ณ': 'นอ เณร', 'ด': 'ดอ เด็ก',
  'ต': 'ตอ เต่า', 'ถ': 'ถอ ถุง', 'ท': 'ทอ ทหาร', 'ธ': 'ทอ ธง',
  'น': 'นอ หนู', 'บ': 'บอ ใบไม้', 'ป': 'ปอ ปลา', 'ผ': 'ผอ ผึ้ง',
  'ฝ': 'ฝอ ฝา', 'พ': 'พอ พาน', 'ฟ': 'ฟอ ฟัน', 'ภ': 'พอ สำเภา',
  'ม': 'มอ ม้า', 'ย': 'ยอ ยักษ์', 'ร': 'รอ เรือ', 'ล': 'ลอ ลิง',
  'ว': 'วอ แหวน', 'ศ': 'สอ ศาลา', 'ษ': 'สอ ฤๅษี', 'ส': 'สอ เสือ',
  'ห': 'หอ หีบ', 'ฬ': 'ลอ จุฬา', 'อ': 'ออ อ่าง', 'ฮ': 'ฮอ นกฮูก'
};

// Map สำหรับตัวเลข
const numMap = {
  '0': 'ศูนย์', '1': 'หนึ่ง', '2': 'สอง', '3': 'สาม', '4': 'สี่',
  '5': 'ห้า', '6': 'หก', '7': 'เจ็ด', '8': 'แปด', '9': 'เก้า'
};

/**
 * แปลงข้อความทะเบียนรถเป็นคำที่อ่านออกเสียงได้
 * @param {string} plate - ข้อความทะเบียนรถ เช่น "กค583"
 * @returns {string} - ข้อความที่อ่านได้ เช่น "กอ ไก่ คอ ควาย ห้า แปด สาม"
 */
export const createSpokenPlate = (plate) => {
  if (!plate) return '';

  // ลบช่องว่างทั้งหมดออกก่อน
  const cleanedPlate = plate.replace(/\s/g, '');

  const spokenParts = [];

  // วนทีละตัวอักษร
  for (const char of cleanedPlate) {
    if (thaiCharMap[char]) {
      spokenParts.push(thaiCharMap[char]);
    } else if (numMap[char]) {
      spokenParts.push(numMap[char]);
    } else {
      // ไม่ต้องทำอะไร ถ้าเป็นตัวอักษรที่ไม่รู้จัก
    }
  }

  // รวมร่างด้วยการเว้นวรรค
  return spokenParts.join(' ');
};



/**
 * ข้อความที่อ่านหลังสแกน — รวมเป็นประโยคเดียว (เดิมสั่ง Speech.speak สองครั้งต่อคิวกัน)
 * ตัวอย่าง: "ทะเบียน, กอ ไก่ คอ ควาย ห้า แปด สาม, นนทบุรี, ไม่พบซีเจ็ด"
 */
export const buildScanAnnouncement = (plate, province, { hasDuplicate = false, found = true } = {}) => {
  const parts = ['ทะเบียน', createSpokenPlate(plate) || 'ไม่พบทะเบียน', province || 'ไม่พบจังหวัด'];
  if (hasDuplicate) parts.push('ลงทะเบียนแล้ว');
  if (!found) parts.push('ไม่พบซีเจ็ด');
  return parts.join(', ');
};

/**
 * เริ่มพูด แล้ว resolve เมื่อเสียงเริ่มออกจริง (onStart) — หรือพูดไม่ได้ หรือครบ maxWaitMs ก่อน
 * ใช้ให้หน้าสแกนค้างวงหมุนไว้จนเสียงออก แล้วค่อยแสดงรูป เจ้าหน้าที่จะได้ยินทะเบียนก่อนเห็นจอ
 * ไม่ reject เด็ดขาด — เสียงพังต้องไม่ทำให้สแกนพัง
 * @param {typeof import('expo-speech')} Speech ส่งเข้ามาเพื่อให้เทสต์ mock ได้
 */
export const speakAndWaitForStart = (Speech, text, options = {}, maxWaitMs = 1500) =>
  new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, maxWaitMs);
    try {
      Speech.stop();
      Speech.speak(text, {
        ...options,
        onStart: done,
        onDone: done,
        onError: done,
        onStopped: done,
      });
    } catch (e) {
      done();
    }
  });
