// ตัวช่วยแปลงแถวของ check_ins ให้คนหน้างานอ่านรู้เรื่อง
//
// ใช้ร่วมกันระหว่างการ์ดในหน้าหลัก (components/HistoryItem.js) กับหน้ารายละเอียด
// (app/checkin-detail.js) — ถ้าต่างคนต่างเขียน คำเรียกกับสีของสถานะเดียวกัน
// จะค่อยๆ เพี้ยนไปคนละทาง แล้วเจ้าหน้าที่จะเห็นการ์ดบอก "รอส่ง" แต่หน้ารายละเอียดบอกอย่างอื่น

// passenger เก็บเป็น "ผู้ใหญ่|เด็ก|พระ|สามเณร" — ดู CLAUDE.md § The two operational modes
export const formatPassengerInfo = (passengerString) => {
  if (!passengerString || typeof passengerString !== 'string') return '';
  const parts = passengerString.split('|');
  if (parts.length < 4) return '';

  const segments = [];
  const people = parseInt(parts[0] || 0) + parseInt(parts[1] || 0); // ผู้ใหญ่ + เด็ก
  const monks = parseInt(parts[2] || 0);
  const novices = parseInt(parts[3] || 0);

  if (people > 0) segments.push(`${people}คน`);
  if (monks > 0) segments.push(`${monks}รูป`);
  if (novices > 0) segments.push(`สณ${novices}รูป`);

  // ✅ เดิมคืน '-- คน' เมื่อไม่มีใครเลย แล้วเงื่อนไขกรองข้างล่างปล่อยผ่าน
  //    ชิปนี้จึงขึ้นทุกใบทั้งที่ไม่ได้บอกอะไร และกินพื้นที่ในคอลัมน์ที่กว้างแค่ 200dp
  //    คืนค่าว่างแทน เพื่อให้ชิปหายไปเมื่อไม่มีข้อมูลจริง
  return segments.join('/');
};

// สถานะการส่งขึ้น server — ดู CLAUDE.md § sync_status
// 0 = ยังไม่ได้ลอง · 2 = สำเร็จ · 3 = ล้มเหลวแบบลองใหม่ได้ · 4 = server ปฏิเสธ
export const SYNC_STATES = {
  sent: { label: 'ส่งแล้ว', box: 'bg-success-bg', dot: 'bg-success', text: 'text-success-ink' },
  waiting: { label: 'รอส่ง', box: 'bg-warning-bg', dot: 'bg-warning', text: 'text-warning-ink' },
  failed: { label: 'ติดปัญหา', box: 'bg-danger-bg', dot: 'bg-danger', text: 'text-danger-ink' },
};

export const syncStateOf = (status) => {
  if (status == 2) return SYNC_STATES.sent;
  if (status == 4) return SYNC_STATES.failed;
  return SYNC_STATES.waiting;
};

// error_msg ในแถวอาจเป็น JSON ทั้งก้อนที่ server ตอบมา หรือข้อความธรรมดาก็ได้
export const parseErrorMessage = (raw) => {
  if (!raw) return null;

  let message = raw;
  try {
    if (typeof raw === 'string') message = JSON.parse(raw)?.message || raw;
    else message = raw?.message || raw;
  } catch (e) {
    message = raw;
  }
  return typeof message === 'string' ? message : String(message);
};

// 422 "The comp id field is required." — สาเหตุอันดับหนึ่งที่รายการค้าง (ดู backfillCheckInCompId)
export const isCompIdError = (message) => !!message && /comp[_ ]?id/i.test(message);

// ข้อความจาก server เป็นภาษาอังกฤษและบอกแต่ชื่อฟิลด์ เจ้าหน้าที่หน้างานอ่านแล้วไม่รู้ต้องทำอะไร
// แปลเฉพาะเคสที่เจอจริง ที่เหลือคืนข้อความเดิมไว้ ดีกว่าซ่อนสิ่งที่เรายังไม่รู้จัก
export const explainError = (raw) => {
  const message = parseErrorMessage(raw);
  if (!message) return null;

  if (isCompIdError(message)) {
    return 'ยังไม่ได้ตั้งรหัสเครื่อง — เซิร์ฟเวอร์ปฏิเสธรายการนี้ ตั้งรหัสในหน้าตั้งค่าแล้วระบบจะส่งให้เอง';
  }
  return message;
};

// created_at / sync_at / next_retry_at เขียนด้วย datetime('now', 'localtime') ของ SQLite
// ได้รูป "YYYY-MM-DD HH:MM:SS" ไม่มี timezone — แทนช่องว่างด้วย T ให้เป็น ISO
// ซึ่ง Date ทุกเอนจินอ่านเป็นเวลาท้องถิ่นเหมือนกัน
export const parseLocalDateTime = (value) => {
  if (!value) return null;
  const date = new Date(String(value).replace(' ', 'T'));
  return isNaN(date.getTime()) ? null : date;
};

export const formatTime = (value) => {
  const date = parseLocalDateTime(value);
  return date
    ? date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.'
    : null;
};

// check-in เก็บจังหวัดชื่อเต็ม แต่พื้นที่บนจอ 360dp ไม่พอ
export const shortProvince = (province) => (province || '').replace('กรุงเทพมหานคร', 'กทม.');

// dropdown และ THAI_PROVINCES ใช้ชื่อเต็ม แต่ check-in บางแถวเก็บ กทม. แบบย่อ
// ต้องแปลงก่อนส่งไปค้นหา ไม่งั้น dropdown ไม่ติ๊กค่าให้และ server หาไม่เจอ
export const fullProvince = (province) => (province === 'กทม.' ? 'กรุงเทพมหานคร' : province);
