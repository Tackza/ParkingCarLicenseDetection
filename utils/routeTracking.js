// file: utils/routeTracking.js
//
// ตรรกะของการเก็บเส้นทางเดินที่ไม่ผูกกับ React — components/LocationTracker.js เป็นคนทำ I/O
// เทสต์อยู่ที่ utils/__tests__/routeTracking.test.js
//
// ทุกฟังก์ชันในไฟล์นี้ (ยกเว้น store สถานะด้านล่าง) ต้องไม่มี side effect

/** ขอพิกัดใหม่ทุกกี่ ms */
export const SAMPLE_INTERVAL_MS = 10_000;
/** ขยับน้อยกว่านี้ (เมตร) ถือว่ายืนอยู่กับที่ */
export const STATIONARY_METERS = 5;
/** ยืนอยู่กับที่ ยังบันทึกทุกช่วงนี้ เพื่อให้ dashboard รู้ว่าเครื่องยังเปิดอยู่ */
export const STATIONARY_HEARTBEAT_MS = 60_000;
/** จุดที่คลาดเคลื่อนเกินนี้ (เมตร) ไม่บันทึก — มักเป็นจุดจากเสาสัญญาณตอน GPS ยังไม่ fix */
export const MAX_ACCURACY_METERS = 100;
/** ส่งขึ้น server ทุกกี่ ms และครั้งละกี่จุด — 10 วินาที ให้แผนที่หน้าธรรมยาตราเห็นเกือบทันที (ผู้ใช้ขอ 2026-11-27 ; เดิม 1 นาที) */
export const UPLOAD_INTERVAL_MS = 10_000;
export const UPLOAD_BATCH_SIZE = 500;

/**
 * ส่งไป POST /lpr/locations (mbus_backend, 26 พ.ย. 2026) — หน้าธรรมยาตราของแอดมินวาดเส้นทางจากตาราง lpr_device_locations
 * ปิดเป็น false ได้ถ้าต้องหยุดส่ง จุดจะสะสมในเครื่องไม่เกิน 14 วัน (Database.pruneLocationPoints)
 */
export const ROUTE_UPLOAD_ENABLED = true;
export const ROUTE_UPLOAD_PATH = '/lpr/locations';

/** ระยะทางบนผิวโลก (เมตร) */
export const distanceMeters = (a, b) => {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/**
 * ควรบันทึกจุดนี้ไหม
 * @param {{latitude, longitude, timestamp}|null} last จุดล่าสุดที่บันทึกไปแล้ว
 * @param {{latitude, longitude, accuracy, timestamp}} next จุดใหม่จาก GPS (timestamp เป็น ms)
 */
export const shouldRecordPoint = (last, next) => {
  if (!next || !Number.isFinite(next.latitude) || !Number.isFinite(next.longitude)) return false;
  // 0,0 คือกลางทะเล ไม่ใช่ลานจอดรถ — GPS บางเครื่องส่งมาตอนยังไม่ fix
  if (next.latitude === 0 && next.longitude === 0) return false;
  if (next.accuracy != null && next.accuracy > MAX_ACCURACY_METERS) return false;
  if (!last) return true;
  if (next.timestamp <= last.timestamp) return false; // จุดเก่าที่มาช้า หรือซ้ำ
  if (distanceMeters(last, next) >= STATIONARY_METERS) return true;
  return next.timestamp - last.timestamp >= STATIONARY_HEARTBEAT_MS;
};

/** เวลาท้องถิ่นแบบ "YYYY-MM-DD HH:MM:SS" ตรงกับรูปแบบ created_at ของ check_ins */
export const formatLocalTimestamp = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/**
 * แปลงผลจาก expo-location เป็นแถวของ location_points
 * comp_id / user_id / project_id / activity_id ต้องเป็นค่า ณ เวลาที่เก็บ
 */
export const toLocationRow = (loc, ctx) => ({
  recorded_at: formatLocalTimestamp(loc.timestamp),
  latitude: loc.coords.latitude,
  longitude: loc.coords.longitude,
  accuracy: loc.coords.accuracy ?? null,
  // expo-location ใช้ -1 / null เมื่อไม่รู้ค่า
  speed: loc.coords.speed != null && loc.coords.speed >= 0 ? loc.coords.speed : null,
  heading: loc.coords.heading != null && loc.coords.heading >= 0 ? loc.coords.heading : null,
  comp_id: ctx.comp_id ?? null,
  user_id: ctx.user_id ?? null,
  project_id: ctx.project_id ?? null,
  activity_id: ctx.activity_id ?? null,
});

/** comp_id ที่ server รับ: จำนวนเต็ม ≥ 1 (validate `required|integer|min:1`) ; ใช้ไม่ได้ → null */
export const toCompId = (value) => {
  const s = String(value ?? '').trim();
  return /^\d+$/.test(s) && Number(s) >= 1 ? Number(s) : null;
};

/**
 * ชุดถัดไปที่จะส่ง POST /lpr/locations
 *
 * server รับ comp_id กับ project_id ได้ค่าเดียวต่อคำขอ จึงหยิบกลุ่ม (comp_id, project_id) ของแถวเก่าสุดก่อน
 * แล้วรวมแถวอื่นในกลุ่มเดียวกันจนครบ maxPoints — กลุ่มอื่นรอรอบถัดไป (ทุก 1 นาที)
 * แถวที่เก็บตอนยังไม่ตั้งรหัสเครื่องใช้รหัสปัจจุบันแทน (fallbackCompId) — เป็นเครื่องเดียวกัน
 * ยังไม่มีรหัสเลย → ส่งไม่ได้ ค้างในเครื่องจนตั้งรหัส (หรือถูกลบเมื่อเกิน 14 วัน)
 * server กันซ้ำด้วย (comp_id, recorded_at) ส่งชุดเดิมซ้ำหลัง timeout จึงไม่เกิดจุดซ้ำ
 *
 * @returns {{ ids: number[], body: object } | null}
 */
export const nextLocationUpload = (rows, fallbackCompId = null, maxPoints = UPLOAD_BATCH_SIZE) => {
  const fallback = toCompId(fallbackCompId);
  let key = null;
  const picked = [];
  for (const r of rows || []) {
    const compId = toCompId(r.comp_id) ?? fallback;
    if (compId == null) continue;
    const projectId = r.project_id ?? null;
    const k = `${compId}|${projectId}`;
    if (key === null) key = { k, compId, projectId };
    if (k !== key.k) continue;
    picked.push(r);
    if (picked.length >= maxPoints) break;
  }
  if (!key) return null;
  return {
    ids: picked.map((r) => r.id),
    body: {
      comp_id: key.compId,
      project_id: key.projectId,
      points: picked.map((r) => ({
        lat: r.latitude,
        lng: r.longitude,
        accuracy: r.accuracy ?? null,
        speed: r.speed ?? null,
        heading: r.heading ?? null,
        recorded_at: r.recorded_at,
      })),
    },
  };
};

// ─── สถานะให้หน้าจออ่าน (ป้าย "กำลังบันทึกเส้นทาง") ─────────────────────────
// ไม่ใช้ Context เพราะ SyncProvider ถูก mount สองชั้น (ดู CLAUDE.md) — store เล็กๆ ระดับ module แทน

let trackingState = { active: false, reason: 'idle' };
const listeners = new Set();

export const getTrackingState = () => trackingState;
export const subscribeTrackingState = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const setTrackingState = (next) => {
  if (next.active === trackingState.active && next.reason === trackingState.reason) return;
  trackingState = next;
  listeners.forEach((fn) => fn());
};
