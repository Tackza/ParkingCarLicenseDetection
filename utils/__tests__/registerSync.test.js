// เทสต์ของ "ดึงใบ C7 ใหม่ทั้งหมด" (utils/registerSync.js)
//
// จำลอง server (/lpr/registers ส่งทีละ 200 แถว ใช้ cursor update_date + reg_id) และฐานข้อมูล
// ทั้งหมดรันบน Mac ไม่ต้องใช้เครื่องหรือ API จริง: npx jest utils/__tests__/registerSync.test.js

jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../../constants/Database', () => ({
  clearRegistersTable: jest.fn(),
  getActiveSession: jest.fn(),
  saveRegisters: jest.fn(),
}));

import axios from 'axios';
import { clearRegistersTable, getActiveSession, saveRegisters } from '../../constants/Database';
import {
  REGISTERS_PAGE_SIZE,
  fullResyncRegisters,
  registerLockOwner,
  releaseRegisterLock,
  tryAcquireRegisterLock,
} from '../registerSync';

const API = 'https://mbus-test.dhammakaya.network/api';
const PROJECT = 42;

// แถวหน้าตาเหมือนที่ Lpr/BusRegisterResource ส่งมา — เฉพาะฟิลด์ที่ cursor ใช้
const row = (id) => ({
  reg_id: id,
  proj_id: PROJECT,
  update_date: `2026-11-24T03:${String(Math.floor(id / 60) % 60).padStart(2, '0')}:${String(id % 60).padStart(2, '0')}.000000Z`,
});
const rows = (from, count) => Array.from({ length: count }, (_, i) => row(from + i));
const ok = (result) => ({ data: { status: 'success', result } });

const run = (extra = {}) =>
  fullResyncRegisters({ apiBaseUrl: API, projectId: PROJECT, ...extra });

beforeEach(() => {
  jest.clearAllMocks();
  getActiveSession.mockResolvedValue({ lpr_token: 'test-token' });
  saveRegisters.mockImplementation(async (list) => ({ saved: list.length, skipped: 0 }));
  clearRegistersTable.mockResolvedValue();
  // เทสต์ก่อนหน้าที่ล้มอาจทิ้งล็อกค้าง
  releaseRegisterLock('loop');
  releaseRegisterLock('resync');
});

describe('ล็อกร่วมกับลูปดึงใบ C7', () => {
  test('ถือได้ทีละคน และคนอื่นปล่อยแทนไม่ได้', () => {
    expect(tryAcquireRegisterLock('loop')).toBe(true);
    expect(tryAcquireRegisterLock('resync')).toBe(false);
    expect(registerLockOwner()).toBe('loop');

    releaseRegisterLock('resync'); // ไม่ใช่เจ้าของ → ต้องไม่ปล่อย
    expect(registerLockOwner()).toBe('loop');

    releaseRegisterLock('loop');
    expect(registerLockOwner()).toBe(null);
  });
});

describe('fullResyncRegisters', () => {
  test('หน้าเดียว (น้อยกว่า 200): ล้างแล้วบันทึก ส่งค่าที่ถูกต้องให้ server', async () => {
    axios.get.mockResolvedValueOnce(ok(rows(1, 3)));
    const progress = jest.fn();

    const result = await run({ onProgress: progress });

    expect(result).toEqual({ received: 3, saved: 3, skipped: 0, pages: 1 });
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.get).toHaveBeenCalledWith(`${API}/lpr/registers`, expect.objectContaining({
      // หน้าแรกไม่มี last_update → server ส่งเฉพาะแถวที่ยังไม่ถูกลบ
      params: { last_update: '', last_id: 0, project_id: PROJECT },
      headers: { Authorization: 'Bearer test-token' },
    }));
    expect(progress).toHaveBeenLastCalledWith(3);
    expect(clearRegistersTable).toHaveBeenCalledTimes(1);
    expect(saveRegisters).toHaveBeenCalledWith(rows(1, 3));
    expect(registerLockOwner()).toBe(null);
  });

  test('หลายหน้า: หน้าถัดไปใช้ cursor ของแถวสุดท้าย และบันทึกครั้งเดียวตอนครบ', async () => {
    const p1 = rows(1, REGISTERS_PAGE_SIZE);
    const p2 = rows(201, REGISTERS_PAGE_SIZE);
    const p3 = rows(401, 50);
    axios.get
      .mockResolvedValueOnce(ok(p1))
      .mockResolvedValueOnce(ok(p2))
      .mockResolvedValueOnce(ok(p3));
    const progress = jest.fn();

    const result = await run({ onProgress: progress });

    expect(result).toEqual({ received: 450, saved: 450, skipped: 0, pages: 3 });
    expect(axios.get.mock.calls.map((c) => c[1].params)).toEqual([
      { last_update: '', last_id: 0, project_id: PROJECT },
      { last_update: p1[199].update_date, last_id: 200, project_id: PROJECT },
      { last_update: p2[199].update_date, last_id: 400, project_id: PROJECT },
    ]);
    expect(progress.mock.calls.map((c) => c[0])).toEqual([200, 400, 450]);
    expect(saveRegisters).toHaveBeenCalledTimes(1);
    expect(saveRegisters).toHaveBeenCalledWith([...p1, ...p2, ...p3]);
  });

  test('ล้างข้อมูลเดิม "หลัง" ได้ครบทุกหน้า และก่อนบันทึก', async () => {
    const order = [];
    axios.get.mockImplementation(async () => {
      order.push('get');
      return ok(rows(1, 10));
    });
    clearRegistersTable.mockImplementation(async () => { order.push('clear'); });
    saveRegisters.mockImplementation(async (list) => {
      order.push('save');
      return { saved: list.length, skipped: 0 };
    });

    await run();

    expect(order).toEqual(['get', 'clear', 'save']);
  });

  test('ได้พอดี 200 แล้วหน้าถัดไปว่าง: หยุดที่ 200', async () => {
    axios.get
      .mockResolvedValueOnce(ok(rows(1, REGISTERS_PAGE_SIZE)))
      .mockResolvedValueOnce(ok([]));

    const result = await run();

    expect(result.received).toBe(200);
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  test('เน็ตหลุดกลางทาง: ข้อมูลเดิมไม่ถูกล้าง และปล่อยล็อก', async () => {
    axios.get
      .mockResolvedValueOnce(ok(rows(1, REGISTERS_PAGE_SIZE)))
      .mockRejectedValueOnce(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));

    await expect(run()).rejects.toThrow('Network Error');

    expect(clearRegistersTable).not.toHaveBeenCalled();
    expect(saveRegisters).not.toHaveBeenCalled();
    expect(registerLockOwner()).toBe(null);
  });

  test('server ตอบ status ไม่ใช่ success: ไม่ล้างข้อมูล', async () => {
    axios.get.mockResolvedValueOnce({ data: { status: 'error', message: 'boom' } });

    await expect(run()).rejects.toThrow('server ตอบผิดรูปแบบ');
    expect(clearRegistersTable).not.toHaveBeenCalled();
  });

  test('result ไม่ใช่ array: ไม่ล้างข้อมูล', async () => {
    axios.get.mockResolvedValueOnce({ data: { status: 'success', result: null } });

    await expect(run()).rejects.toThrow('server ตอบผิดรูปแบบ');
    expect(clearRegistersTable).not.toHaveBeenCalled();
  });

  test('หน้าเต็มแต่แถวสุดท้ายไม่มี cursor: หยุด ไม่วนไม่จบ', async () => {
    const page = rows(1, REGISTERS_PAGE_SIZE);
    page[199] = { reg_id: 200, proj_id: PROJECT }; // ไม่มี update_date
    axios.get.mockResolvedValueOnce(ok(page));

    await expect(run()).rejects.toThrow('update_date');
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(clearRegistersTable).not.toHaveBeenCalled();
  });

  test('server ส่งหน้าเดิมซ้ำ (cursor ไม่ขยับ): หยุด ไม่วนไม่จบ', async () => {
    const page = rows(1, REGISTERS_PAGE_SIZE);
    axios.get.mockResolvedValue(ok(page));

    await expect(run()).rejects.toThrow('หน้าเดิมซ้ำ');
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(clearRegistersTable).not.toHaveBeenCalled();
  });

  test('ไม่มีกิจกรรม: ไม่เรียก server และไม่แตะล็อก', async () => {
    tryAcquireRegisterLock('loop');

    await expect(run({ projectId: null })).rejects.toThrow('ไม่พบกิจกรรม');

    expect(axios.get).not.toHaveBeenCalled();
    expect(registerLockOwner()).toBe('loop'); // ล็อกของลูปยังอยู่ ไม่ถูกแย่งหรือปล่อย
  });

  test('ไม่มี token: ไม่เรียก server และปล่อยล็อก', async () => {
    getActiveSession.mockResolvedValue(null);

    await expect(run()).rejects.toThrow('session');
    expect(axios.get).not.toHaveBeenCalled();
    expect(registerLockOwner()).toBe(null);
  });

  test('ข้อมูลบางแถวถูกข้ามตอนบันทึก: รายงานจำนวนที่ข้าม', async () => {
    axios.get.mockResolvedValueOnce(ok(rows(1, 5)));
    saveRegisters.mockResolvedValueOnce({ saved: 4, skipped: 1 });

    await expect(run()).resolves.toEqual({ received: 5, saved: 4, skipped: 1, pages: 1 });
  });

  test('ถือล็อกไว้ตลอดการดึง และปล่อยเมื่อเสร็จ', async () => {
    let ownerDuringGet;
    axios.get.mockImplementation(async () => {
      ownerDuringGet = registerLockOwner();
      return ok(rows(1, 1));
    });

    await run();

    expect(ownerDuringGet).toBe('resync');
    expect(registerLockOwner()).toBe(null);
  });
});

describe('รอลูปที่กำลังดึงอยู่ให้จบก่อน', () => {
  afterEach(() => jest.useRealTimers());

  test('ลูปถือล็อกอยู่: รอ แล้วเริ่มดึงทันทีที่ลูปปล่อย', async () => {
    jest.useFakeTimers();
    tryAcquireRegisterLock('loop');
    axios.get.mockResolvedValueOnce(ok(rows(1, 2)));

    const pending = run();
    await jest.advanceTimersByTimeAsync(1000);
    expect(axios.get).not.toHaveBeenCalled(); // ยังรออยู่ ไม่แทรกกลางรอบของลูป

    releaseRegisterLock('loop');
    await jest.advanceTimersByTimeAsync(300);

    await expect(pending).resolves.toMatchObject({ received: 2 });
    expect(registerLockOwner()).toBe(null);
  });

  test('ลูปไม่ปล่อยล็อกเกิน 30 วิ: ยกเลิก ไม่ล้างข้อมูล', async () => {
    jest.useFakeTimers();
    tryAcquireRegisterLock('loop');

    const pending = run();
    const assertion = expect(pending).rejects.toThrow('รอรอบดึงข้อมูลเดิมนานเกินไป');
    await jest.advanceTimersByTimeAsync(31000);
    await assertion;

    expect(axios.get).not.toHaveBeenCalled();
    expect(clearRegistersTable).not.toHaveBeenCalled();
    expect(registerLockOwner()).toBe('loop'); // ล็อกของลูปไม่ถูกแตะ
  });
});
