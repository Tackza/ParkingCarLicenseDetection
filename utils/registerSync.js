// file: utils/registerSync.js
//
// ล็อกร่วมของการดึงใบ C7 (registers) + "ดึงใหม่ทั้งหมด"
//
// มีคนเขียนตาราง registers สองทาง: ลูปทุก 10 วิใน (tabs)/_layout.js กับปุ่ม "ดึงใบ C7 ใหม่ทั้งหมด"
// ในหน้าตั้งค่า ทั้งสองต้องไม่ทำงานซ้อนกัน — เดิมปุ่มลบไม่ได้ดูล็อกเลย ถ้ากดตอนที่ลูปกำลังบันทึก
// แถวชุดนั้นจะถูกเขียนลงหลังการลบ เครื่องเห็นว่ามีข้อมูลล่าสุดแล้ว (cursor มาจากข้อมูลในตาราง)
// ส่วนที่เหลือจึงไม่ถูกดึงมาอีกเลย = รูถาวร

import axios from 'axios';
import { clearRegistersTable, getActiveSession, saveRegisters } from '../constants/Database';

/** server ส่งทีละกี่แถว (`->limit(200)` ใน Lpr/BusRegisterController@getUpdates) */
export const REGISTERS_PAGE_SIZE = 200;

// null | 'loop' | 'resync'
let lockOwner = null;

export const tryAcquireRegisterLock = (owner) => {
  if (lockOwner) return false;
  lockOwner = owner;
  return true;
};

export const releaseRegisterLock = (owner) => {
  if (lockOwner === owner) lockOwner = null;
};

export const registerLockOwner = () => lockOwner;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * ดึงใบ C7 ของโปรเจกต์ใหม่ทั้งหมด
 *
 * ดึงให้ครบทุกหน้าก่อน แล้วค่อยลบของเดิมและบันทึกชุดใหม่ — ถ้าเน็ตหลุดกลางทาง ข้อมูลเดิมยังอยู่ครบ
 * (วิธีเดิม "ลบก่อนแล้วรอลูปดึง" ทำให้เครื่องว่างระหว่างรอ และลูปดึงได้แค่ 200 แถวต่อ 10 วิ)
 *
 * @returns {{ received: number, saved: number, skipped: number, pages: number }}
 */
export async function fullResyncRegisters({ apiBaseUrl, projectId, onProgress }) {
  if (!projectId) throw new Error('ไม่พบกิจกรรมที่กำลังดำเนินอยู่');

  // รอรอบของลูปที่ค้างอยู่ให้จบก่อน (ปกติไม่กี่วินาที)
  const startedAt = Date.now();
  while (!tryAcquireRegisterLock('resync')) {
    if (Date.now() - startedAt > 30000) {
      throw new Error('รอรอบดึงข้อมูลเดิมนานเกินไป กรุณาลองใหม่อีกครั้ง');
    }
    await sleep(250);
  }

  try {
    const session = await getActiveSession();
    if (!session?.lpr_token) throw new Error('ไม่พบ session กรุณาเข้าสู่ระบบใหม่');

    // หน้าแรกไม่มี last_update → server ส่งเฉพาะแถวที่ยังไม่ถูกลบ
    // หน้าต่อไปใช้ cursor (update_date, reg_id) ของแถวสุดท้าย เหมือนที่ลูปทำ
    const rows = [];
    let lastUpdate = '';
    let lastId = 0;
    let pages = 0;
    for (;;) {
      const response = await axios.get(`${apiBaseUrl}/lpr/registers`, {
        params: { last_update: lastUpdate, last_id: lastId, project_id: projectId },
        headers: { Authorization: `Bearer ${session.lpr_token}` },
        timeout: 30000,
      });
      if (response.data?.status !== 'success' || !Array.isArray(response.data?.result)) {
        throw new Error(`server ตอบผิดรูปแบบ (status "${response.data?.status}")`);
      }

      const page = response.data.result;
      pages += 1;
      rows.push(...page);
      onProgress?.(rows.length);
      if (page.length < REGISTERS_PAGE_SIZE) break;

      const last = page[page.length - 1];
      if (!last?.update_date || last?.reg_id == null) {
        throw new Error('ข้อมูลจาก server ไม่มี update_date / reg_id ดึงหน้าถัดไปไม่ได้');
      }
      // กันวนไม่จบถ้า server ส่ง cursor เดิมซ้ำ
      if (last.update_date === lastUpdate && Number(last.reg_id) === lastId) {
        throw new Error('server ส่งข้อมูลหน้าเดิมซ้ำ หยุดเพื่อป้องกันการวนไม่จบ');
      }
      lastUpdate = last.update_date;
      lastId = Number(last.reg_id);
      if (pages > 1000) throw new Error('จำนวนหน้ามากผิดปกติ หยุดการดึงข้อมูล');
    }

    // ได้ครบทุกหน้าแล้ว ค่อยแทนที่ของเดิม
    await clearRegistersTable();
    const { saved, skipped } = await saveRegisters(rows);
    return { received: rows.length, saved, skipped, pages };
  } finally {
    releaseRegisterLock('resync');
  }
}
