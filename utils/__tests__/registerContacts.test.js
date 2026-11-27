// เบอร์ผู้ติดต่อของรถที่เหลือ (utils/registerContacts.js) — server ถูกแทนด้วย fake http
// npx jest utils/__tests__/registerContacts.test.js

import {
  CALL_RESULTS,
  REPRINT_REASONS,
  canManageVehicles,
  grantReprint,
  CONTACTS_PATH,
  canSaveFollowup,
  chunkIdsByProject,
  contactLines,
  fetchRegisterContacts,
  followupErrorMessage,
  hhmm,
  saveFollowup,
  startCalling,
  stopCalling,
  telNumber,
} from '../registerContacts';

describe('chunkIdsByProject', () => {
  test('แยกตาม project_id (โหมดธรรมยาตรามีหลาย project) และตัดซ้ำ', () => {
    const rows = [
      { register_id: 1, project_id: 10 },
      { register_id: 2, project_id: 20 },
      { register_id: 3, project_id: 10 },
      { register_id: 1, project_id: 10 },
    ];
    expect(chunkIdsByProject(rows)).toEqual([
      { project_id: 10, ids: [1, 3] },
      { project_id: 20, ids: [2] },
    ]);
  });

  test('แบ่งชุดละไม่เกิน size', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ register_id: i + 1, project_id: 5 }));
    expect(chunkIdsByProject(rows, 3).map((c) => c.ids)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });

  test('แถวที่ไม่มี project_id ถูกข้าม (ส่งไปก็ไม่รู้ว่าเป็นของ project ไหน)', () => {
    expect(chunkIdsByProject([{ register_id: 1, project_id: null }, null])).toEqual([]);
  });
});

describe('telNumber', () => {
  test('ตัดขีด เว้นวรรค วงเล็บ เหลือตัวเลขกับ +', () => {
    expect(telNumber('081-234 5678')).toBe('0812345678');
    expect(telNumber('+66 (81) 234-5678')).toBe('+66812345678');
  });
  test('ไม่มีตัวเลขพอ → null (ไม่ทำปุ่มโทร)', () => {
    expect(telNumber('ไม่มี')).toBeNull();
    expect(telNumber(null)).toBeNull();
  });
});

describe('contactLines', () => {
  test('เรียง คนขับ → ผู้นำรถ → ผู้ประสานงาน และข้ามบทบาทที่ว่าง', () => {
    const lines = contactLines({
      coord: { name: 'สมศรี', phone: '02-111-2222' },
      leader: { name: null, phone: null },
      driver: { name: 'สมชาย', phone: '081-234-5678' },
    });
    expect(lines.map((l) => [l.label, l.name, l.tel])).toEqual([
      ['คนขับ', 'สมชาย', '0812345678'],
      ['ผู้ประสานงาน', 'สมศรี', '021112222'],
    ]);
  });

  test('มีแต่ชื่อไม่มีเบอร์ → ยังแสดง แต่ไม่มีปุ่มโทร', () => {
    expect(contactLines({ driver: { name: 'สมชาย', phone: '' } })).toEqual([
      { key: 'driver', label: 'คนขับ', name: 'สมชาย', phone: null, tel: null },
    ]);
  });

  test('ยังไม่ได้โหลด / ไม่มีข้อมูล → ไม่มีบรรทัด', () => {
    expect(contactLines(undefined)).toEqual([]);
  });
});

describe('fetchRegisterContacts', () => {
  const ok = (result) => ({ data: { status: 'success', result } });

  test('ยิงทีละชุดตาม project พร้อม token และรวมผลเป็น {register_id: contact}', async () => {
    const http = {
      get: jest.fn(async (url, cfg) =>
        ok(cfg.params.ids.split(',').map((id) => ({ reg_id: Number(id), driver: { name: `d${id}`, phone: null } })))),
    };
    const result = await fetchRegisterContacts({
      http,
      baseUrl: 'https://x/api',
      token: 'T',
      rows: [{ register_id: 1, project_id: 10 }, { register_id: 2, project_id: 20 }],
    });
    expect(http.get).toHaveBeenCalledTimes(2);
    expect(http.get).toHaveBeenCalledWith(`https://x/api${CONTACTS_PATH}`, expect.objectContaining({
      params: { project_id: 10, seq_no: '', ids: '1' },
      headers: expect.objectContaining({ Authorization: 'Bearer T' }),
    }));
    expect(Object.keys(result)).toEqual(['1', '2']);
    expect(result[2].driver.name).toBe('d2');
  });

  test('ส่งรอบสแกน seq_no ไปด้วย (ผลการโทรแยกตามรอบ)', async () => {
    const http = { get: jest.fn(async () => ok([])) };
    await fetchRegisterContacts({ http, baseUrl: '', token: '', rows: [{ register_id: 1, project_id: 1 }], seqNo: 2 });
    expect(http.get.mock.calls[0][1].params.seq_no).toBe(2);
  });

  test('server ตอบไม่ใช่ success → โยน error ให้หน้าจอบอกว่าดึงเบอร์ไม่ได้', async () => {
    const http = { get: jest.fn(async () => ({ data: { status: 'error', message: 'nope' } })) };
    await expect(fetchRegisterContacts({ http, baseUrl: '', token: '', rows: [{ register_id: 1, project_id: 1 }] }))
      .rejects.toThrow('nope');
  });

  test('network error ส่งต่อออกไป', async () => {
    const http = { get: jest.fn(async () => { throw new Error('Network Error'); }) };
    await expect(fetchRegisterContacts({ http, baseUrl: '', token: '', rows: [{ register_id: 1, project_id: 1 }] }))
      .rejects.toThrow('Network Error');
  });

  test('ไม่มีรถเหลือ → ไม่ยิง API', async () => {
    const http = { get: jest.fn() };
    expect(await fetchRegisterContacts({ http, baseUrl: '', token: '', rows: [] })).toEqual({});
    expect(http.get).not.toHaveBeenCalled();
  });
});

describe('ใครกำลังโทร + ผลการโทร', () => {
  const base = { baseUrl: 'https://x/api', token: 'T', registerId: 31260, projectId: 345, seqNo: null };
  const fakeHttp = () => ({ request: jest.fn(async () => ({ data: { status: 'success' } })) });

  test('ผลการโทรตรงกับหน้าธรรมยาตรา (LprFollowups::REASONS)', () => {
    expect(CALL_RESULTS).toEqual(['ติดต่อสำเร็จแล้ว', 'ไม่รับสาย', 'โทรไม่ติด', 'อื่นๆ']);
  });

  test('"อื่นๆ" ต้องมีหมายเหตุ ; ผลอื่นไม่ต้อง ; ผลที่ไม่รู้จักบันทึกไม่ได้', () => {
    expect(canSaveFollowup('ไม่รับสาย', '')).toBe(true);
    expect(canSaveFollowup('อื่นๆ', '   ')).toBe(false);
    expect(canSaveFollowup('อื่นๆ', 'ฝากไลน์ไว้')).toBe(true);
    expect(canSaveFollowup('', 'x')).toBe(false);
    expect(canSaveFollowup('เล่นๆ', 'x')).toBe(false);
  });

  test('จองโทร = POST /lpr/registers/{id}/calling พร้อม project_id, seq_no และ token', async () => {
    const http = fakeHttp();
    await startCalling({ http, ...base });
    expect(http.request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'post',
      url: 'https://x/api/lpr/registers/31260/calling',
      data: { project_id: 345, seq_no: null },
      headers: expect.objectContaining({ Authorization: 'Bearer T' }),
    }));
  });

  test('เลิกโทร = DELETE ส่งค่าเป็น query (ไม่ใช่ body)', async () => {
    const http = fakeHttp();
    await stopCalling({ http, ...base, seqNo: 1 });
    const cfg = http.request.mock.calls[0][0];
    expect(cfg.method).toBe('delete');
    expect(cfg.params).toEqual({ project_id: 345, seq_no: 1 });
    expect(cfg.data).toBeUndefined();
  });

  test('บันทึกผล = POST /followup ตัดช่องว่าง หมายเหตุว่างส่ง null', async () => {
    const http = fakeHttp();
    await saveFollowup({ http, ...base, reason: 'ไม่รับสาย', note: '  ' });
    expect(http.request.mock.calls[0][0]).toEqual(expect.objectContaining({
      url: 'https://x/api/lpr/registers/31260/followup',
      data: { project_id: 345, seq_no: null, reason: 'ไม่รับสาย', note: null },
    }));
  });

  test('ข้อความ error: ใช้ของ server (เช่น "สมชาย กำลังโทรคันนี้อยู่") / ไม่มีเน็ต', () => {
    expect(followupErrorMessage({ response: { data: { message: 'สมชาย ใจดี กำลังโทรคันนี้อยู่' } } })).toBe('สมชาย ใจดี กำลังโทรคันนี้อยู่');
    expect(followupErrorMessage(new Error('Network Error'))).toMatch('อินเทอร์เน็ต');
  });

  test('hhmm อ่านเวลาจาก server', () => {
    expect(hhmm('2026-11-26 16:39:05')).toBe('16:39');
    expect(hhmm('2026-11-26T09:05:00.000Z')).toBe('09:05');
    expect(hhmm(null)).toBe('');
  });
});

describe('สิทธิ์จัดการรถ + อนุญาตพิมพ์ซ้ำ', () => {
  test('เห็นเมนูเฉพาะ can_manage = 1 (admin/officer/officer2) ; area หรือ session เก่า = ไม่เห็น', () => {
    expect(canManageVehicles({ can_manage: 1 })).toBe(true);
    expect(canManageVehicles({ can_manage: 0, role: 'area' })).toBe(false);
    expect(canManageVehicles({ role: 'admin' })).toBe(false); // ไม่เดาจาก role — ใช้ค่าที่ server บอก
    expect(canManageVehicles(null)).toBe(false);
  });

  test('เหตุผลตรงกับ server (LprReprintGrant::REASONS)', () => {
    expect(REPRINT_REASONS).toEqual(['กระดาษหมด', 'พิมพ์ไม่ชัด', 'ใบชำรุด']);
  });

  test('อนุญาต = POST /lpr/registers/{id}/reprint-grant พร้อมรอบสแกนและเหตุผล', async () => {
    const http = { request: jest.fn(async () => ({ data: { status: 'success' } })) };
    await grantReprint({ http, baseUrl: 'https://x/api', token: 'T', registerId: 9, projectId: 345, seqNo: 1, reason: 'กระดาษหมด' });
    expect(http.request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'post',
      url: 'https://x/api/lpr/registers/9/reprint-grant',
      data: { project_id: 345, seq_no: 1, reason: 'กระดาษหมด' },
      headers: expect.objectContaining({ Authorization: 'Bearer T' }),
    }));
  });
});
