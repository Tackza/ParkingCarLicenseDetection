// file: utils/registerContacts.js
//
// ชื่อ-เบอร์ผู้ติดต่อของใบ C7 สำหรับเมนู "รถที่เหลือ" — ดึงสดจาก GET /lpr/registers/contacts
// ตอนเปิดรายการ ไม่เก็บลง SQLite (เบอร์ไม่ติดไปกับไฟล์ export และไม่ค้างเก่าเมื่อแก้เบอร์บน server)
// ตาราง registers ไม่มีเบอร์ — server อ่านจาก RegisterContacts แบบเดียวกับหน้าธรรมยาตราของแอดมิน
// เทสต์อยู่ที่ utils/__tests__/registerContacts.test.js

/** ต้องตรงกับ BusRegisterController::CONTACTS_MAX_IDS ฝั่ง server */
export const CONTACTS_BATCH_SIZE = 300;
export const CONTACTS_TIMEOUT_MS = 15_000;
export const CONTACTS_PATH = '/lpr/registers/contacts';

/** ลำดับที่แสดง — คนขับก่อน เพราะอยู่กับรถ */
export const CONTACT_ROLES = [
  { key: 'driver', label: 'คนขับ' },
  { key: 'leader', label: 'ผู้นำรถ' },
  { key: 'coord', label: 'ผู้ประสานงาน' },
];

/**
 * แบ่ง id เป็นชุดตาม project_id (โหมดธรรมยาตราหนึ่งกิจกรรมมีได้หลาย project) ชุดละไม่เกิน size
 * @param {{register_id:number, project_id:number}[]} rows
 * @returns {{project_id:number, ids:number[]}[]}
 */
export const chunkIdsByProject = (rows, size = CONTACTS_BATCH_SIZE) => {
  const byProject = new Map();
  for (const r of rows || []) {
    if (!r || r.register_id == null || r.project_id == null) continue;
    const list = byProject.get(r.project_id) || [];
    if (!list.includes(r.register_id)) list.push(r.register_id);
    byProject.set(r.project_id, list);
  }
  const out = [];
  for (const [project_id, ids] of byProject) {
    for (let i = 0; i < ids.length; i += size) out.push({ project_id, ids: ids.slice(i, i + size) });
  }
  return out;
};

/** เบอร์สำหรับ tel: — ตัดทุกอย่างที่ไม่ใช่ตัวเลขหรือ + (แบบเดียวกับหน้า /yatra) */
export const telNumber = (phone) => {
  const cleaned = String(phone ?? '').replace(/[^0-9+]/g, '');
  return cleaned.length >= 3 ? cleaned : null;
};

/**
 * แปลงผลจาก server ของใบหนึ่งเป็นบรรทัดที่แสดง — ข้ามบทบาทที่ไม่มีทั้งชื่อและเบอร์
 * @returns {{key:string, label:string, name:string|null, phone:string|null, tel:string|null}[]}
 */
export const contactLines = (contact) =>
  CONTACT_ROLES.map(({ key, label }) => {
    const c = contact?.[key] || {};
    const name = c.name ? String(c.name).trim() || null : null;
    const phone = c.phone ? String(c.phone).trim() || null : null;
    return { key, label, name, phone, tel: telNumber(phone) };
  }).filter((l) => l.name || l.phone);

/**
 * ดึงผู้ติดต่อของทุกใบใน rows — คืน object { [register_id]: contact }
 * ชุดใดล้มเหลวจะโยน error ออกไป (หน้าจอแสดงว่าดึงเบอร์ไม่ได้ ส่วนรายการรถยังใช้ได้ตามปกติ)
 */
export const fetchRegisterContacts = async ({ http, baseUrl, token, rows, seqNo = null }) => {
  const result = {};
  for (const { project_id, ids } of chunkIdsByProject(rows)) {
    const res = await http.get(`${baseUrl}${CONTACTS_PATH}`, {
      params: { project_id, seq_no: seqNo ?? '', ids: ids.join(',') },
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      timeout: CONTACTS_TIMEOUT_MS,
    });
    if (res?.data?.status !== 'success' || !Array.isArray(res.data.result)) {
      throw new Error(res?.data?.message || 'รูปแบบข้อมูลผู้ติดต่อไม่ถูกต้อง');
    }
    for (const c of res.data.result) {
      if (c && c.reg_id != null) result[c.reg_id] = c;
    }
  }
  return result;
};

// ─── ใครกำลังโทร + ผลการโทร ─────────────────────────────────────────────────
// ตาราง yatra_followups ร่วมกับหน้าธรรมยาตราของแอดมิน — กฎต้องตรงกับ LprFollowups (mbus_backend)
// และ YatraFollowups (mbus_app_backend): จองหมดเองใน 10 นาที, บันทึกผลแล้วปลดการจองให้เอง

/** ต้องตรงกับ LprFollowups::REASONS ฝั่ง server */
export const CALL_RESULTS = ['ติดต่อสำเร็จแล้ว', 'ไม่รับสาย', 'โทรไม่ติด', 'อื่นๆ'];
export const CALL_OK = 'ติดต่อสำเร็จแล้ว';
export const CALL_OTHER = 'อื่นๆ';

/** บันทึกผลได้ไหม — "อื่นๆ" ต้องมีหมายเหตุ */
export const canSaveFollowup = (reason, note) =>
  CALL_RESULTS.includes(reason) && (reason !== CALL_OTHER || !!String(note ?? '').trim());

/** เวลา "YYYY-MM-DD HH:MM:SS" (หรือ ISO) → "HH:MM" ; อ่านไม่ออก → '' */
export const hhmm = (value) => {
  const m = String(value ?? '').match(/[ T](\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
};

const followupRequest = (http, method, url, body, token) =>
  http.request({
    method,
    url,
    // DELETE ส่ง body ไม่ได้ทุก server — ใส่เป็น query แบบเดียวกับหน้าแอดมิน
    ...(method === 'delete' ? { params: body } : { data: body }),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    timeout: CONTACTS_TIMEOUT_MS,
  });

const target = (projectId, seqNo) => ({ project_id: projectId, seq_no: seqNo ?? null });

/** "ฉันจะโทรคันนี้" — คนอื่นจองอยู่ server ตอบ error พร้อมชื่อคนนั้น */
export const startCalling = ({ http, baseUrl, token, registerId, projectId, seqNo }) =>
  followupRequest(http, 'post', `${baseUrl}/lpr/registers/${registerId}/calling`, target(projectId, seqNo), token);

/** เลิกโทรโดยไม่บันทึกผล */
export const stopCalling = ({ http, baseUrl, token, registerId, projectId, seqNo }) =>
  followupRequest(http, 'delete', `${baseUrl}/lpr/registers/${registerId}/calling`, target(projectId, seqNo), token);

/** บันทึกผลการโทร (ปลดการจองให้เอง) */
export const saveFollowup = ({ http, baseUrl, token, registerId, projectId, seqNo, reason, note }) =>
  followupRequest(http, 'post', `${baseUrl}/lpr/registers/${registerId}/followup`, {
    ...target(projectId, seqNo),
    reason,
    note: String(note ?? '').trim() || null,
  }, token);

/** ข้อความ error จาก server (Laravel validation / business exception) สำหรับ Alert */
export const followupErrorMessage = (e) =>
  e?.response?.data?.message
  || (e?.response ? 'ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง' : 'ต่อ server ไม่ได้ ตรวจสอบอินเทอร์เน็ต');

// ─── อนุญาตพิมพ์ซ้ำจากเครื่อง (admin / officer / officer2 — 2026-11-27) ──────────
// สร้างสิทธิ์ใน lpr_reprint_grants แบบเดียวกับหน้าธรรมยาตรา → ค้นทะเบียนใหม่แล้วปุ่ม "ปริ้นใหม่" ขึ้น
// เครื่องไหนค้นทะเบียนนี้ก็ใช้สิทธิ์ได้ (1 สิทธิ์ = 1 ใบ หมดอายุสิ้นวันของงาน)

/** ต้องตรงกับ LprReprintGrant::REASONS (mbus_backend) และ YatraReprintGrants::REASONS (mbus_app_backend) */
export const REPRINT_REASONS = ['กระดาษหมด', 'พิมพ์ไม่ชัด', 'ใบชำรุด'];

/** session จาก getActiveSession() — server ตรวจ role ซ้ำทุกคำขอ ค่านี้ใช้แค่ซ่อน/แสดงเมนู */
export const canManageVehicles = (session) => Number(session?.can_manage) === 1;

/** POST /lpr/registers/{id}/reprint-grant */
export const grantReprint = ({ http, baseUrl, token, registerId, projectId, seqNo, reason }) =>
  followupRequest(http, 'post', `${baseUrl}/lpr/registers/${registerId}/reprint-grant`, {
    ...target(projectId, seqNo),
    reason,
  }, token);
