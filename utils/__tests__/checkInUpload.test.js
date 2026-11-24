// เทสต์ตรรกะการส่ง check-in (utils/checkInUpload.js) — ไม่มี DB ไม่มี network
// npx jest utils/__tests__/checkInUpload.test.js

import {
  SYNC_RETRY_BACKOFF_MINUTES,
  buildCheckInFields,
  classifyUploadError,
  classifyUploadResponse,
  describeUploadError,
  isDuplicateError,
  retryDelayMinutes,
} from '../checkInUpload';

// แถว check_ins หน้าตาเหมือนที่ getUnsyncedCheckIns() คืนมา
const baseRow = {
  id: 7,
  uid: '01JD0000000000000000000000',
  project_id: 12,
  activity_id: 34,
  register_id: 5678,
  detect_plate_no: 'นข2628',
  detect_plate_province: 'สิงห์บุรี',
  plate_no: 'นข2628',
  plate_province: 'สิงห์บุรี',
  is_plate_manual: 0,
  bus_type: 'พัดลม',
  passenger: '40|2|1|0',
  mileage: null,
  sticker_no: 'A12',
  note: null,
  comp_id: 3,
  ocr_connected: 1,
  latitude: 14.0712345,
  longitude: 100.6012345,
  seq_no: 0,
  printed: 1,
  created_at: '2026-11-24 09:15:00',
  created_by: 99,
};
const fields = (row) => Object.fromEntries(buildCheckInFields(row));

// error หน้าตาเหมือนที่ axios throw
const httpError = (status, data) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } });
const netError = (code, message = 'Network Error') => Object.assign(new Error(message), { code });

describe('buildCheckInFields — ค่าที่ส่งขึ้น server', () => {
  test('ส่งครบทุกฟิลด์ ตามชื่อบน server', () => {
    expect(fields(baseRow)).toEqual({
      uid: baseRow.uid,
      local_id: '7',
      project_id: 12,
      activity_id: 34,
      register_id: 5678,
      detect_plate_no: 'นข2628',
      detect_plate_province: 'สิงห์บุรี',
      plate_no: 'นข2628',
      plate_province: 'สิงห์บุรี',
      is_manual: '0',
      bus_type: 'พัดลม',
      passenger: '40|2|1|0',
      mileage: '',
      sticker_no: 'A12',
      note: '',
      comp_id: 3,
      ocr_connected: '1',
      lat: 14.0712345,
      long: 100.6012345,
      seq_no: 0,
      printed: '1',
      created_at: '2026-11-24 09:15:00',
      created_by: 99,
    });
  });

  test('ไม่มีพิกัด → ส่งว่าง ห้ามส่ง 0 (เดิมส่ง 0 ทุกแถว = จุด 0,0 กลางทะเล)', () => {
    const f = fields({ ...baseRow, latitude: null, longitude: null });
    expect(f.lat).toBe('');
    expect(f.long).toBe('');
  });

  test('พิกัดที่เป็น 0 จริง (เส้นศูนย์สูตร) ยังส่ง 0 — ใช้ ?? ไม่ใช่ ||', () => {
    const f = fields({ ...baseRow, latitude: 0, longitude: 0 });
    expect(f.lat).toBe(0);
    expect(f.long).toBe(0);
  });

  test('seq_no = 0 ต้องส่ง 0 ไม่ใช่ว่าง (ว่างแล้ว server ตอบ 422)', () => {
    expect(fields({ ...baseRow, seq_no: 0 }).seq_no).toBe(0);
    expect(fields({ ...baseRow, seq_no: null }).seq_no).toBe('');
  });

  test('ocr_connected = 0 ต้องส่ง "0" (เดิมได้ "1" เสมอ)', () => {
    expect(fields({ ...baseRow, ocr_connected: 0 }).ocr_connected).toBe('0');
  });

  test('is_plate_manual ในเครื่อง → is_manual บน server', () => {
    const f = fields({ ...baseRow, is_plate_manual: 1 });
    expect(f.is_manual).toBe('1');
    expect(f).not.toHaveProperty('is_plate_manual');
  });

  test('activity_id / sticker_no ที่เป็น null → ว่าง, register_id ไม่มี → ว่าง', () => {
    const f = fields({ ...baseRow, activity_id: null, sticker_no: null, register_id: null });
    expect(f.activity_id).toBe('');
    expect(f.sticker_no).toBe('');
    expect(f.register_id).toBe('');
  });

  test('ไม่มี created_at → ใส่เวลาปัจจุบันแบบ ISO', () => {
    const f = fields({ ...baseRow, created_at: null });
    expect(f.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe('classifyUploadError — ส่งไม่สำเร็จแล้วต้องทำอะไรต่อ', () => {
  const classify = (err) => classifyUploadError(err, describeUploadError(err));

  test.each([401, 403])('%i: token ใช้ไม่ได้ → หยุด batch คงไว้ที่ 3 (ไม่ใช่ 4)', (status) => {
    expect(classify(httpError(status, { message: 'Unauthenticated.' }))).toEqual({
      authExpired: true, duplicate: false, syncStatus: 3, networkFailure: false,
    });
  });

  test.each([400, 404, 422])('%i: server ปฏิเสธข้อมูล → 4 (ถอยเวลา) ไม่หยุด batch', (status) => {
    expect(classify(httpError(status, { message: 'invalid' }))).toEqual({
      authExpired: false, duplicate: false, syncStatus: 4, networkFailure: false,
    });
  });

  test.each([500, 502, 503])('%i: server ล่ม → 3 (ส่งใหม่รอบหน้าทันที) ไม่หยุด batch', (status) => {
    expect(classify(httpError(status, 'Bad Gateway'))).toMatchObject({ syncStatus: 3, networkFailure: false });
  });

  test('timeout → 3 และหยุด batch', () => {
    expect(classify(netError('ECONNABORTED', 'timeout of 30000ms exceeded'))).toMatchObject({
      syncStatus: 3, networkFailure: true, authExpired: false,
    });
  });

  test.each(['ERR_NETWORK', 'ENOTFOUND'])('%s (ออฟไลน์) → 3 และหยุด batch', (code) => {
    expect(classify(netError(code))).toMatchObject({ syncStatus: 3, networkFailure: true });
  });

  test('422 ที่บอกว่า uid ซ้ำ → ถือว่าสำเร็จ', () => {
    expect(classify(httpError(422, { message: 'The uid has already been taken. Duplicate entry' })))
      .toMatchObject({ duplicate: true, authExpired: false });
  });

  test('error ที่ไม่ใช่ axios แต่มี status (ตอบ 201/204 ผิดคาด) ใช้ status นั้นตัดสิน', () => {
    const err = Object.assign(new Error('Unexpected status 204'), { status: 204 });
    expect(classify(err)).toMatchObject({ syncStatus: 3, networkFailure: false });
    const err4 = Object.assign(new Error('x'), { status: 409 });
    expect(classify(err4).syncStatus).toBe(4);
  });

  test('error แปลกๆ ไม่มีข้อมูลอะไรเลย → 3 (ปลอดภัย: ส่งใหม่ ไม่ทิ้ง)', () => {
    expect(classify(new Error('something odd'))).toEqual({
      authExpired: false, duplicate: false, syncStatus: 3, networkFailure: false,
    });
  });
});

describe('classifyUploadResponse — server ตอบ 200', () => {
  test('status success → synced', () => {
    expect(classifyUploadResponse({ status: 'success', result: {} })).toEqual({ outcome: 'synced' });
  });

  test('body บอกว่าซ้ำ → synced', () => {
    expect(classifyUploadResponse({ status: 'error', message: 'Check-in already exists' }).outcome).toBe('synced');
  });

  test('body error อื่น → rejected พร้อมข้อความ', () => {
    expect(classifyUploadResponse({ status: 'error', message: 'project closed' }))
      .toEqual({ outcome: 'rejected', message: 'project closed' });
  });

  test('body ไม่มีข้อความ → rejected ด้วยข้อความกลาง', () => {
    expect(classifyUploadResponse({})).toEqual({ outcome: 'rejected', message: 'Unknown error from server.' });
  });
});

describe('describeUploadError — ข้อความที่บันทึกลง error log', () => {
  test('ดึงเหตุผลจาก validation errors ของ server ไม่ใช่แค่ "status code 422"', () => {
    const err = httpError(422, {
      message: 'The given data was invalid.',
      errors: { seq_no: ['The seq no field is required.'], comp_id: ['required'] },
    });
    expect(describeUploadError(err)).toBe(
      '[422] The given data was invalid. | seq_no: The seq no field is required. | comp_id: required'
    );
  });

  test('body เป็นข้อความ', () => {
    expect(describeUploadError(httpError(502, 'Bad Gateway'))).toBe('[502] Bad Gateway');
  });

  test('ไม่มี body → ใช้ข้อความของ axios', () => {
    expect(describeUploadError(netError('ERR_NETWORK'))).toBe('Network Error');
  });

  test('ตัดที่ 2000 ตัวอักษร', () => {
    expect(describeUploadError(httpError(500, 'x'.repeat(5000)))).toHaveLength(2000);
  });
});

describe('isDuplicateError', () => {
  test.each([
    ['Duplicate entry for uid', true],
    ['CHECK-IN ALREADY EXISTS', true],
    [new Error('duplicate key'), true],
    [{ message: 'already exists' }, true],
    ['validation failed', false],
    ['', false],
    [null, false],
  ])('%p → %p', (input, expected) => {
    expect(isDuplicateError(input)).toBe(expected);
  });
});

describe('retryDelayMinutes — ถอยเวลาแถวที่ server ปฏิเสธ', () => {
  test('1 → 5 → 15 → 60 → 180 → 360 นาที', () => {
    expect([1, 2, 3, 4, 5, 6].map(retryDelayMinutes)).toEqual([1, 5, 15, 60, 180, 360]);
  });

  test('หลังครั้งที่ 6 ค้างที่ 6 ชม. ไม่มีเพดาน (แถวไม่ถูกทิ้ง)', () => {
    expect(retryDelayMinutes(7)).toBe(360);
    expect(retryDelayMinutes(500)).toBe(360);
  });

  test('ค่าผิดปกติ (0 / ติดลบ) ใช้ค่าแรก', () => {
    expect(retryDelayMinutes(0)).toBe(SYNC_RETRY_BACKOFF_MINUTES[0]);
    expect(retryDelayMinutes(-3)).toBe(SYNC_RETRY_BACKOFF_MINUTES[0]);
  });
});
