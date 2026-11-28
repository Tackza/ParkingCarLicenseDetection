// file: utils/checkInUpload.js
//
// ตรรกะของการส่ง check-in ขึ้น server ที่ไม่ผูกกับ React — แยกออกมาจาก
// components/CheckInSyncManager.js เพื่อให้เทสต์ได้ (utils/__tests__/checkInUpload.test.js)
//
// ทุกฟังก์ชันในนี้ต้องไม่มี side effect: ไม่เรียก DB ไม่ยิง network

/**
 * ถอยเวลา (นาที) ก่อนส่งแถวที่ server ปฏิเสธ (sync_status 4) ซ้ำ ตามจำนวนครั้งที่ล้ม
 * หลังครั้งที่ 6 ค้างที่ 6 ชม. และไม่มีเพดาน — แถวไม่ถูกทิ้ง เผื่อ server แก้แล้วรับได้
 */
export const SYNC_RETRY_BACKOFF_MINUTES = [1, 5, 15, 60, 180, 360];

/** @param {number} retryCount ครั้งที่ล้ม นับจาก 1 */
export const retryDelayMinutes = (retryCount) =>
  SYNC_RETRY_BACKOFF_MINUTES[
    Math.min(Math.max(retryCount, 1) - 1, SYNC_RETRY_BACKOFF_MINUTES.length - 1)
  ];

/**
 * ข้อความ error สำหรับบันทึก — axios ใส่แค่ข้อความสำเร็จรูปไว้ใน .message
 * ("Request failed with status code 422") เหตุผลจริงที่ server ส่งมาอยู่ใน response.data
 * รองรับ { message, errors: { field: [...] } } ที่ API ใช้ และ fallback เป็น JSON ดิบ
 */
export const describeUploadError = (error) => {
  const fallback = error?.message || String(error);
  const status = error?.response?.status;
  const body = error?.response?.data;

  if (body === undefined || body === null || body === '') return fallback;

  const prefix = status ? `[${status}] ` : '';

  if (typeof body === 'string') {
    return `${prefix}${body}`.slice(0, 2000);
  }

  const parts = [];
  if (body.message) parts.push(body.message);
  if (body.errors && typeof body.errors === 'object') {
    for (const [field, msgs] of Object.entries(body.errors)) {
      parts.push(`${field}: ${Array.isArray(msgs) ? msgs.join(', ') : msgs}`);
    }
  }
  if (parts.length > 0) return `${prefix}${parts.join(' | ')}`.slice(0, 2000);

  try {
    return `${prefix}${JSON.stringify(body)}`.slice(0, 2000);
  } catch (e) {
    return fallback;
  }
};

/** server มีแถวนี้แล้ว (uid ซ้ำ) — ถือว่าส่งสำเร็จ */
export const isDuplicateError = (errorMessage) => {
  if (!errorMessage) return false;

  let errorText;
  if (typeof errorMessage === 'string') {
    errorText = errorMessage;
  } else if (errorMessage instanceof Error) {
    errorText = errorMessage.message;
  } else if (errorMessage.message) {
    errorText = errorMessage.message;
  } else {
    errorText = JSON.stringify(errorMessage);
  }

  errorText = errorText.toLowerCase();
  return errorText.includes('duplicate') || errorText.includes('already exists');
};

/**
 * ฟิลด์ (ยกเว้นรูป) ที่ส่งไป POST /lpr/checkins ตามลำดับ — คืนเป็น [ชื่อ, ค่า][]
 *
 * ทุกค่ามาจากแถว check_ins เอง ห้ามคำนวณใหม่จากสถานะตอนอัปโหลด เพราะแถวอาจถูกส่ง
 * หลังสร้างหลายชั่วโมง ภายใต้กิจกรรมอื่นไปแล้ว
 */
export const buildCheckInFields = (checkIn) => [
  ['uid', checkIn.uid],
  ['local_id', checkIn.id.toString()],
  ['project_id', checkIn.project_id],
  ['activity_id', checkIn.activity_id === null ? '' : checkIn.activity_id],
  ['register_id', checkIn.register_id || ''],
  ['detect_plate_no', checkIn.detect_plate_no],
  ['detect_plate_province', checkIn.detect_plate_province],
  ['plate_no', checkIn.plate_no || ''],
  ['plate_province', checkIn.plate_province || ''],
  // ชื่อบน server คือ is_manual (คอลัมน์ในเครื่องคือ is_plate_manual)
  ['is_manual', checkIn.is_plate_manual ? '1' : '0'],
  ['bus_type', checkIn.bus_type || ''],
  ['passenger', checkIn.passenger || ''],
  ['mileage', checkIn.mileage || ''],
  ['sticker_no', checkIn.sticker_no === null ? '' : checkIn.sticker_no],
  ['note', checkIn.note || ''],
  ['comp_id', checkIn.comp_id || ''],
  // ค่าที่บันทึกตอนสแกน — เดิมคำนวณใหม่ด้วยฟังก์ชันที่คืน "0"/"1" ซึ่ง truthy ทั้งคู่ จึงได้ '1' เสมอ
  ['ocr_connected', checkIn.ocr_connected ? '1' : '0'],
  // พิกัดตอนถ่ายรูป (migration v10) ไม่มี = ว่าง server รับเป็น null
  // ห้ามส่ง 0 — เดิมส่ง 0 ตายตัวทุกแถว บน server จึงเป็นจุด 0,0 กลางทะเล
  ['lat', checkIn.latitude ?? ''],
  ['long', checkIn.longitude ?? ''],
  // ?? ไม่ใช่ || — seq_no = 0 คือเคสลงทะเบียนปกติ ส่งว่างแล้ว server ปฏิเสธ 422
  ['seq_no', checkIn.seq_no ?? ''],
  ['printed', checkIn.printed ? '1' : '0'],
  ['created_at', checkIn.created_at || new Date().toISOString()],
  ['created_by', checkIn.created_by || ''],
];

/**
 * ตัดสินว่าแถวที่ส่งไม่สำเร็จ (axios throw) ต้องทำอะไรต่อ
 *
 * - `authExpired`  401/403: token ใช้ไม่ได้ ไม่ใช่ความผิดของข้อมูล → คงที่ 3 แล้วหยุดทั้ง batch
 * - `duplicate`    server มีแล้ว → ถือว่าสำเร็จ (2)
 * - `syncStatus`   4 = server ปฏิเสธ (4xx) ถอยเวลา / 3 = เน็ตหรือ server ล่ม ส่งใหม่รอบหน้าทันที
 * - `networkFailure` ยิงไม่ถึง server เลย → แถวที่เหลือก็จะพังเหมือนกัน หยุด batch
 *
 * @param {Error} error สิ่งที่ axios throw
 * @param {string} message ผลของ describeUploadError(error)
 */
export const classifyUploadError = (error, message = '') => {
  const httpStatus = error?.response?.status || error?.status;
  if (httpStatus === 401 || httpStatus === 403) {
    return { authExpired: true, duplicate: false, syncStatus: 3, networkFailure: false };
  }

  let syncStatus = 3;
  let networkFailure = false;

  if (error?.response?.status) {
    const s = error.response.status;
    if (s >= 400 && s < 500) syncStatus = 4;
    else if (s >= 500) syncStatus = 3;
  } else if (error?.code === 'ECONNABORTED' || message.includes('timeout')) {
    networkFailure = true;
  } else if (error?.code === 'ENOTFOUND' || error?.code === 'ERR_NETWORK' || message.includes('Network')) {
    networkFailure = true;
  } else if (error?.status) {
    if (error.status >= 400 && error.status < 500) syncStatus = 4;
    else if (error.status >= 500) syncStatus = 3;
  }

  return { authExpired: false, duplicate: isDuplicateError(message), syncStatus, networkFailure };
};

/**
 * ผลของการส่งที่ server ตอบ 200 กลับมา: 'synced' หรือ 'rejected'
 * (body ที่ status ไม่ใช่ success แต่บอกว่าซ้ำ = server มีแล้ว ถือว่าสำเร็จ)
 */
export const classifyUploadResponse = (responseData) => {
  if (responseData?.status === 'success') return { outcome: 'synced' };
  const message = responseData?.message || 'Unknown error from server.';
  if (isDuplicateError(message)) return { outcome: 'synced', message };
  return { outcome: 'rejected', message };
};
