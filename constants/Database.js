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
export const insertErrorLog = async (errorData) => {
  const db = await getDb();
  try {
    // ✅ แปลง error_message ให้เป็น string เสมอ
    let errorMessage = '';
    if (errorData.error_message) {
      if (typeof errorData.error_message === 'string') {
        errorMessage = errorData.error_message;
      } else if (errorData.error_message instanceof Error) {
        // ถ้าเป็น Error object ให้เอา message และ stack
        errorMessage = errorData.error_message.message || errorData.error_message.toString();
        if (errorData.error_message.stack) {
          errorMessage += `\n${errorData.error_message.stack}`;
        }
      } else if (typeof errorData.error_message === 'object') {
        // ถ้าเป็น object ให้แปลงเป็น JSON string
        try {
          errorMessage = JSON.stringify(errorData.error_message);
        } catch (e) {
          errorMessage = String(errorData.error_message);
        }
      } else {
        // กรณีอื่นๆ ให้แปลงเป็น string
        errorMessage = String(errorData.error_message);
      }
    }

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

export const saveProjects = async (projectsData) => {
  const db = await getDb();

  if (!Array.isArray(projectsData)) {
    console.error("saveProjects: projectsData is not an array", projectsData);
    return;
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

  } catch (error) {
    console.error("Error saving projects:", error);
    throw error; // ส่ง error ออกไปให้ส่วนอื่นจัดการต่อ
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

export const saveRegisters = async (registersData) => {
  const db = await getDb();;

  try {
    // ใช้ Transaction เพื่อให้การบันทึกข้อมูลทั้งหมดเกิดขึ้นพร้อมกัน
    // หากมี Error ระหว่างทาง ข้อมูลทั้งหมดจะถูกยกเลิก (rollback)
    await db.withTransactionAsync(async () => {
      for (const reg of registersData) {
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
            reg.uid,
            reg.reg_id,          // จาก JSON
            reg.proj_id,         // จาก JSON
            reg.code,            // จาก JSON
            reg.plate_no,
            reg.plate_province,
            reg.bus_type,
            reg.station,         // จาก JSON
            reg.province,        // จาก JSON
            reg.passenger,
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
            reg.chk_pno,         // จาก JSON
            reg.act1_pno,        // จาก JSON
            reg.act2_pno,        // จาก JSON
            reg.show_act2 || 0,  // จาก JSON
            reg.update_date,      // จาก JSON
            reg.delete_date,      // จาก JSON
          ]
        );
      }
    });
    console.log(`✅ Successfully saved/updated ${registersData.length} register records.`);
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
    // อ่าน appMode จาก settings
    const appMode = await getSetting('appMode');
    // เลือก field ที่จะใช้ใน WHERE
    const field = appMode == "true" ? 'project_id' : 'activity_id';
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
export const getUnsyncedCheckIns = async () => { // ต้องเป็น async
  const db = await getDb(); // เรียก getDb()
  try {
    const rows = await db.getAllAsync( // ใช้ getAllAsync โดยตรง
      `SELECT * FROM check_ins WHERE sync_status IN (0, 3);`
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
      `UPDATE check_ins SET sync_status = ?, sync_at = datetime('now', 'localtime') WHERE id = ?;`,
      [status, checkInId]
    );
    return result;
  } catch (error) {
    console.error(`Error marking check-in ${checkInId} as synced:`, error);
    throw error;
  }
};

export const markCheckInAsSyncedError = async (checkInId, errorMsg, status = 3) => {
  const db = await getDb(); // ✅ ใช้ getDb()
  try {
    const result = await db.runAsync( // ✅ ใช้ runAsync แทน db.transaction
      `UPDATE check_ins SET sync_status = ?, error_msg = ? WHERE id = ?;`,
      [status, errorMsg, checkInId]
    );
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
    const appMode = await getSetting('appMode');
    const field = appMode == "true" ? 'project_id' : 'activity_id';
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
    const appMode = await getSetting('appMode');
    // app mode is false to dharmmakaya mode
    // app mode is true to general mode
    // registers table only stores project_id; when in activity mode we need to join projects to filter by activity_id
    if (appMode === 'true') {
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
    const appMode = await getSetting('appMode');
    const field = appMode == "true" ? 'project_id' : 'activity_id';
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
    const appMode = await getSetting('appMode');
    const field = appMode == "true" ? 'project_id' : 'activity_id';
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
    const appMode = await getSetting('appMode');
    const field = appMode == "true" ? 'project_id' : 'activity_id';
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
    const appMode = await getSetting('appMode');
    const field = appMode == "true" ? 'project_id' : 'activity_id';
    // Count where sync_status is 2 (success)
    const sql = `SELECT COUNT(*) as count FROM check_ins WHERE ${field} = ? AND sync_status = 2`;
    const res = await db.getFirstAsync(sql, [id]);
    return res?.count || 0;
  } catch (error) {
    console.error('Error getting success checkins count for id:', error);
    return 0;
  }
};
