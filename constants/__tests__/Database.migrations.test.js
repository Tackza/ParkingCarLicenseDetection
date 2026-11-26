// เทสต์ migration ของฐานข้อมูลในเครื่อง (constants/Database.js setupDatabase) + insertCheckIn
//
// expo-sqlite เป็น native จึงรันใน jest ไม่ได้ — แทนด้วย node:sqlite (SQLite จริงที่มากับ Node 22)
// ผ่าน adapter ที่มี API เดียวกับที่ Database.js ใช้ ทุกคำสั่ง SQL ในการ migrate จึงถูกรันจริง
// แต่ละเทสต์ได้ฐานข้อมูลใหม่ในหน่วยความจำ (โหลด Database.js ใหม่ด้วย jest.isolateModules)
//
// npx jest constants/__tests__/Database.migrations.test.js

const LATEST_VERSION = 11;

jest.mock('expo-sqlite', () => {
  // process.getBuiltinModule ข้าม resolver ของ jest ซึ่งไม่รู้จัก node:sqlite
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const norm = (params) => {
    const list = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    return list.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
  };
  const plain = (row) => (row ? { ...row } : null);
  return {
    openDatabaseAsync: async () => {
      const sync = new DatabaseSync(':memory:');
      global.__testSqlite = sync; // ให้เทสต์เข้าไปจัดฐานข้อมูลตรงๆ ได้
      return {
        execAsync: async (sql) => { sync.exec(sql); },
        runAsync: async (sql, ...params) => {
          const r = sync.prepare(sql).run(...norm(params));
          return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
        },
        getFirstAsync: async (sql, ...params) => plain(sync.prepare(sql).get(...norm(params))),
        getAllAsync: async (sql, ...params) => sync.prepare(sql).all(...norm(params)).map(plain),
        withTransactionAsync: async (fn) => {
          sync.exec('BEGIN');
          try {
            await fn();
            sync.exec('COMMIT');
          } catch (e) {
            sync.exec('ROLLBACK');
            throw e;
          }
        },
      };
    },
  };
});

/** โหลด Database.js ใหม่ = ฐานข้อมูลใหม่ */
const freshDatabase = () => {
  let mod;
  jest.isolateModules(() => {
    mod = require('../Database');
  });
  return mod;
};

const raw = () => global.__testSqlite;
const version = () => raw().prepare('PRAGMA user_version').get().user_version;
const columns = (table) => raw().prepare(`PRAGMA table_info('${table}')`).all().map((c) => c.name);
const indexes = (table) => raw().prepare(`PRAGMA index_list('${table}')`).all().map((i) => i.name);
const setting = (key) => raw().prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;

const checkIn = (extra = {}) => ({
  project_id: 12,
  activity_id: 34,
  register_id: 5678,
  seq_no: 0,
  detect_plate_no: 'นข2628',
  detect_plate_province: 'สิงห์บุรี',
  plate_no: 'นข2628',
  plate_province: 'สิงห์บุรี',
  is_plate_manual: 0,
  photo_path: 'file:///cache/a.jpg',
  bus_type: 'พัดลม',
  passenger: '40|2|1|0',
  comp_id: 3,
  printed: 1,
  ocr_connected: 1,
  created_by: 99,
  ...extra,
});

/** ถอยฐานข้อมูลที่อัปเดตแล้วกลับไปเป็นสภาพของเวอร์ชันเก่า โดยเก็บข้อมูลแถวไว้ */
const downgradeTo = (v) => {
  const db = raw();
  if (v < 11) db.exec('DROP TABLE location_points');
  if (v < 10) {
    for (const c of ['latitude', 'longitude', 'location_accuracy']) db.exec(`ALTER TABLE check_ins DROP COLUMN ${c}`);
  }
  if (v < 9) {
    db.exec('DROP INDEX ix_checkins_project_created; DROP INDEX ix_checkins_activity_created;');
  }
  if (v < 8) db.exec("DELETE FROM settings WHERE key = 'appMode'");
  if (v < 7) {
    for (const c of ['retry_count', 'next_retry_at']) db.exec(`ALTER TABLE check_ins DROP COLUMN ${c}`);
  }
  db.exec(`PRAGMA user_version = ${v}`);
};

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => { });
});
afterEach(() => {
  console.log.mockRestore();
});

describe('ติดตั้งใหม่ (ฐานข้อมูลว่าง)', () => {
  test(`สร้างทุกตารางและขึ้นเป็น v${LATEST_VERSION}`, async () => {
    const db = freshDatabase();
    await db.setupDatabase();

    expect(version()).toBe(LATEST_VERSION);
    const tables = raw().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(
      ['users', 'sessions', 'settings', 'projects', 'registers', 'check_ins', 'error_logs', 'location_points']
    ));
  });

  test('check_ins มีคอลัมน์ของทุก migration', async () => {
    const db = freshDatabase();
    await db.setupDatabase();

    expect(columns('check_ins')).toEqual(expect.arrayContaining([
      'uid', 'sync_status', 'ocr_connected', // v1
      'retry_count', 'next_retry_at', // v7
      'latitude', 'longitude', 'location_accuracy', // v10
    ]));
    expect(columns('projects')).toEqual(expect.arrayContaining(
      ['bus_types', 'not_show_child_qty', 'not_show_novice_qty', 'show_slip_section_2'] // v4–v6
    ));
    expect(indexes('check_ins')).toEqual(expect.arrayContaining(
      ['ix_checkins_sync_status', 'ix_checkins_project_created', 'ix_checkins_activity_created'] // v1, v9
    ));
  });

  test('v8 ใส่ appMode = true (โหมดหนึ่ง) ไว้เสมอ', async () => {
    const db = freshDatabase();
    await db.setupDatabase();
    expect(setting('appMode')).toBe('true');
  });

  test('รันซ้ำได้ ไม่พัง ไม่เปลี่ยนอะไร (setupDatabase ถูกเรียกทุกครั้งที่เปิดแอป)', async () => {
    const db = freshDatabase();
    await db.setupDatabase();
    const before = columns('check_ins');
    await db.setupDatabase();
    expect(version()).toBe(LATEST_VERSION);
    expect(columns('check_ins')).toEqual(before);
  });
});

describe('อัปเกรดเครื่องที่มีข้อมูลอยู่แล้ว — ข้อมูลต้องไม่หาย', () => {
  const seedOldRows = async (db) => {
    await db.insertCheckIn(checkIn({ plate_no: 'กข1111' }));
    await db.insertCheckIn(checkIn({ plate_no: 'กข2222', seq_no: 1 }));
  };

  test.each([10, 9, 8, 7, 6])('v%i → v11', async (from) => {
    const db = freshDatabase();
    await db.setupDatabase();
    await seedOldRows(db);
    raw().exec("UPDATE settings SET value = 'false' WHERE key = 'appMode'"); // เครื่องนี้ตั้งโหมดสองไว้
    downgradeTo(from);
    if (from < 8) expect(setting('appMode')).toBeUndefined();

    await db.setupDatabase();

    expect(version()).toBe(LATEST_VERSION);
    expect(columns('check_ins')).toEqual(expect.arrayContaining(
      ['retry_count', 'next_retry_at', 'latitude', 'longitude', 'location_accuracy']
    ));
    expect(indexes('check_ins')).toEqual(expect.arrayContaining(
      ['ix_checkins_project_created', 'ix_checkins_activity_created']
    ));
    expect(indexes('location_points')).toContain('ix_location_points_sync');

    const rows = raw().prepare('SELECT * FROM check_ins ORDER BY id').all();
    expect(rows.map((r) => r.plate_no)).toEqual(['กข1111', 'กข2222']);
    expect(rows.map((r) => r.seq_no)).toEqual([0, 1]);
    expect(rows[0].latitude).toBeNull(); // แถวเก่าไม่มีพิกัด = NULL ไม่ใช่ 0
    expect(rows[0].retry_count).toBe(0);
    // v8 ใส่ appMode เฉพาะเมื่อยังไม่มี — ห้ามเขียนทับโหมดที่เครื่องตั้งไว้
    expect(setting('appMode')).toBe(from < 8 ? 'true' : 'false');
  });

  test('v7 ที่เคยสลับเป็นโหมดสองไว้แล้ว: v8 ต้องไม่เขียนทับเป็นโหมดหนึ่ง', async () => {
    const db = freshDatabase();
    await db.setupDatabase();
    downgradeTo(7);
    raw().exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('appMode', 'false')");

    await db.setupDatabase();

    expect(setting('appMode')).toBe('false');
  });

  test('v9 ที่มีคอลัมน์พิกัดอยู่แล้ว (migration ค้างครึ่งทาง): รันต่อได้ไม่ error', async () => {
    const db = freshDatabase();
    await db.setupDatabase();
    raw().exec('PRAGMA user_version = 9'); // คอลัมน์ v10 อยู่แล้ว แต่เวอร์ชันยังไม่ขยับ

    await expect(db.setupDatabase()).resolves.not.toThrow();
    expect(version()).toBe(LATEST_VERSION);
  });
});

describe('insertCheckIn — ค่าที่บันทึกลงเครื่อง', () => {
  const lastRow = () => raw().prepare('SELECT * FROM check_ins ORDER BY id DESC LIMIT 1').get();

  test('พิกัดตัวเลข (โหมดสอง) เก็บเป็นตัวเลข', async () => {
    const db = freshDatabase();
    await db.setupDatabase();
    await db.insertCheckIn(checkIn({ latitude: 14.0712345, longitude: 100.6012345, location_accuracy: 12.5 }));
    expect(lastRow()).toMatchObject({ latitude: 14.0712345, longitude: 100.6012345, location_accuracy: 12.5 });
  });

  test('พิกัดจาก route params โหมดหนึ่ง (สตริง) แปลงเป็นตัวเลข', async () => {
    const db = freshDatabase();
    await db.setupDatabase();
    await db.insertCheckIn(checkIn({ latitude: '14.07', longitude: '100.6', location_accuracy: '8' }));
    expect(lastRow()).toMatchObject({ latitude: 14.07, longitude: 100.6, location_accuracy: 8 });
  });

  test.each([[null], [undefined], [''], ['null'], ['undefined'], ['abc']])(
    'ไม่มีพิกัด (%p) → NULL ห้ามเป็น 0',
    async (value) => {
      const db = freshDatabase();
      await db.setupDatabase();
      await db.insertCheckIn(checkIn({ latitude: value, longitude: value, location_accuracy: value }));
      expect(lastRow()).toMatchObject({ latitude: null, longitude: null, location_accuracy: null });
    }
  );

  test('seq_no = 0 เก็บเป็น 0 ไม่ใช่ NULL, uid เป็น ULID, เริ่มที่ sync_status 0', async () => {
    const db = freshDatabase();
    await db.setupDatabase();
    const result = await db.insertCheckIn(checkIn({ seq_no: 0 }));
    expect(result.changes).toBe(1);
    const row = lastRow();
    expect(row.seq_no).toBe(0);
    expect(row.uid).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(row.sync_status).toBe(0);
  });

  test('mileage รับได้ทั้ง chk_mile (scan.js) และ mileage', async () => {
    const db = freshDatabase();
    await db.setupDatabase();
    await db.insertCheckIn(checkIn({ chk_mile: '12345' }));
    expect(lastRow().mileage).toBe('12345');
    await db.insertCheckIn(checkIn({ mileage: '678' }));
    expect(lastRow().mileage).toBe('678');
  });
});

describe('คิวส่งขึ้น server (getUnsyncedCheckIns / markCheckInAsSyncedError)', () => {
  const setRow = (id, sql) => raw().prepare(`UPDATE check_ins SET ${sql} WHERE id = ?`).run(id);

  test('แถวที่ยังไม่เคยส่ง (0) มาก่อนแถวที่ล้ม แล้วเรียงตามเวลาสร้าง', async () => {
    const db = freshDatabase();
    await db.setupDatabase();
    for (let i = 1; i <= 4; i++) await db.insertCheckIn(checkIn());
    setRow(1, "sync_status = 4, created_at = '2026-11-24 08:00:00'");
    setRow(2, "sync_status = 0, created_at = '2026-11-24 09:00:00'");
    setRow(3, "sync_status = 3, created_at = '2026-11-24 07:00:00'");
    setRow(4, "sync_status = 0, created_at = '2026-11-24 08:30:00'");

    const queue = await db.getUnsyncedCheckIns();
    expect(queue.map((r) => r.id)).toEqual([4, 2, 3, 1]);
  });

  test('ไม่หยิบแถวที่ส่งสำเร็จแล้ว (2) หรือยังไม่ถึงเวลาลองใหม่', async () => {
    const db = freshDatabase();
    await db.setupDatabase();
    for (let i = 1; i <= 3; i++) await db.insertCheckIn(checkIn());
    setRow(1, 'sync_status = 2');
    setRow(2, "sync_status = 4, next_retry_at = datetime('now', 'localtime', '+1 hour')");
    setRow(3, "sync_status = 4, next_retry_at = datetime('now', 'localtime', '-1 minute')");

    const queue = await db.getUnsyncedCheckIns();
    expect(queue.map((r) => r.id)).toEqual([3]);
  });

  test('จำกัดครั้งละ 50 แถว', async () => {
    const db = freshDatabase();
    await db.setupDatabase();
    for (let i = 0; i < 55; i++) await db.insertCheckIn(checkIn());
    expect(await db.getUnsyncedCheckIns()).toHaveLength(50);
  });

  test('server ปฏิเสธ (4): retry_count เพิ่ม และถอยเวลา 1 → 5 นาที', async () => {
    const db = freshDatabase();
    await db.setupDatabase();
    await db.insertCheckIn(checkIn());
    const minutesAhead = () => raw().prepare(
      "SELECT ROUND((julianday(next_retry_at) - julianday('now', 'localtime')) * 1440) AS m FROM check_ins WHERE id = 1"
    ).get().m;

    await db.markCheckInAsSyncedError(1, 'invalid', 4);
    expect(raw().prepare('SELECT sync_status, retry_count, error_msg FROM check_ins WHERE id = 1').get())
      .toEqual(expect.objectContaining({ sync_status: 4, retry_count: 1, error_msg: 'invalid' }));
    expect(minutesAhead()).toBe(1);

    await db.markCheckInAsSyncedError(1, 'invalid', 4);
    expect(raw().prepare('SELECT retry_count FROM check_ins WHERE id = 1').get().retry_count).toBe(2);
    expect(minutesAhead()).toBe(5);
  });

  test('เน็ต/server ล่ม (3): ไม่ถอยเวลา ส่งใหม่รอบหน้าทันที', async () => {
    const db = freshDatabase();
    await db.setupDatabase();
    await db.insertCheckIn(checkIn());
    setRow(1, "next_retry_at = datetime('now', 'localtime', '+1 hour')");

    await db.markCheckInAsSyncedError(1, 'Network Error', 3);

    const row = raw().prepare('SELECT sync_status, next_retry_at, retry_count FROM check_ins WHERE id = 1').get();
    expect(row).toEqual(expect.objectContaining({ sync_status: 3, next_retry_at: null, retry_count: 0 }));
    expect((await db.getUnsyncedCheckIns()).map((r) => r.id)).toEqual([1]);
  });
});

describe('เส้นทางเดิน (location_points, v11)', () => {
  const point = (extra = {}) => ({
    recorded_at: '2026-11-26 09:00:00', latitude: 14.07, longitude: 100.6, accuracy: 6,
    comp_id: '8012', user_id: 99, project_id: 12, activity_id: 34, ...extra,
  });

  test('บันทึก → อ่านคิวเก่าสุดก่อน → ทำเครื่องหมายส่งแล้ว → ไม่อยู่ในคิว', async () => {
    const db = freshDatabase();
    await db.setupDatabase();
    const a = await db.insertLocationPoint(point({ recorded_at: '2026-11-26 09:00:00' }));
    const b = await db.insertLocationPoint(point({ recorded_at: '2026-11-26 09:00:10' }));
    await db.insertLocationPoint(point({ recorded_at: '2026-11-26 09:00:20' }));

    expect((await db.getUnsyncedLocationPoints(2)).map((r) => r.id)).toEqual([a, b]);
    expect(await db.getUnsyncedLocationPointsCount()).toBe(3);

    expect(await db.markLocationPointsSynced([a, b])).toBe(2);
    expect(await db.getUnsyncedLocationPointsCount()).toBe(1);
    expect(await db.markLocationPointsSynced([])).toBe(0);
  });

  test('รหัสเครื่องเก็บเป็นข้อความ ว่าง = NULL, ค่าที่ไม่มี = NULL ไม่ใช่ 0', async () => {
    const db = freshDatabase();
    await db.setupDatabase();
    await db.insertLocationPoint(point({ comp_id: 8012, speed: undefined }));
    await db.insertLocationPoint(point({ comp_id: '  ', activity_id: undefined }));
    const rows = raw().prepare('SELECT * FROM location_points ORDER BY id').all();
    expect(rows[0].comp_id).toBe('8012');
    expect(rows[0].speed).toBeNull();
    expect(rows[1].comp_id).toBeNull();
    expect(rows[1].activity_id).toBeNull();
    expect(rows[0].sync_status).toBe(0);
  });

  test('ลบจุดเก่า: ส่งแล้วเกิน 2 วัน และทุกจุดที่เกิน 14 วัน — จุดที่ยังไม่ส่งภายใน 14 วันต้องอยู่', async () => {
    const db = freshDatabase();
    await db.setupDatabase();
    const ins = (status, daysAgo) => raw().prepare(
      `INSERT INTO location_points (recorded_at, latitude, longitude, sync_status, created_at)
       VALUES ('x', 14, 100, ?, datetime('now', 'localtime', ?))`
    ).run(status, `-${daysAgo} days`);
    ins(2, 1);   // ส่งแล้ว 1 วัน → อยู่
    ins(2, 3);   // ส่งแล้ว 3 วัน → ลบ
    ins(0, 3);   // ยังไม่ส่ง 3 วัน → อยู่ (รอ server)
    ins(0, 15);  // ยังไม่ส่ง 15 วัน → ลบ

    expect(await db.pruneLocationPoints()).toBe(2);
    const left = raw().prepare('SELECT sync_status FROM location_points ORDER BY id').all().map((r) => r.sync_status);
    expect(left).toEqual([2, 0]);
  });
});
