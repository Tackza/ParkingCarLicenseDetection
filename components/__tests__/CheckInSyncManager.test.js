// เทสต์ลูปส่ง check-in ทั้งรอบ (components/CheckInSyncManager.js)
//
// render component จริง แต่จำลอง server (axios), ฐานข้อมูล, ไฟล์รูป และ timer
// แล้วเดินเวลาไป 5 วิ (INITIAL_SYNC_DELAY) ให้รอบแรกทำงานหนึ่งรอบ
// npx jest components/__tests__/CheckInSyncManager.test.js

import React from 'react';
import { act, create } from 'react-test-renderer';

jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('@/constants/Database', () => ({
  clearSession: jest.fn(),
  getActiveSession: jest.fn(),
  getUnsyncedCheckIns: jest.fn(),
  insertErrorLogThrottled: jest.fn(),
  markCheckInAsSynced: jest.fn(),
  markCheckInAsSyncedError: jest.fn(),
}));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('@/contexts/EnvironmentContext', () => ({ useEnvironment: () => ({ environment: 'test' }) }));
jest.mock('@/contexts/ProjectContext', () => ({
  useProject: () => ({ activeProject: { project_id: 12, activity_id: 34 } }),
}));
const mockRouter = { replace: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('expo-file-system', () => ({ getInfoAsync: jest.fn(), deleteAsync: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: 'jpeg' } }));
// BackgroundTimer บน Android = Handler.postDelayed ธรรมดา — ใช้ setTimeout (fake) แทนได้ตรงๆ
jest.mock('react-native-background-timer', () => ({
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
}));

import {
  clearSession,
  getActiveSession,
  getUnsyncedCheckIns,
  insertErrorLogThrottled,
  markCheckInAsSynced,
  markCheckInAsSyncedError,
} from '@/constants/Database';
import axios from 'axios';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import CheckInSyncManager from '../CheckInSyncManager';

const row = (id, extra = {}) => ({
  id,
  uid: `UID${id}`,
  project_id: 12,
  activity_id: 34,
  register_id: 100 + id,
  detect_plate_no: 'นข2628',
  detect_plate_province: 'สิงห์บุรี',
  plate_no: 'นข2628',
  plate_province: 'สิงห์บุรี',
  is_plate_manual: 0,
  bus_type: 'พัดลม',
  passenger: '0|0|0|0',
  mileage: null,
  sticker_no: '',
  note: null,
  comp_id: 3,
  ocr_connected: 1,
  latitude: null,
  longitude: null,
  seq_no: 0,
  printed: 1,
  created_at: '2026-11-24 09:15:00',
  created_by: 99,
  photo_path: null,
  ...extra,
});

const success = { status: 200, data: { status: 'success' } };
const httpError = (status, data) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } });
const offline = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });

/** ฟิลด์ที่ส่งไปในการเรียก axios.post ครั้งที่ n */
const sentFields = (n) => Object.fromEntries(axios.post.mock.calls[n][1]._parts);

// FormData ของ React Native เก็บฟิลด์ไว้ใน _parts — FormData ของ Node ใน jest ไม่มี
class RNFormData {
  constructor() { this._parts = []; }
  append(name, value) { this._parts.push([name, value]); }
}
const OriginalFormData = global.FormData;
beforeAll(() => { global.FormData = RNFormData; });
afterAll(() => { global.FormData = OriginalFormData; });

let renderer;
const runOneCycle = async () => {
  await act(async () => {
    renderer = create(<CheckInSyncManager />);
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(5000); // INITIAL_SYNC_DELAY
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => { });
  getActiveSession.mockResolvedValue({ lpr_token: 'tok' });
  insertErrorLogThrottled.mockResolvedValue();
  markCheckInAsSynced.mockResolvedValue();
  markCheckInAsSyncedError.mockResolvedValue();
  clearSession.mockResolvedValue();
  FileSystem.deleteAsync.mockResolvedValue();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
  console.log.mockRestore();
  jest.useRealTimers();
});

test('ส่งทีละแถว: สำเร็จ → 2, server ปฏิเสธ (422) → 4 แล้วส่งแถวถัดไปต่อ', async () => {
  getUnsyncedCheckIns.mockResolvedValue([row(1), row(2), row(3)]);
  axios.post
    .mockResolvedValueOnce(success)
    .mockRejectedValueOnce(httpError(422, { message: 'invalid', errors: { comp_id: ['required'] } }))
    .mockResolvedValueOnce(success);

  await runOneCycle();

  expect(axios.post).toHaveBeenCalledTimes(3);
  expect(axios.post.mock.calls[0][0]).toBe('https://mbus-test.dhammakaya.network/api/lpr/checkins');
  expect(axios.post.mock.calls[0][2].headers.Authorization).toBe('Bearer tok');
  expect(markCheckInAsSynced.mock.calls).toEqual([[1, 2], [3, 2]]);
  expect(markCheckInAsSyncedError).toHaveBeenCalledWith(2, '[422] invalid | comp_id: required', 4);
});

test('ออฟไลน์กลาง batch: แถวนั้นเป็น 3 และหยุด ไม่ยิงแถวที่เหลือ', async () => {
  getUnsyncedCheckIns.mockResolvedValue([row(1), row(2), row(3)]);
  axios.post.mockResolvedValueOnce(success).mockRejectedValueOnce(offline());

  await runOneCycle();

  expect(axios.post).toHaveBeenCalledTimes(2); // แถวที่ 3 ไม่ถูกยิง
  expect(markCheckInAsSynced).toHaveBeenCalledWith(1, 2);
  expect(markCheckInAsSyncedError).toHaveBeenCalledWith(2, 'Network Error', 3);
  expect(markCheckInAsSyncedError).toHaveBeenCalledTimes(1); // แถว 3 คงสถานะเดิม
});

test('server ล่ม (500): เป็น 3 แต่ส่งแถวถัดไปต่อ', async () => {
  getUnsyncedCheckIns.mockResolvedValue([row(1), row(2)]);
  axios.post.mockRejectedValueOnce(httpError(500, 'oops')).mockResolvedValueOnce(success);

  await runOneCycle();

  expect(axios.post).toHaveBeenCalledTimes(2);
  expect(markCheckInAsSyncedError).toHaveBeenCalledWith(1, '[500] oops', 3);
  expect(markCheckInAsSynced).toHaveBeenCalledWith(2, 2);
});

test('token หมดอายุ (401): คงไว้ที่ 3 หยุด batch ล้าง session และพาไปหน้า login', async () => {
  getUnsyncedCheckIns.mockResolvedValue([row(1), row(2)]);
  axios.post.mockRejectedValueOnce(httpError(401, { message: 'Unauthenticated.' }));

  await runOneCycle();

  expect(axios.post).toHaveBeenCalledTimes(1);
  expect(markCheckInAsSyncedError).toHaveBeenCalledWith(1, '[401] Unauthenticated.', 3);
  expect(clearSession).toHaveBeenCalled();
  expect(mockRouter.replace).toHaveBeenCalledWith('/login');
});

test('server ตอบว่า uid ซ้ำ ทั้งแบบ 422 และแบบ body: ถือว่าสำเร็จ', async () => {
  getUnsyncedCheckIns.mockResolvedValue([row(1), row(2)]);
  axios.post
    .mockRejectedValueOnce(httpError(422, { message: 'Duplicate entry' }))
    .mockResolvedValueOnce({ status: 200, data: { status: 'error', message: 'Check-in already exists' } });

  await runOneCycle();

  expect(markCheckInAsSynced.mock.calls).toEqual([[1, 2], [2, 2]]);
  expect(markCheckInAsSyncedError).not.toHaveBeenCalled();
});

test('body ตอบ error ที่ไม่ใช่ซ้ำ: เป็น 4', async () => {
  getUnsyncedCheckIns.mockResolvedValue([row(1)]);
  axios.post.mockResolvedValueOnce({ status: 200, data: { status: 'error', message: 'project closed' } });

  await runOneCycle();

  expect(markCheckInAsSyncedError).toHaveBeenCalledWith(1, 'project closed', 4);
});

test('ส่งพิกัดจากแถว: มีค่า → ส่งค่าจริง, ไม่มี → ส่งว่าง (ไม่ใช่ 0)', async () => {
  getUnsyncedCheckIns.mockResolvedValue([
    row(1, { latitude: 14.07, longitude: 100.6 }),
    row(2),
  ]);
  axios.post.mockResolvedValue(success);

  await runOneCycle();

  expect(sentFields(0)).toMatchObject({ lat: 14.07, long: 100.6 });
  expect(sentFields(1)).toMatchObject({ lat: '', long: '' });
});

test('มีรูป: ย่อ 400 px แนบเป็น photo_file แล้วลบไฟล์ย่อทิ้ง แม้ส่งไม่สำเร็จ', async () => {
  getUnsyncedCheckIns.mockResolvedValue([row(1, { photo_path: 'file:///cache/orig.jpg' })]);
  FileSystem.getInfoAsync.mockResolvedValue({ exists: true });
  ImageManipulator.manipulateAsync.mockResolvedValue({ uri: 'file:///cache/small.jpg' });
  axios.post.mockRejectedValueOnce(httpError(500, 'oops'));

  await runOneCycle();

  expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
    'file:///cache/orig.jpg',
    [{ resize: { width: 400 } }],
    expect.objectContaining({ compress: 0.7, format: 'jpeg' })
  );
  expect(sentFields(0).photo_file).toEqual({ uri: 'file:///cache/small.jpg', name: 'small.jpg', type: 'image/jpeg' });
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///cache/small.jpg', { idempotent: true });
  expect(FileSystem.deleteAsync).not.toHaveBeenCalledWith('file:///cache/orig.jpg', expect.anything());
});

test('รูปถูกลบจาก cache แล้ว: ยังส่งข้อมูลได้โดยไม่มีรูป และบันทึก PHOTO_MISSING', async () => {
  getUnsyncedCheckIns.mockResolvedValue([row(1, { photo_path: 'file:///cache/gone.jpg' })]);
  FileSystem.getInfoAsync.mockResolvedValue({ exists: false });
  axios.post.mockResolvedValueOnce(success);

  await runOneCycle();

  expect(sentFields(0)).not.toHaveProperty('photo_file');
  expect(markCheckInAsSynced).toHaveBeenCalledWith(1, 2);
  expect(insertErrorLogThrottled).toHaveBeenCalledWith(expect.objectContaining({ error_type: 'PHOTO_MISSING' }));
});

test('ไม่มี token: ไม่ยิงอะไรเลย', async () => {
  getActiveSession.mockResolvedValue(null);
  getUnsyncedCheckIns.mockResolvedValue([row(1)]);

  await runOneCycle();

  expect(axios.post).not.toHaveBeenCalled();
});

test('รอบถัดไปทำงานต่อหลัง 10 วิ', async () => {
  getUnsyncedCheckIns.mockResolvedValue([]);

  await runOneCycle();
  expect(getUnsyncedCheckIns).toHaveBeenCalledTimes(1);

  await act(async () => {
    await jest.advanceTimersByTimeAsync(10000); // SYNC_INTERVAL
  });
  expect(getUnsyncedCheckIns).toHaveBeenCalledTimes(2);
});
