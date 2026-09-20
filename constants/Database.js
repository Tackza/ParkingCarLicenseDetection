// file: Database.js

import * as SQLite from 'expo-sqlite';
import 'react-native-get-random-values';

// 2. ค่อย Import uuid
import { ulid } from "ulid";

// 1. การเปิดฐานข้อมูลจะคืนค่าเป็น Promise
// เราจะเปิดมันแค่ครั้งเดียว แล้วนำไปใช้ในฟังก์ชันต่างๆ
const dbPromise = SQLite.openDatabaseAsync('LicensePlateReader.db');

// ✅ ฟังก์ชัน helper สำหรับดึง db instance ที่พร้อมใช้งาน
// ทุกฟังก์ชันที่ต้องการใช้ db จะเรียก getDb() ก่อน
const getDb = async () => {
  return await dbPromise;
};

/**
 * 🚀 Force WAL Checkpoint (Sync WAL to DB file)
 */
export const checkpointDatabase = async () => {
  const db = await getDb();
  try {
    // TRUNCATE mode writes all transactions from WAL to DB and truncates the WAL file
    await db.runAsync('PRAGMA wal_checkpoint(TRUNCATE);');
    console.log("✅ Database checkpointed successfully.");
  } catch (error) {
    console.error("❌ Error checkpointing database:", error);
  }
};

/**
 * 🚀 ตั้งค่าฐานข้อมูลและตาราง
 */
export const setupDatabase = async () => {
  const db = await getDb();
  try {
    // 1. ดึงเวอร์ชันปัจจุบันของฐานข้อมูล
    let { user_version } = await db.getFirstAsync('PRAGMA user_version');
    console.log(`Current DB version: ${user_version}`);
    // ใช้ execAsync สำหรับการรัน SQL หลายคำสั่งพร้อมกัน
    // Note: execAsync ใช้ transaction ภายใน ดังนั้นห้ามใช้ inside withTransactionAsync
    if (user_version < 1) {
      console.log("Migrating to version 1: Creating initial tables...");
      await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY NOT NULL,
        username TEXT UNIQUE,
        first_name TEXT,
        last_name TEXT,
        note TEXT
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        lpr_token TEXT,
        status TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
       CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS projects (
          id INTEGER PRIMARY KEY,
          project_id INTEGER NOT NULL,
          activity_id INTEGER,
          name TEXT NOT NULL,
          start_time TEXT,
          end_time TEXT,
          seq_no INTEGER,
          CONSTRAINT uq_project_activity UNIQUE (project_id, activity_id)
      );
      -- สร้าง Index สำหรับการค้นหาตามเวลา
      CREATE INDEX IF NOT EXISTS ix_projects_start_end_time ON projects(start_time, end_time);

      -- สร้างตาราง registers
      CREATE TABLE IF NOT EXISTS registers (
         id INTEGER PRIMARY KEY,
        uid TEXT NOT NULL,
        register_id INTEGER NOT NULL UNIQUE,
        project_id INTEGER NOT NULL,
        short_code TEXT NOT NULL,
        plate_no TEXT NOT NULL,
        plate_province TEXT NOT NULL,
        bus_type TEXT NOT NULL,
        station_name TEXT NOT NULL,
        station_province TEXT NOT NULL,
        passenger TEXT NOT NULL,
        check_mileage INTEGER NOT NULL DEFAULT 0,
        note TEXT,
        alert_message TEXT,
        checkin_date TEXT,
        activity1_date TEXT,
        activity2_date TEXT,
        activity1_user TEXT,
        activity1_name varchar(100) null,
        activity2_user TEXT,
        checkin_printno INTEGER NOT NULL DEFAULT 0,
        activity1_printno INTEGER NOT NULL DEFAULT 0,
        activity2_printno INTEGER NOT NULL DEFAULT 0,
        show_activity2 INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      -- สร้าง Index
     CREATE INDEX IF NOT EXISTS ix_registers_project_plate ON registers(project_id, plate_no, plate_province);
      CREATE INDEX IF NOT EXISTS ix_registers_updated_at ON registers(updated_at, register_id);

      CREATE TABLE IF NOT EXISTS check_ins (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
          uid TEXT  NOT NULL,
          project_id INTEGER NOT NULL,
          activity_id INTEGER,
          seq_no INTEGER,
          register_id INTEGER,
          detect_plate_no TEXT NOT NULL,
          detect_plate_province TEXT NOT NULL,
          plate_no TEXT NOT NULL,
          plate_province TEXT NOT NULL,
          is_plate_manual INTEGER NOT NULL DEFAULT 0,
          photo_path TEXT,
          bus_type TEXT NOT NULL,
          passenger TEXT NOT NULL,
          mileage TEXT,
          sticker_no TEXT,
          note TEXT,
          comp_id INTEGER NOT NULL,
          printed INTEGER NOT NULL DEFAULT 0,
          sync_status INTEGER NOT NULL DEFAULT 0,
          sync_at TEXT,
          error_msg TEXT,
          ocr_connected INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
          created_by INTEGER NOT NULL
);

        -- สร้าง Index สำหรับคอลัมน์ sync_status เพื่อเร่งความเร็วในการค้นหาข้อมูลที่ยังไม่ถูก Sync
        CREATE INDEX IF NOT EXISTS ix_checkins_sync_status ON check_ins(sync_status);

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY NOT NULL,value TEXT);

        INSERT OR IGNORE INTO settings (key, value) VALUES ('environment', 'prod');
     
    `);
    }

    // ✅ Migration to version 2: Create error_logs table
    if (user_version < 2) {
      console.log("Migrating to version 2: Creating error_logs table...");
      await db.execAsync(`
      CREATE TABLE IF NOT EXISTS error_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        comp_id INTEGER,
        error_type TEXT NOT NULL,
        error_message TEXT NOT NULL,
        error_code TEXT,
        page_name TEXT,
        action_name TEXT,
        user_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
      `);
      user_version = 2;
    }

    // ✅ Migration to version 3: Add mileage columns
    if (user_version < 3) {
      console.log("Migrating to version 3: Adding mileage columns to registers and check_ins...");
      try {
        // Check and add registers.activity1_checkmile and activity2_checkmile
        const regCols = await db.getAllAsync(`PRAGMA table_info('registers');`);
        const hasActivity1CheckMile = Array.isArray(regCols) && regCols.some(col => col.name === 'activity1_checkmile');
        const hasActivity2CheckMile = Array.isArray(regCols) && regCols.some(col => col.name === 'activity2_checkmile');

        if (!hasActivity1CheckMile) {
          await db.runAsync(`ALTER TABLE registers ADD COLUMN activity1_checkmile INTEGER NOT NULL DEFAULT 0;`);
          console.log("✅ Added column registers.activity1_checkmile");
        }

        if (!hasActivity2CheckMile) {
          await db.runAsync(`ALTER TABLE registers ADD COLUMN activity2_checkmile INTEGER NOT NULL DEFAULT 0;`);
          console.log("✅ Added column registers.activity2_checkmile");
        }

        // Check and add check_ins.mileage
        const ciCols = await db.getAllAsync(`PRAGMA table_info('check_ins');`);
        const hasMileage = Array.isArray(ciCols) && ciCols.some(col => col.name === 'mileage');
        if (!hasMileage) {
          await db.runAsync(`ALTER TABLE check_ins ADD COLUMN mileage TEXT;`);
          console.log("✅ Added column check_ins.mileage");
        }

        user_version = 3;
      } catch (e) {
        console.error('❌ Error during version 3 migration:', e);
        throw e;
      }
    }

    // ✅ Migration to version 4: Add bus_types column to projects (JSON string)
    if (user_version < 4) {
      console.log("Migrating to version 4: Adding bus_types column to projects...");
      try {
        const projCols = await db.getAllAsync(`PRAGMA table_info('projects');`);
        const hasBusTypes = Array.isArray(projCols) && projCols.some(col => col.name === 'bus_types');
        if (!hasBusTypes) {
          await db.runAsync(`ALTER TABLE projects ADD COLUMN bus_types TEXT;`);
          console.log("✅ Added column projects.bus_types");
        }
        user_version = 4;
      } catch (e) {
        console.error('❌ Error during version 4 migration:', e);
        throw e;
      }
    }

    // ✅ Migration to version 5: Add not_show_child_qty / not_show_novice_qty flags to projects
    if (user_version < 5) {
      console.log("Migrating to version 5: Adding not_show_child_qty / not_show_novice_qty to projects...");
      try {
        const projCols = await db.getAllAsync(`PRAGMA table_info('projects');`);
        const hasNotShowChild = Array.isArray(projCols) && projCols.some(col => col.name === 'not_show_child_qty');
        const hasNotShowNovice = Array.isArray(projCols) && projCols.some(col => col.name === 'not_show_novice_qty');
        if (!hasNotShowChild) {
          await db.runAsync(`ALTER TABLE projects ADD COLUMN not_show_child_qty INTEGER NOT NULL DEFAULT 0;`);
          console.log("✅ Added column projects.not_show_child_qty");
        }
        if (!hasNotShowNovice) {
          await db.runAsync(`ALTER TABLE projects ADD COLUMN not_show_novice_qty INTEGER NOT NULL DEFAULT 0;`);
          console.log("✅ Added column projects.not_show_novice_qty");
        }
        user_version = 5;
      } catch (e) {
        console.error('❌ Error during version 5 migration:', e);
        throw e;
      }
    }

    // ✅ Migration to version 6: Add show_slip_section_2 flag to projects
    // Default 1 = show (รักษาพฤติกรรมเดิม) ซ่อนเฉพาะเมื่อ API ส่ง false มา
    if (user_version < 6) {
      console.log("Migrating to version 6: Adding show_slip_section_2 to projects...");
      try {
        const projCols = await db.getAllAsync(`PRAGMA table_info('projects');`);
        const hasShowSlipSection2 = Array.isArray(projCols) && projCols.some(col => col.name === 'show_slip_section_2');
        if (!hasShowSlipSection2) {
          await db.runAsync(`ALTER TABLE projects ADD COLUMN show_slip_section_2 INTEGER NOT NULL DEFAULT 1;`);
          console.log("✅ Added column projects.show_slip_section_2");
        }
        user_version = 6;
      } catch (e) {
        console.error('❌ Error during version 6 migration:', e);
        throw e;
      }
    }

    // ✅ Migration to version 7: Add retry_count / next_retry_at to check_ins
    // ใช้ถอยเวลาการส่งซ้ำของแถวที่ server ปฏิเสธ แทนที่จะยิงซ้ำทุก 10 วินาทีไม่รู้จบ
    // next_retry_at = NULL หมายถึงส่งได้ทันที (ค่าเริ่มต้นของแถวเดิมทั้งหมด)
    if (user_version < 7) {
      console.log("Migrating to version 7: Adding retry_count / next_retry_at to check_ins...");
      try {
        const ciCols = await db.getAllAsync(`PRAGMA table_info('check_ins');`);
        const hasRetryCount = Array.isArray(ciCols) && ciCols.some(col => col.name === 'retry_count');
        const hasNextRetryAt = Array.isArray(ciCols) && ciCols.some(col => col.name === 'next_retry_at');

        if (!hasRetryCount) {
          await db.runAsync(`ALTER TABLE check_ins ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;`);
          console.log("✅ Added column check_ins.retry_count");
        }
        if (!hasNextRetryAt) {
          await db.runAsync(`ALTER TABLE check_ins ADD COLUMN next_retry_at TEXT;`);
          console.log("✅ Added column check_ins.next_retry_at");
        }

        user_version = 7;
      } catch (e) {
        console.error('❌ Error during version 7 migration:', e);
        throw e;
      }
    }

    // ✅ Migration to version 8: Seed appMode
    // ModeContext default isModeOne = true แต่ไม่เคยเขียนค่าลง settings จนกว่าจะกดสลับโหมดครั้งแรก
    // เครื่องที่ยังไม่เคยสลับจึงมี appMode = null ซึ่งทำให้ query ที่อ่านค่านี้เลือกคอลัมน์ผิด
    // INSERT OR IGNORE จึงเติมเฉพาะเครื่องที่ยังไม่มีค่า ไม่แตะเครื่องที่ตั้งเป็น 'false' อยู่
    if (user_version < 8) {
      console.log("Migrating to version 8: Seeding appMode setting...");
      try {
        await db.runAsync(
          `INSERT OR IGNORE INTO settings (key, value) VALUES ('appMode', 'true');`
        );
        user_version = 8;
      } catch (e) {
        console.error('❌ Error during version 8 migration:', e);
        throw e;
      }
    }

    // ✅ Additional safety check: Ensure error_logs table exists (for existing databases)
    // This handles cases where the database was created before version tracking was added
    try {
      const tableCheck = await db.getFirstAsync(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='error_logs';"
      );

      if (!tableCheck) {
        console.log("⚠️ error_logs table missing, creating now...");
        await db.execAsync(`
        CREATE TABLE IF NOT EXISTS error_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          comp_id INTEGER,
          error_type TEXT NOT NULL,
          error_message TEXT NOT NULL,
          error_code TEXT,
          page_name TEXT,
          action_name TEXT,
          user_id INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );
        `);
        console.log("✅ error_logs table created successfully.");
      }
    } catch (checkError) {
      console.error("Error checking/creating error_logs table:", checkError);
    }

    // ✅ Update database version
    if (user_version > 0) {
      await db.runAsync(`PRAGMA user_version = ${user_version};`);
    }

    console.log(`✅ Database version ${user_version} is ready.`);

    // ✅ เก็บกวาด error_logs ตอนเปิดแอป (ฟังก์ชันกลืน error เองแล้ว ไม่ทำให้ startup ล้ม)
    await pruneErrorLogs();
  } catch (error) {
    console.error("Error setting up database:", error);
  }
};

/**
 * 🚀 บันทึกข้อมูลการล็อกอิน (Session)
 * @param {object} loginData - ข้อมูลที่ได้จาก API
 */
export const saveSession = async (loginData) => {
  console.log('loginData :>> ', loginData);
  const db = await getDb();
  const { id, username, first_name, last_name, note, lpr_token } = loginData;

  try {
    // 1. ลบ session เก่าทั้งหมด
    await db.runAsync('DELETE FROM sessions;');

    // 2. เพิ่มหรืออัปเดตข้อมูล user (ใช้ runAsync)
    // REPLACE INTO = INSERT or REPLACE
    await db.runAsync(
      'REPLACE INTO users (id, username, first_name, last_name, note) VALUES (?, ?, ?, ?, ?);',
      [id, username, first_name, last_name, note]
    );

    // 3. เพิ่มข้อมูล session ใหม่
    await db.runAsync(
      'INSERT INTO sessions (user_id, lpr_token) VALUES (?, ?);',
      [id, lpr_token]
    );

    console.log("Session saved successfully for user:", username);
  } catch (error) {
    console.error("Error saving session:", error);
    // ส่ง error ออกไปเพื่อให้ส่วนที่เรียกใช้จัดการต่อได้
    throw error;
  }
};

/**
 * 🚀 ดึงข้อมูลเซสชันล่าสุดที่ยัง active อยู่
 * @returns {Promise<object|null>}
 */
export const getActiveSession = async () => {
  const db = await getDb();;
  try {
    // ใช้ getFirstAsync เพราะเราต้องการแค่แถวเดียว
    const session = await db.getFirstAsync(
      `SELECT s.*, u.username, u.first_name, u.last_name
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       ORDER BY s.created_at DESC
       LIMIT 1;`
    );
    // getFirstAsync จะคืนค่า object ถ้าพบ หรือ undefined ถ้าไม่พบ
    return session || null;
  } catch (error) {
    console.error("Error getting active session:", error);
    return null;
  }
};

/**
 * 🚀 ล้างข้อมูลเซสชันทั้งหมด (สำหรับ Logout)
 */
export const clearSession = async () => {
  const db = await getDb();;
  try {
    await db.runAsync('DELETE FROM sessions;');
    console.log("All sessions cleared.");
  } catch (error) {
    console.error("Error clearing sessions:", error);
  }
};

/**
 * 🚀 บันทึก Error Log
 * @param {object} errorData - ข้อมูล error ที่ต้องการบันทึก
 * @param {number} errorData.comp_id - รหัสเครื่อง
 * @param {string} errorData.error_type - ประเภท error (OCR_TIMEOUT, API_ERROR, DATABASE_ERROR, etc)
 * @param {string|object|Error} errorData.error_message - ข้อความ error (รองรับทุก type)
 * @param {string|number} errorData.error_code - error code เช่น ECONNABORTED, 404, 500
 * @param {string} errorData.page_name - หน้าที่เกิด error
 * @param {string} errorData.action_name - action ที่เกิด error
 * @param {number} errorData.user_id - user_id ที่เกิด error (optional)
 */
// ✅ แปลง error_message ทุกรูปแบบ (string / Error / object) ให้เป็น string
const normalizeErrorMessage = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error) {
    // ถ้าเป็น Error object ให้เอา message และ stack
    let message = value.message || value.toString();
    if (value.stack) message += `\n${value.stack}`;
    return message;
  }
  if (typeof value === 'object') {
    // ถ้าเป็น object ให้แปลงเป็น JSON string
    try {
      return JSON.stringify(value);
    } catch (e) {
      return String(value);
    }
  }
  // กรณีอื่นๆ ให้แปลงเป็น string
  return String(value);
};

export const insertErrorLog = async (errorData) => {
  const db = await getDb();
  try {
    // ✅ แปลง error_message ให้เป็น string เสมอ
    let errorMessage = normalizeErrorMessage(errorData.error_message);

    // ✅ จำกัดความยาวของ error_message ไม่ให้เกิน 5000 ตัวอักษร (ป้องกัน overflow)
    if (errorMessage.length > 5000) {
      errorMessage = errorMessage.substring(0, 4997) + '...';
    }

    // ✅ แปลง error_code ให้เป็น string เสมอ
    let errorCode = null;
    if (errorData.error_code !== null && errorData.error_code !== undefined) {
      errorCode = String(errorData.error_code);
    }

    const result = await db.runAsync(
      `INSERT INTO error_logs (
        comp_id, error_type, error_message, error_code, 
        page_name, action_name, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [
        errorData.comp_id || null,
        errorData.error_type || 'UNKNOWN_ERROR',
        errorMessage,
        errorCode,
        errorData.page_name || null,
        errorData.action_name || null,
        errorData.user_id || null
      ]
    );
    console.log('✅ Error log saved successfully:', {
      id: result.lastInsertRowId,
      type: errorData.error_type
    });
    return result;
  } catch (error) {
    console.error('❌ Error saving error log:', error);
    throw error;
  }
};

// ─── Error log throttling ────────────────────────────────────────────────────
// ลูป sync เขียน error ทุกแถวทุกรอบ (ทุก 10 วิ สำหรับ check-ins, 30 วิ สำหรับ registers)
// ออฟไลน์ค้างคิว 100 แถวคือหลายหมื่นแถวต่อชั่วโมง ทำให้ DB บวมและ log ที่มีประโยชน์จมหาย
// จึงยุบ error ที่ "เหมือนเดิม" ให้เหลือรอบละครั้งต่อช่วง cooldown แล้วแนบจำนวนที่ยุบไปด้วย
const ERROR_LOG_THROTTLE_MS = 5 * 60 * 1000; // 5 นาที
const ERROR_LOG_THROTTLE_MAX_KEYS = 200;     // กัน Map โตไม่จำกัดถ้าข้อความต่างกันทุกครั้ง
const errorLogThrottleState = new Map();

const buildErrorLogKey = (errorData) => {
  const message = normalizeErrorMessage(errorData?.error_message);
  return [
    errorData?.error_type || 'UNKNOWN_ERROR',
    errorData?.error_code ?? '',
    errorData?.page_name || '',
    errorData?.action_name || '',
    message.slice(0, 120),
  ].join('|');
};

/**
 * 🚀 บันทึก Error Log แบบจำกัดความถี่
 * ใช้กับ error ที่เกิดซ้ำได้ไม่จำกัด (ลูป sync / timer) เท่านั้น
 * error ที่เกิดจากการกระทำของผู้ใช้ครั้งเดียว ให้ใช้ insertErrorLog ตามปกติ
 * @param {object} errorData - รูปแบบเดียวกับ insertErrorLog
 * @param {number} throttleMs - ช่วง cooldown ของ error ที่เหมือนกัน (default 5 นาที)
 * @returns {Promise<object|null>} - null ถ้าถูกยุบรวม (ไม่ได้เขียนลง DB)
 */
export const insertErrorLogThrottled = async (errorData, throttleMs = ERROR_LOG_THROTTLE_MS) => {
  const key = buildErrorLogKey(errorData);
  const now = Date.now();
  const entry = errorLogThrottleState.get(key);

  if (entry && now - entry.lastLoggedAt < throttleMs) {
    entry.suppressedCount += 1;
    return null; // ยังอยู่ในช่วง cooldown — นับไว้เฉยๆ ไม่เขียนซ้ำ
  }

  const suppressedCount = entry?.suppressedCount || 0;

  if (!entry && errorLogThrottleState.size >= ERROR_LOG_THROTTLE_MAX_KEYS) {
    errorLogThrottleState.clear();
  }
  errorLogThrottleState.set(key, { lastLoggedAt: now, suppressedCount: 0 });

  // แนบจำนวนครั้งที่ถูกยุบไปตั้งแต่ log ล่าสุด เพื่อให้ยังประเมินความรุนแรงได้จาก log ที่ export
  const payload = suppressedCount > 0
    ? {
      ...errorData,
      error_message: `${normalizeErrorMessage(errorData?.error_message)}\n[ยุบรวม: เกิดซ้ำอีก ${suppressedCount} ครั้งตั้งแต่บันทึกครั้งก่อน]`,
    }
    : errorData;

  return insertErrorLog(payload);
};

/**
 * 🚀 ลบ Error Log เก่าทิ้ง (ไม่มีที่ไหนลบมาก่อน ตารางจึงโตไม่มีเพดาน)
 * เรียกครั้งเดียวตอนเปิดแอปจาก setupDatabase()
 * @param {number} maxAgeDays - เก็บย้อนหลังกี่วัน
 * @param {number} maxRows - เพดานจำนวนแถว (เก็บแถวใหม่สุดไว้)
 * @returns {Promise<number>} - จำนวนแถวที่ลบ
 */
export const pruneErrorLogs = async ({ maxAgeDays = 14, maxRows = 5000 } = {}) => {
  const db = await getDb();
  try {
    const byAge = await db.runAsync(
      `DELETE FROM error_logs WHERE created_at < datetime('now', 'localtime', ?);`,
      [`-${maxAgeDays} days`]
    );
    // id เป็น AUTOINCREMENT จึงเรียงตามเวลาอยู่แล้ว ใช้ PK index ได้เลย
    const byCount = await db.runAsync(
      `DELETE FROM error_logs WHERE id <= COALESCE((SELECT MAX(id) FROM error_logs), 0) - ?;`,
      [maxRows]
    );
    const removed = (byAge.changes || 0) + (byCount.changes || 0);
    if (removed > 0) {
      console.log(`🧹 Pruned ${removed} old error_logs rows.`);
    }
    return removed;
  } catch (error) {
    console.error('Error pruning error_logs:', error);
    return 0; // งานบำรุงรักษา ห้ามทำให้ startup ล้ม
  }
};


/**
 * 🚀 คอลัมน์ที่ใช้จำกัดขอบเขตข้อมูลตามโหมดที่ใช้งานอยู่
 * appMode 'true' = โหมดงานบุญ (อิง project_id), 'false' = โหมดธรรมยาตรา (อิง activity_id)
 *
 * ค่าที่ไม่รู้จัก (รวมถึง null) ต้อง fallback เป็น project_id ให้ตรงกับ ModeContext ที่ default
 * isModeOne = true เดิมทุกจุดเขียนว่า `appMode == "true" ? project_id : activity_id`
 * ซึ่ง fallback ไปทาง activity_id — เครื่องที่ยังไม่เคยกดสลับโหมดจะมี appMode = null
 * แล้ว UI บอกว่าโหมด 1 แต่ query กลับ filter ด้วย activity_id โดยรับค่า project_id เข้ามา
 * ผลคือตัวนับในหน้า Settings และประวัติในหน้าหลักผิดทั้งหมด
 * @returns {Promise<'project_id'|'activity_id'>}
 */
const getScopeField = async () => {
  const appMode = await getSetting('appMode');
  if (appMode !== 'false') return 'project_id';

  // ✅ โหมดธรรมยาตราอิง activity_id แต่ "โหมด" เป็นการตั้งค่าที่เครื่อง ส่วน activity_id
  //    เป็นคุณสมบัติของข้อมูลฝั่ง server ทั้งสองอย่างจึงไม่ตรงกันได้
  //    ถ้ากิจกรรมที่ active อยู่ไม่มี activity_id ต้องถอยไปใช้ project_id
  //    ไม่งั้น getScanHistory จะได้ id = null แล้ว return [] ทันที — หน้าแรกว่างเปล่าแบบเงียบๆ
  //    ทั้งที่ข้อมูลถูกบันทึกและถูกส่งขึ้น server เรียบร้อย
  const project = await getCurrentProject();
  return project?.activity_id != null ? 'activity_id' : 'project_id';
};

/**
 * 🚀 ค่าที่ต้องใช้คู่กับ getScopeField()
 * หน้าจอเป็นคนเลือก "ค่า" ส่วน query เป็นคนเลือก "คอลัมน์" — สองอย่างนี้ต้องมาจากกติกาเดียวกัน
 * เสมอ ไม่งั้นจะได้ WHERE activity_id = <project_id> แบบที่เคยเกิดมาแล้ว
 * @param {object|null} project - โปรเจกต์ที่ active อยู่ (จาก useProject หรือ getCurrentProject)
 * @returns {Promise<number|null>}
 */
export const getScopeId = async (project) => {
  if (!project) return null;
  const appMode = await getSetting('appMode');
  if (appMode === 'false' && project.activity_id != null) {
    return project.activity_id;
  }
  return project.project_id ?? null;
};

export const saveSetting = async (key, value) => {
  const db = await getDb();;
  try {
    // REPLACE INTO จะทำการ INSERT ถ้า key ยังไม่มี หรือ UPDATE ถ้า key มีอยู่แล้ว
    await db.runAsync('REPLACE INTO settings (key, value) VALUES (?, ?);', [key, value]);
  } catch (error) {
    console.error(`Error saving setting for key "${key}":`, error);
  }
};

export const getSetting = async (key) => {
  const db = await getDb();;
  try {
    const result = await db.getFirstAsync('SELECT value FROM settings WHERE key = ?;', [key]);
    return result?.value || null; // คืนค่า value หรือ null ถ้าไม่เจอ
  } catch (error) {
    console.error(`Error getting setting for key "${key}":`, error);
    return null;
  }
};

export const deleteSetting = async (key) => {
  const db = await getDb();;
  try {
    await db.runAsync('DELETE FROM settings WHERE key = ?;', [key]);
  } catch (error) {
    console.error(`Error deleting setting for key "${key}":`, error);
  }
};

const formatDateToLocalSqlite = (dateString) => {
  if (!dateString) return null;
  // Create Date object
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return dateString; // Invalid date, return original

  // Format to YYYY-MM-DD HH:MM:SS in Local Time
  // Use manual formatting to ensure consistency regardless of environment timezone if possible, 
  // but relying on system local time is usually what 'localtime' in sqlite expects.
  // A safe way to get local YYYY-MM-DD HH:MM:SS string:
  const pad = (n) => n < 10 ? '0' + n : n;
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

/**
 * 🚀 แทนที่รายการกิจกรรมทั้งหมดด้วยชุดที่ดึงมาจาก server
 * @returns {Promise<{saved: number, replaced: boolean}>} replaced = false แปลว่าไม่ได้แตะข้อมูลเดิม
 */
export const saveProjects = async (projectsData) => {
  const db = await getDb();

  if (!Array.isArray(projectsData)) {
    console.error("saveProjects: projectsData is not an array", projectsData);
    return { saved: 0, replaced: false };
  }

  // ✅ ห้ามลบของเดิมทิ้งเมื่อ API คืนมา 0 แถว
  //    เดิม [] ผ่านด่าน isArray แล้ววิ่งไป DELETE FROM projects ต่อ ปุ่ม "อัพเดทข้อมูลกิจกรรม"
  //    จึงลบกิจกรรมที่กำลังใช้งานอยู่ทิ้งทั้งหมดแล้วรายงานว่าสำเร็จ ผลคือ activeProject เป็น null
  //    ทันที — สแกนไม่ได้ และลูป sync ทั้งสองตัวหยุดทำงาน
  //    การคงข้อมูลเดิมไว้ปลอดภัยกว่ามาก เพราะ getCurrentProject() กรองด้วยช่วงเวลาอยู่แล้ว
  //    กิจกรรมที่หมดอายุจึงไม่ถูกหยิบมาใช้เองอยู่ดี
  if (projectsData.length === 0) {
    console.warn("saveProjects: got an empty list — keeping existing projects untouched.");
    return { saved: 0, replaced: false };
  }

  try {
    // ใช้ Transaction เพื่อให้การบันทึกข้อมูลทั้งหมดเกิดขึ้นพร้อมกัน
    // หากมี Error ระหว่างทาง ข้อมูลทั้งหมดจะถูกยกเลิก (rollback)
    await db.withTransactionAsync(async () => {
      console.log("Deleting all old projects from local DB...");
      await db.runAsync('DELETE FROM projects;');
      for (const project of projectsData) {

        // Normalize Date
        const startTime = formatDateToLocalSqlite(project.start_time);
        const endTime = formatDateToLocalSqlite(project.end_time);

        console.log(`Inserting project: ${project.project_id} - ${project.name}`);

        const busTypesJson = Array.isArray(project.bus_types)
          ? JSON.stringify(project.bus_types)
          : null;
        const notShowChildQty = project.not_show_child_qty ? 1 : 0;
        const notShowNoviceQty = project.not_show_novice_qty ? 1 : 0;
        // แสดงสลิปส่วนที่ 2 เป็นค่าเริ่มต้น ซ่อนเฉพาะเมื่อ API ส่ง false มาชัดเจน
        const showSlipSection2 = project.show_slip_section_2 === false ? 0 : 1;

        await db.runAsync(
          `INSERT INTO projects
            (project_id, activity_id, name, start_time, end_time, seq_no, bus_types, not_show_child_qty, not_show_novice_qty, show_slip_section_2)
           VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            project.project_id,
            project.activity_id,
            project.name,
            startTime,
            endTime,
            project.seq_no,
            busTypesJson,
            notShowChildQty,
            notShowNoviceQty,
            showSlipSection2
          ]
        );
      }
    });
    console.log(`Successfully saved ${projectsData.length} projects.`);

    // ✅ ตรวจสอบข้อมูลในฐานข้อมูลหลังจากบันทึก
    const allProjects = await db.getAllAsync('SELECT * FROM projects');
    console.log('📊 Current projects in DB:', JSON.stringify(allProjects, null, 2));

    return { saved: projectsData.length, replaced: true };
  } catch (error) {
    console.error("Error saving projects:", error);
    throw error; // ส่ง error ออกไปให้ส่วนอื่นจัดการต่อ
  }
};

/**
 * 🚀 กิจกรรมถัดไปที่ยังมาไม่ถึง (เรียงตามเวลาเริ่ม)
 * ใช้ตอบผู้ใช้ว่า "บันทึกแล้วแต่ยังไม่ถึงเวลา — กิจกรรมถัดไปเริ่มเมื่อไหร่"
 * แทนที่จะบอกแค่ว่าสำเร็จแล้วปล่อยให้งงว่าทำไมยังสแกนไม่ได้
 */
export const getNextUpcomingProject = async () => {
  const db = await getDb();
  try {
    const project = await db.getFirstAsync(
      `SELECT name, start_time, end_time FROM projects
        WHERE start_time > datetime('now', 'localtime')
        ORDER BY start_time ASC LIMIT 1;`
    );
    return project || null;
  } catch (error) {
    console.error('Error getting next upcoming project:', error);
    return null;
  }
};

export const getCurrentProject = async () => {
  const db = await getDb();
  try {
    // 1. Try to find a currently active project
    let project = await db.getFirstAsync(
      "SELECT * FROM projects WHERE datetime('now', 'localtime') BETWEEN start_time AND end_time LIMIT 1;"
    );

    if (project) {
      console.log("Found project:", project.name);
      if (typeof project.bus_types === 'string' && project.bus_types.length > 0) {
        try {
          project.bus_types = JSON.parse(project.bus_types);
        } catch (e) {
          console.warn("Failed to parse project.bus_types JSON; defaulting to []", e);
          project.bus_types = [];
        }
      } else {
        project.bus_types = [];
      }
      project.not_show_child_qty = project.not_show_child_qty === 1;
      project.not_show_novice_qty = project.not_show_novice_qty === 1;
      project.show_slip_section_2 = project.show_slip_section_2 === 1;
    } else {
      console.log("No active project found.");
    }

    return project || null;
  } catch (error) {
    console.error("Error getting current project:", error);
    return null; // คืนค่า null หากเกิดข้อผิดพลาด
  }
};

/**
 * 🚀 บันทึก/อัปเดตใบ C7 ที่ดึงมาจาก server
 *
 * ⚠️ กันแถวเสียแถวเดียวล้มทั้ง batch (poison pill)
 * cursor ของการ sync คำนวณจาก MAX(updated_at, register_id) ในตารางนี้เอง ถ้าทั้ง transaction
 * rollback เพราะแถวใดแถวหนึ่งผิด cursor จะไม่ขยับ แล้วดึงชุดเดิมซ้ำทุก 30 วินาทีตลอดไป
 * อาการที่ผู้ใช้เห็นคือ "ใบ C7 ไม่เพิ่มขึ้น" เฉยๆ โดยไม่มีสัญญาณอะไรเลย
 *
 * จึงแยกเป็นสองชั้น:
 *  1. ฟิลด์ NOT NULL ที่มีค่าแทนได้ → ใส่ค่าปริยายให้ (เดิมมี || 0 แค่ act1_mile/act2_mile/show_act2
 *     แต่ตก chk_pno/act1_pno/act2_pno ซึ่งเป็น NOT NULL เหมือนกัน — DEFAULT 0 ใน schema ไม่ช่วย
 *     เพราะ default ใช้เฉพาะตอนไม่ใส่คอลัมน์นั้นใน INSERT ไม่ใช่ตอน bind NULL เข้าไปตรงๆ)
 *  2. ฟิลด์ที่แทนไม่ได้ (reg_id / proj_id / update_date) และแถวที่ยัง insert ไม่ผ่าน → ข้ามแล้ว log
 *
 * @returns {Promise<{saved: number, skipped: number}>}
 */
export const saveRegisters = async (registersData) => {
  const db = await getDb();

  if (!Array.isArray(registersData)) {
    console.error("saveRegisters: registersData is not an array", registersData);
    return { saved: 0, skipped: 0 };
  }

  let saved = 0;
  const skipped = [];

  try {
    // ใช้ Transaction เพื่อให้การบันทึกข้อมูลทั้งหมดเกิดขึ้นพร้อมกัน
    await db.withTransactionAsync(async () => {
      for (const reg of registersData) {
        // ✅ สามฟิลด์นี้ใส่ค่าปลอมแทนไม่ได้:
        //    reg_id เป็นคีย์ของ REPLACE, proj_id ใช้จำกัดขอบเขต
        //    และ update_date คือ cursor ของ sync — ค่าปลอมจะทำให้ cursor เพี้ยนถาวร
        if (reg?.reg_id == null || reg?.proj_id == null || reg?.update_date == null) {
          skipped.push({
            reg_id: reg?.reg_id ?? null,
            reason: 'missing reg_id / proj_id / update_date',
          });
          continue;
        }

        try {
          // REPLACE INTO จะทำงานโดยอิงจาก UNIQUE constraint (ในที่นี้คือ register_id)
          await db.runAsync(
            `REPLACE INTO registers ( uid,
            register_id, project_id, short_code, plate_no, plate_province,
            bus_type, station_name, station_province, passenger, activity1_checkmile, activity2_checkmile, note,
            alert_message, checkin_date, activity1_date, activity2_date,
            activity1_user, activity1_name, activity2_user, checkin_printno, activity1_printno,
            activity2_printno, show_activity2, updated_at, deleted_at
          ) VALUES (?,?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [
              reg.uid ?? '',
              reg.reg_id,          // จาก JSON
              reg.proj_id,         // จาก JSON
              reg.code ?? '',      // จาก JSON
              reg.plate_no ?? '',
              reg.plate_province ?? '',
              reg.bus_type ?? '',
              reg.station ?? '',   // จาก JSON
              reg.province ?? '',  // จาก JSON
              reg.passenger ?? '',
              reg.act1_mile || 0,
              reg.act2_mile || 0,
              reg.note,
              reg.alert_msg,       // จาก JSON
              reg.chk_date,        // จาก JSON
              reg.act1_date,       // จาก JSON
              reg.act2_date,       // จาก JSON
              reg.act1_user,       // จาก JSON
              reg.act1_name,       // จาก JSON
              reg.act2_user,       // จาก JSON
              reg.chk_pno ?? 0,    // จาก JSON — NOT NULL
              reg.act1_pno ?? 0,   // จาก JSON — NOT NULL
              reg.act2_pno ?? 0,   // จาก JSON — NOT NULL
              reg.show_act2 || 0,  // จาก JSON
              reg.update_date,     // จาก JSON
              reg.delete_date,     // จาก JSON
            ]
          );
          saved++;
        } catch (rowError) {
          // ✅ ข้ามเฉพาะแถวที่มีปัญหา ที่เหลือใน batch ยังบันทึกต่อได้
          skipped.push({
            reg_id: reg.reg_id,
            reason: rowError?.message || String(rowError),
          });
        }
      }
    });

    console.log(`✅ Registers saved/updated: ${saved}, skipped: ${skipped.length}`);

    // บันทึกไว้ให้เห็นใน export เพราะไม่มี UI ไหนแสดงว่ามีใบ C7 ที่บันทึกไม่ได้
    if (skipped.length > 0) {
      console.warn('⚠️ Skipped registers:', skipped);
      insertErrorLogThrottled({
        comp_id: null,
        error_type: 'REGISTER_SAVE_SKIPPED',
        error_message:
          `ข้ามใบ C7 ที่บันทึกไม่ได้ ${skipped.length} จาก ${registersData.length} แถว: ` +
          JSON.stringify(skipped.slice(0, 10)),
        error_code: 'REGISTER_ROW_INVALID',
        page_name: 'Database.js',
        action_name: 'saveRegisters',
        user_id: null,
      }).catch(e => console.error('Failed to log error:', e));
    }

    return { saved, skipped: skipped.length };
  } catch (error) {
    // console.error("❌ Error saving registers:", error);
    throw error; // ส่ง error ออกไปเพื่อให้ส่วนที่เรียกใช้จัดการต่อได้
  }
};

export const findRegisterByPlate = async (projectId, plateNo, plateProvince) => {
  const db = await getDb();;
  try {
    // ใช้ getFirstAsync เพราะเราคาดหวังผลลัพธ์แค่ 1 แถว (หรือไม่มี)
    const register = await db.getFirstAsync(
      `SELECT * FROM registers 
       WHERE project_id = ? AND plate_no = ? AND plate_province = ? AND deleted_at IS NULL;`, // 🔄 แก้ไขตรงนี้
      [projectId, plateNo, plateProvince]
    );
    return register || null;
  } catch (error) {
    console.error("Error finding register by plate:", error);
    return null;
  }
};


export const getLastRegisterSyncState = async (projectId) => {
  const db = await getDb();;
  try {
    // เรียงลำดับจาก update_date ล่าสุด และ register_id ล่าสุดเผื่อมีเวลาซ้ำกัน
    let sql = 'SELECT updated_at, register_id FROM registers';
    const params = [];

    if (projectId) {
      sql += ' WHERE project_id = ?';
      params.push(projectId);
    }

    sql += ' ORDER BY updated_at DESC, register_id DESC LIMIT 1;';

    const lastRegister = await db.getFirstAsync(sql, params);

    if (lastRegister) {
      return {
        // ✅ และแก้ไขตรงนี้ด้วย
        last_update: lastRegister.updated_at,
        last_id: lastRegister.register_id,
      };
    }
    return null; // คืนค่า null ถ้าตารางยังว่างอยู่
  } catch (error) {
    console.error("Error getting last register sync state:", error);
    return null;
  }
};

// ใน constants/Database.js

export const getScanHistory = async (id, searchQuery = '') => {
  if (!id) {
    console.log("getScanHistory ถูกเรียกใช้โดยไม่มี id.");
    return [];
  }

  const db = await getDb();
  try {
    // เลือก field ที่จะใช้ใน WHERE ตามโหมดที่ใช้งานอยู่
    const field = await getScopeField();
    let sql = `SELECT * FROM check_ins WHERE ${field} = ?`;
    const params = [id];

    const normalizedQuery = searchQuery.trim();
    if (normalizedQuery !== '') {
      sql += ' AND plate_no LIKE ?';
      params.push(`%${normalizedQuery}%`);
    }
    sql += ' ORDER BY created_at DESC';
    if (normalizedQuery === '') {
      sql += ' LIMIT 5';
    }
    const history = await db.getAllAsync(sql, params);
    return history;
  } catch (error) {
    console.error("Error getting scan history:", error);
    return [];
  }
};

export const insertCheckIn = async (checkInData) => {
  const db = await getDb();
  const newId = ulid();
  try {
    // ใช้ runAsync แทน db.transaction สำหรับคำสั่งเดียว
    const result = await db.runAsync(
      `INSERT INTO check_ins (
         uid, project_id, register_id, activity_id, seq_no, detect_plate_no, detect_plate_province,
         plate_no, plate_province, is_plate_manual, photo_path, bus_type,
         passenger, mileage, sticker_no, note, comp_id, printed, error_msg, ocr_connected,
         created_by 
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        newId, // ลบขีดกลางออกจาก ULID
        checkInData.project_id,
        checkInData.register_id,
        checkInData.activity_id || null,
        checkInData.seq_no || null,
        checkInData.detect_plate_no,
        checkInData.detect_plate_province,
        checkInData.plate_no,
        checkInData.plate_province,
        checkInData.is_plate_manual,
        checkInData.photo_path,
        checkInData.bus_type,
        checkInData.passenger,
        (checkInData && (checkInData.chk_mile ?? checkInData.mileage)) ?? null,
        checkInData.sticker_no || null,
        checkInData.note || null,
        checkInData.comp_id,
        // checkInData.activity_seq_no || null, // ✅ activity_seq_no ควรเป็น null ถ้าไม่มีค่า
        checkInData.printed,
        checkInData.error_msg || null,
        checkInData.ocr_connected !== undefined ? checkInData.ocr_connected : 1, // ✅ Default to 1 if undefined
        checkInData.created_by,
      ]
    );

    console.log('✅ Insert result:', {
      lastInsertRowId: result.lastInsertRowId,
      changes: result.changes,
      newId: newId
    });

    // ตรวจสอบว่า insert สำเร็จจริงๆ
    if (!result.changes || result.changes === 0) {
      throw new Error('ไม่มีการเปลี่ยนแปลงในฐานข้อมูล (changes = 0)');
    }
    return result; // runAsync จะคืนค่าผลลัพธ์
  } catch (error) {
    console.error("❌ Error inserting check-in:", {
      errorMessage: error.message,
      errorName: error.name,
      errorCode: error.code,
      sqliteError: error.toString(),
      stack: error.stack
    });

    // ✅ สร้าง error message ที่อ่านง่ายขึ้น
    let friendlyMessage = 'เกิดข้อผิดพลาดในการบันทึกข้อมูล';

    if (error.message.includes('UNIQUE constraint failed')) {
      friendlyMessage = 'ข้อมูลซ้ำ: มีการบันทึกข้อมูลนี้แล้ว';
    } else if (error.message.includes('NOT NULL constraint failed')) {
      const field = error.message.match(/check_ins\.(\w+)/)?.[1] || 'unknown';
      friendlyMessage = `ข้อมูลไม่ครบ: ต้องระบุ ${field}`;
    } else if (error.message.includes('no such table')) {
      friendlyMessage = 'ไม่พบตาราง check_ins ในฐานข้อมูล';
    } else if (error.message.includes('no such column')) {
      friendlyMessage = 'โครงสร้างฐานข้อมูลไม่ถูกต้อง';
    }

    // สร้าง error object ใหม่ที่มีข้อมูลครบถ้วน
    const detailedError = new Error(friendlyMessage);
    detailedError.originalError = error.message;
    detailedError.sqliteCode = error.code;

    throw detailedError;
  }
};

// ✅ ฟังก์ชัน: ดึง Check-in ที่ยังไม่ได้ Sync
// รวม sync_status = 4 ด้วย: เดิม 4 ถูกตัดออกจากคิวถาวร ทำให้ error ที่แก้ได้เอง
// (เช่น 401 token หมดอายุ, 4xx ชั่วคราว) กลายเป็นข้อมูลสูญหายโดยไม่มีทางส่งซ้ำ
// จำกัดจำนวนต่อรอบเพื่อไม่ให้คิวที่ค้างมานาน (ออฟไลน์ทั้งวัน) ดึงมาทำทีเดียวเป็นพันแถว
// ข้ามแถวที่ยังอยู่ในช่วงถอยเวลา (next_retry_at อยู่ในอนาคต) — ดู markCheckInAsSyncedError
// เรียงแถวที่ยังไม่เคยลองส่ง (sync_status = 0) ขึ้นก่อนเสมอ แล้วค่อยตามด้วยแถวที่เคยล้มเหลว
// ถ้าเรียงตาม created_at อย่างเดียว แถวเก่าที่ server ปฏิเสธถาวรจะกินโควตาทั้ง batch
// จนการลงทะเบียนใหม่ไม่มีวันถูกส่งขึ้นไป
export const getUnsyncedCheckIns = async (limit = 50) => { // ต้องเป็น async
  const db = await getDb(); // เรียก getDb()
  try {
    const rows = await db.getAllAsync( // ใช้ getAllAsync โดยตรง
      `SELECT * FROM check_ins
         WHERE sync_status IN (0, 3, 4)
           AND (next_retry_at IS NULL OR next_retry_at <= datetime('now', 'localtime'))
         ORDER BY (sync_status != 0), created_at ASC
         LIMIT ?;`,
      [limit]
    );
    return rows;
  } catch (error) {
    console.error("Error getting unsynced check-ins:", error);
    return [];
  }
};

// ✅ ฟังก์ชัน: อัปเดต Check-in ให้เป็น Synced
export const markCheckInAsSynced = async (checkInId, status = 2) => { // ✅ ต้องเป็น async function
  const db = await getDb(); // ✅ ใช้ getDb()
  try {
    const result = await db.runAsync( // ✅ ใช้ runAsync แทน db.transaction
      // ล้าง error_msg ด้วย ไม่งั้นแถวที่เคยล้มเหลวแล้วส่งสำเร็จจะยังพก error เก่าติดไปใน export
      // และล้างสถานะถอยเวลา เพื่อให้ตัวเลขใน export สะท้อนว่าแถวนี้จบแล้วจริง
      `UPDATE check_ins
          SET sync_status = ?, sync_at = datetime('now', 'localtime'),
              error_msg = NULL, retry_count = 0, next_retry_at = NULL
        WHERE id = ?;`,
      [status, checkInId]
    );
    return result;
  } catch (error) {
    console.error(`Error marking check-in ${checkInId} as synced:`, error);
    throw error;
  }
};

/**
 * 🚀 อัปเดตสถานะการพิมพ์หลังพิมพ์จริงเสร็จ (หรือพิมพ์ไม่สำเร็จ)
 * check_ins.printed ถูกเขียนตอน insert ซึ่งเกิดก่อนสั่งพิมพ์ ถ้ากระดาษหมดหรือเครื่องพิมพ์หลุด
 * ค่าที่ส่งขึ้น server จะบอกว่าพิมพ์แล้วทั้งที่ผู้ใช้ไม่ได้รับสลิป
 * หมายเหตุ: ถ้าแถวถูก sync ไปแล้ว การแก้ตรงนี้จะไม่ย้อนไปแก้ที่ server (server dedupe ด้วย uid)
 * ในทางปฏิบัติการพิมพ์จบภายใน 1-2 วิ ขณะที่รอบ sync ห่าง 10 วิ จึงทันเกือบทุกครั้ง
 * ไม่ throw เพราะถูกเรียกจาก error path — ห้ามกลบ error ต้นทาง
 * @param {number} checkInId - check_ins.id
 * @param {boolean|number} printed
 */
export const updateCheckInPrintedStatus = async (checkInId, printed) => {
  if (!checkInId) return null;
  const db = await getDb();
  try {
    return await db.runAsync(
      `UPDATE check_ins SET printed = ? WHERE id = ?;`,
      [printed ? 1 : 0, checkInId]
    );
  } catch (error) {
    console.error(`Error updating printed status for check-in ${checkInId}:`, error);
    return null;
  }
};

// ตารางถอยเวลา (นาที) สำหรับการส่งซ้ำครั้งที่ 1, 2, 3, ... ครั้งหลังๆ ใช้ค่าสุดท้ายซ้ำไปเรื่อยๆ
// ไม่มีเพดานจำนวนครั้งโดยตั้งใจ: แถวจะไม่ถูกทิ้งถาวร เผื่อปัญหาถูกแก้ที่ฝั่ง server ภายหลัง
// แถวที่ค้างจึงเปลือง request จาก ~8,600 ครั้ง/วัน เหลือ ~5 ครั้ง/วัน
const SYNC_RETRY_BACKOFF_MINUTES = [1, 5, 15, 60, 180, 360];

export const markCheckInAsSyncedError = async (checkInId, errorMsg, status = 3) => {
  const db = await getDb(); // ✅ ใช้ getDb()
  try {
    // ✅ error ระดับเครือข่าย (status 3: ออฟไลน์ / timeout / 5xx / token หมดอายุ) ต้องไม่ถอยเวลา
    //    เพราะพอเน็ตกลับมาหรือ login ใหม่แล้วต้องส่งได้ทันทีในรอบถัดไป
    if (status !== 4) {
      return await db.runAsync(
        `UPDATE check_ins SET sync_status = ?, error_msg = ?, next_retry_at = NULL WHERE id = ?;`,
        [status, errorMsg, checkInId]
      );
    }

    // ✅ server ปฏิเสธ (4xx หรือ body ตอบ error) — ส่งซ้ำทันทีไม่มีประโยชน์ ให้ถอยเวลาเพิ่มขึ้นเรื่อยๆ
    const row = await db.getFirstAsync(
      'SELECT retry_count FROM check_ins WHERE id = ?;',
      [checkInId]
    );
    const nextRetryCount = (row?.retry_count || 0) + 1;
    const delayMinutes = SYNC_RETRY_BACKOFF_MINUTES[
      Math.min(nextRetryCount - 1, SYNC_RETRY_BACKOFF_MINUTES.length - 1)
    ];

    const result = await db.runAsync(
      `UPDATE check_ins
          SET sync_status = ?, error_msg = ?, retry_count = ?,
              next_retry_at = datetime('now', 'localtime', ?)
        WHERE id = ?;`,
      [status, errorMsg, nextRetryCount, `+${delayMinutes} minutes`, checkInId]
    );
    console.log(`⏳ Check-in ${checkInId} rejected (attempt ${nextRetryCount}); next retry in ${delayMinutes} min.`);
    return result;
  } catch (error) {
    console.error(`Error marking check-in ${checkInId} with sync error:`, error);
    throw error;
  }
}

// ใน constants/Database.js



/**
 * 🚀 ดึงข้อมูลทั้งหมดสำหรับ Export
 * @param {string|null} startDate - วันที่เริ่มต้น (format: 'YYYY-MM-DD') หรือ null สำหรับดึงข้อมูลทั้งหมด
 * @param {string|null} endDate - วันที่สิ้นสุด (format: 'YYYY-MM-DD') หรือ null สำหรับดึงข้อมูลทั้งหมด
 * @returns {Promise<{registers: Array, checkIns: Array}>}
 */
export const getAllDataForExport = async (startDate = null, endDate = null) => {
  const db = await getDb();
  try {
    let registersSql = 'SELECT * FROM registers';
    let checkInsSql = 'SELECT * FROM check_ins';
    const registersParams = [];
    const checkInsParams = [];

    // ถ้ามีการระบุช่วงวันที่
    if (startDate && endDate) {
      // กรอง registers ตาม updated_at (หรือ checkin_date ถ้าต้องการ)
      registersSql += ' WHERE DATE(updated_at) BETWEEN ? AND ?';
      registersParams.push(startDate, endDate);

      // กรอง check_ins ตาม created_at
      checkInsSql += ' WHERE DATE(created_at) BETWEEN ? AND ?';
      checkInsParams.push(startDate, endDate);
    } else if (startDate) {
      // กรองตั้งแต่วันที่ระบุจนถึงปัจจุบัน
      registersSql += ' WHERE DATE(updated_at) >= ?';
      registersParams.push(startDate);

      checkInsSql += ' WHERE DATE(created_at) >= ?';
      checkInsParams.push(startDate);
    } else if (endDate) {
      // กรองตั้งแต่เริ่มต้นจนถึงวันที่ระบุ
      registersSql += ' WHERE DATE(updated_at) <= ?';
      registersParams.push(endDate);

      checkInsSql += ' WHERE DATE(created_at) <= ?';
      checkInsParams.push(endDate);
    }

    // เพิ่ม ORDER BY
    registersSql += ' ORDER BY updated_at DESC';
    checkInsSql += ' ORDER BY created_at DESC';

    const registers = await db.getAllAsync(registersSql, registersParams);
    const checkIns = await db.getAllAsync(checkInsSql, checkInsParams);

    console.log(`📦 Export: ${registers.length} registers, ${checkIns.length} check-ins`);
    if (startDate || endDate) {
      console.log(`📅 Date range: ${startDate || 'beginning'} to ${endDate || 'now'}`);
    }

    return { registers, checkIns };
  } catch (error) {
    console.error("Error getting all data for export:", error);
    throw error;
  }
};

export const clearRegistersTable = async () => {
  const db = await getDb();
  try {
    await db.runAsync('DELETE FROM registers;');
    console.log("All data in registers table cleared.");
  } catch (error) {
    console.error("Error clearing registers table:", error);
    throw error;
  }
};

/**
 * 🚀 จำนวน check_ins ที่ยังส่งไม่สำเร็จ "ทั้งเครื่อง" (ไม่จำกัดโปรเจกต์/กิจกรรม)
 * ตัวนับในหน้า Settings จำกัดขอบเขตตามโปรเจกต์ที่ active อยู่ จึงใช้เตือนตอนสลับ
 * environment หรือ logout ไม่ได้ — ต้องรู้ยอดค้างทั้งหมดจริงๆ
 */
export const getTotalUnsyncedCheckInsCount = async () => {
  const db = await getDb();
  try {
    const res = await db.getFirstAsync(
      'SELECT COUNT(*) as count FROM check_ins WHERE sync_status IN (0, 3, 4);'
    );
    return res?.count || 0;
  } catch (error) {
    console.error('Error getting total unsynced check-ins count:', error);
    return 0;
  }
};

/**
 * 🚀 ล้างตาราง projects
 * ใช้ตอนสลับ environment: project_id / activity_id ของ prod กับ test เป็นคนละชุด
 * ถ้าไม่ล้าง getCurrentProject() จะคืนโปรเจกต์ของอีก server มาใช้กับ token ใหม่
 */
export const clearProjectsTable = async () => {
  const db = await getDb();
  try {
    await db.runAsync('DELETE FROM projects;');
    console.log("All data in projects table cleared.");
  } catch (error) {
    console.error("Error clearing projects table:", error);
    throw error;
  }
};

export const getRegistersCount = async () => {
  const db = await getDb();
  try {
    const result = await db.getFirstAsync('SELECT COUNT(*) as count FROM registers');
    return result.count;
  } catch (error) {
    console.error("Error getting registers count:", error);
    return 0;
  }
};

/**
 * ดึงจำนวน check_ins โดยเลือก field ตามค่า appMode
 * ถ้า isModeOne === true จะกรองด้วย project_id = ?
 * ถ้า isModeOne === false จะกรองด้วย activity_id = ?
 * @param {number} id (project_id หรือ activity_id ขึ้นกับโหมด)
 */
export const getCheckInsCountForId = async (id) => {
  if (id === undefined || id === null) return 0;
  const db = await getDb();
  try {
    const field = await getScopeField();
    // Build SQL safely by using selected field name and parameterized id
    const sql = `SELECT COUNT(*) as count FROM check_ins WHERE ${field} = ?`;
    const res = await db.getFirstAsync(sql, [id]);
    return res?.count || 0;
  } catch (error) {
    console.error('Error getting checkins count for id with appMode:', error);
    return 0;
  }
};

/**
 * ดึงจำนวน registers ตาม project_id หรือ activity_id ขึ้นกับค่า appMode
 * ถ้าไม่มี currentId จะคืนค่า 0
 * @param {number} currentId
 */
export const getRegistersCountForId = async (currentId) => {
  if (!currentId && currentId !== 0) return 0;
  const db = await getDb();
  try {
    // app mode is false to dharmmakaya mode
    // app mode is true to general mode
    // registers table only stores project_id; when in activity mode we need to join projects to filter by activity_id
    const field = await getScopeField();
    if (field === 'project_id') {
      const res = await db.getFirstAsync('SELECT COUNT(*) as count FROM registers WHERE project_id = ? AND deleted_at IS NULL', [currentId]);
      return res?.count || 0;
    } else {
      // activity mode: find all project_ids that have this activity_id then count registers with those project_ids
      const projectRows = await db.getAllAsync('SELECT project_id FROM projects WHERE activity_id = ?', [currentId]);
      const projectIds = projectRows.map(r => r.project_id);
      if (projectIds.length === 0) return 0;
      // build placeholders
      const placeholders = projectIds.map(() => '?').join(',');
      const sql = `SELECT COUNT(*) as count FROM registers WHERE project_id IN (${placeholders}) AND deleted_at IS NULL`;
      const res = await db.getFirstAsync(sql, projectIds);
      return res?.count || 0;
    }
  } catch (error) {
    console.error('Error getting registers count for id:', error);
    return 0;
  }
};

/**
 * ดึงจำนวน check_ins ที่ยังไม่ Sync (sync_status IN (0, 3)) โดยเลือก field ตามค่า appMode
 * @param {number} id (project_id หรือ activity_id ขึ้นกับโหมด)
 */
export const getUnsyncedCheckInsCountForId = async (id) => {
  if (id === undefined || id === null) return 0;
  const db = await getDb();
  try {
    const field = await getScopeField();
    // Count where sync_status is 0 (pending) or 3 (error)
    const sql = `SELECT COUNT(*) as count FROM check_ins WHERE ${field} = ? AND sync_status = 3`;
    const res = await db.getFirstAsync(sql, [id]);
    return res?.count || 0;
  } catch (error) {
    console.error('Error getting unsynced checkins count for id:', error);
    return 0;
  }
};

/**
 * ดึงจำนวน check_ins ที่ยังไม่ได้ส่ง (sync_status IN (0, 3)) โดยเลือก field ตามค่า appMode
 * @param {number} id (project_id หรือ activity_id ขึ้นกับโหมด)
 */
export const getPendingSyncCheckInsCountForId = async (id) => {
  if (id === undefined || id === null) return 0;
  const db = await getDb();
  try {
    const field = await getScopeField();
    // Count where sync_status is 0 (pending) or 3 (error)
    const sql = `SELECT COUNT(*) as count FROM check_ins WHERE ${field} = ? AND sync_status IN (0, 3)`;
    const res = await db.getFirstAsync(sql, [id]);
    return res?.count || 0;
  } catch (error) {
    console.error('Error getting pending sync checkins count for id:', error);
    return 0;
  }
};

/**
 * ดึงจำนวน check_ins ที่พบปัญหา (sync_status = 4) โดยเลือก field ตามค่า appMode
 * @param {number} id (project_id หรือ activity_id ขึ้นกับโหมด)
 */
export const getSyncErrorCheckInsCountForId = async (id) => {
  if (id === undefined || id === null) return 0;
  const db = await getDb();
  try {
    const field = await getScopeField();
    // Count where sync_status is 4 (error/problem)
    const sql = `SELECT COUNT(*) as count FROM check_ins WHERE ${field} = ? AND sync_status = 4`;
    const res = await db.getFirstAsync(sql, [id]);
    return res?.count || 0;
  } catch (error) {
    console.error('Error getting sync error checkins count for id:', error);
    return 0;
  }
};

/**
 * ดึงจำนวน check_ins ที่สำเร็จ (sync_status = 2) โดยเลือก field ตามค่า appMode
 * @param {number} id (project_id หรือ activity_id ขึ้นกับโหมด)
 */
export const getSuccessCheckInsCountForId = async (id) => {
  if (id === undefined || id === null) return 0;
  const db = await getDb();
  try {
    const field = await getScopeField();
    // Count where sync_status is 2 (success)
    const sql = `SELECT COUNT(*) as count FROM check_ins WHERE ${field} = ? AND sync_status = 2`;
    const res = await db.getFirstAsync(sql, [id]);
    return res?.count || 0;
  } catch (error) {
    console.error('Error getting success checkins count for id:', error);
    return 0;
  }
};
