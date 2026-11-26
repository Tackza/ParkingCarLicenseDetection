// เทสต์ตรรกะการเก็บเส้นทางเดิน (utils/routeTracking.js) — ไม่มี GPS ไม่มี DB ไม่มี network
// npx jest utils/__tests__/routeTracking.test.js

import {
  MAX_ACCURACY_METERS,
  STATIONARY_HEARTBEAT_MS,
  ROUTE_UPLOAD_PATH,
  distanceMeters,
  formatLocalTimestamp,
  getTrackingState,
  nextLocationUpload,
  setTrackingState,
  shouldRecordPoint,
  subscribeTrackingState,
  toCompId,
  toLocationRow,
} from '../routeTracking';

// ลานจอดรถแถวคลองหลวง — 0.00001° ละติจูด ≈ 1.11 ม.
const BASE = { latitude: 14.0712, longitude: 100.6012, accuracy: 8, timestamp: 1_000_000 };
const moved = (meters, dtMs, extra = {}) => ({
  ...BASE,
  latitude: BASE.latitude + meters / 111_195,
  timestamp: BASE.timestamp + dtMs,
  ...extra,
});

describe('distanceMeters', () => {
  test('ละติจูดต่างกัน 0.001° ≈ 111 ม.', () => {
    expect(distanceMeters(BASE, { ...BASE, latitude: BASE.latitude + 0.001 })).toBeCloseTo(111.2, 0);
  });
  test('จุดเดียวกัน = 0', () => {
    expect(distanceMeters(BASE, BASE)).toBe(0);
  });
});

describe('shouldRecordPoint — จุดไหนควรเก็บ', () => {
  test('จุดแรกเก็บเสมอ', () => {
    expect(shouldRecordPoint(null, BASE)).toBe(true);
  });

  test('เดินไป ≥5 ม. ภายใน 10 วิ → เก็บ', () => {
    expect(shouldRecordPoint(BASE, moved(6, 10_000))).toBe(true);
  });

  test('ขยับ <5 ม. และยังไม่ครบ 1 นาที → ไม่เก็บ (ยืนอยู่กับที่ไม่ต้องได้ 6 จุดต่อนาที)', () => {
    expect(shouldRecordPoint(BASE, moved(2, 10_000))).toBe(false);
    expect(shouldRecordPoint(BASE, moved(2, STATIONARY_HEARTBEAT_MS - 1))).toBe(false);
  });

  test('ยืนอยู่กับที่ครบ 1 นาที → เก็บ (ให้รู้ว่าเครื่องยังเปิดอยู่)', () => {
    expect(shouldRecordPoint(BASE, moved(0, STATIONARY_HEARTBEAT_MS))).toBe(true);
  });

  test('ความแม่นยำแย่เกิน 100 ม. → ไม่เก็บ แม้เป็นจุดแรก', () => {
    expect(shouldRecordPoint(null, { ...BASE, accuracy: MAX_ACCURACY_METERS + 1 })).toBe(false);
    expect(shouldRecordPoint(null, { ...BASE, accuracy: MAX_ACCURACY_METERS })).toBe(true);
  });

  test('ไม่รู้ความแม่นยำ (null) → ยังเก็บได้', () => {
    expect(shouldRecordPoint(null, { ...BASE, accuracy: null })).toBe(true);
  });

  test('0,0 (GPS ยังไม่ fix) → ไม่เก็บ', () => {
    expect(shouldRecordPoint(null, { ...BASE, latitude: 0, longitude: 0 })).toBe(false);
  });

  test('ค่าที่ไม่ใช่ตัวเลข → ไม่เก็บ', () => {
    expect(shouldRecordPoint(null, { ...BASE, latitude: NaN })).toBe(false);
    expect(shouldRecordPoint(null, null)).toBe(false);
  });

  test('จุดที่เวลาไม่ใหม่กว่าจุดล่าสุด (มาช้า/ซ้ำ) → ไม่เก็บ แม้อยู่ไกล', () => {
    expect(shouldRecordPoint(BASE, moved(50, 0))).toBe(false);
    expect(shouldRecordPoint(BASE, moved(50, -5000))).toBe(false);
  });
});

describe('toLocationRow — ผลจาก expo-location → แถวในเครื่อง', () => {
  const loc = (coords) => ({ timestamp: new Date(2026, 10, 26, 9, 5, 7).getTime(), coords: { latitude: 14.07, longitude: 100.6, accuracy: 6.5, ...coords } });
  const ctx = { comp_id: '8012', user_id: 99, project_id: 12, activity_id: 34 };

  test('ครบทุกช่อง เวลาเป็นเวลาท้องถิ่นแบบเดียวกับ created_at', () => {
    expect(toLocationRow(loc({ speed: 1.2, heading: 90 }), ctx)).toEqual({
      recorded_at: '2026-11-26 09:05:07',
      latitude: 14.07, longitude: 100.6, accuracy: 6.5, speed: 1.2, heading: 90,
      comp_id: '8012', user_id: 99, project_id: 12, activity_id: 34,
    });
  });

  test('speed / heading ที่ไม่รู้ (-1 หรือ null) → null ไม่ใช่ -1', () => {
    const r = toLocationRow(loc({ speed: -1, heading: -1 }), ctx);
    expect(r.speed).toBeNull();
    expect(r.heading).toBeNull();
    expect(toLocationRow(loc({ speed: null, heading: null }), ctx).speed).toBeNull();
  });

  test('speed = 0 (ยืนนิ่ง) ยังเป็น 0', () => {
    expect(toLocationRow(loc({ speed: 0 }), ctx).speed).toBe(0);
  });

  test('ไม่มีรหัสเครื่อง/กิจกรรม → null', () => {
    const r = toLocationRow(loc({}), {});
    expect([r.comp_id, r.user_id, r.project_id, r.activity_id]).toEqual([null, null, null, null]);
  });
});

describe('formatLocalTimestamp', () => {
  test('เติมเลขศูนย์ข้างหน้า', () => {
    expect(formatLocalTimestamp(new Date(2027, 0, 2, 3, 4, 5).getTime())).toBe('2027-01-02 03:04:05');
  });
});

describe('nextLocationUpload — body ของ POST /lpr/locations (mbus_backend DeviceLocationController)', () => {
  const row = (id, extra = {}) => ({
    id, recorded_at: `2026-11-26 09:05:0${id % 10}`, latitude: 14.07, longitude: 100.6,
    accuracy: 6.5, speed: null, heading: 90, comp_id: '8012', user_id: 99, project_id: 12, activity_id: 3, ...extra,
  });

  test('ส่งไปที่ /lpr/locations', () => {
    expect(ROUTE_UPLOAD_PATH).toBe('/lpr/locations');
  });

  test('ชื่อฟิลด์ตรงกับ server: comp_id เป็นตัวเลข, lng ไม่ใช่ long, ไม่มี local_id/user_id/activity_id', () => {
    expect(nextLocationUpload([row(1)])).toEqual({
      ids: [1],
      body: {
        comp_id: 8012,
        project_id: 12,
        points: [{ lat: 14.07, lng: 100.6, accuracy: 6.5, speed: null, heading: 90, recorded_at: '2026-11-26 09:05:01' }],
      },
    });
  });

  test('หนึ่งคำขอ = (comp_id, project_id) เดียว ของแถวเก่าสุด ; กลุ่มอื่นรอรอบหน้า', () => {
    const up = nextLocationUpload([row(1), row(2, { project_id: 13 }), row(3), row(4, { comp_id: '9000' })]);
    expect(up.ids).toEqual([1, 3]);
    expect(up.body.project_id).toBe(12);
  });

  test('ไม่เกิน maxPoints', () => {
    expect(nextLocationUpload([row(1), row(2), row(3)], null, 2).ids).toEqual([1, 2]);
  });

  test('แถวที่เก็บตอนยังไม่มีรหัสเครื่อง ใช้รหัสปัจจุบันแทน', () => {
    const up = nextLocationUpload([row(1, { comp_id: null })], '8012');
    expect(up.body.comp_id).toBe(8012);
  });

  test('ไม่มีรหัสเครื่องเลย → ส่งไม่ได้ (server บังคับ comp_id ≥ 1)', () => {
    expect(nextLocationUpload([row(1, { comp_id: null })], '')).toBeNull();
    expect(nextLocationUpload([row(1, { comp_id: 'abc' })], null)).toBeNull();
    expect(nextLocationUpload([], '8012')).toBeNull();
  });

  test('toCompId', () => {
    expect(toCompId(' 8012 ')).toBe(8012);
    expect([toCompId('0'), toCompId('80a'), toCompId(null), toCompId('')]).toEqual([null, null, null, null]);
  });
});

describe('สถานะสำหรับป้าย "เส้นทาง"', () => {
  test('แจ้งผู้ฟังเมื่อเปลี่ยน และไม่แจ้งซ้ำเมื่อค่าเดิม', () => {
    const fn = jest.fn();
    const unsub = subscribeTrackingState(fn);
    setTrackingState({ active: true, reason: 'tracking' });
    setTrackingState({ active: true, reason: 'tracking' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(getTrackingState()).toEqual({ active: true, reason: 'tracking' });
    unsub();
    setTrackingState({ active: false, reason: 'background' });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
