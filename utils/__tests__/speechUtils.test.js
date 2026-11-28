// เสียงอ่านทะเบียนหลังสแกน (utils/speechUtils.js) — expo-speech ถูกแทนด้วย fake
// npx jest utils/__tests__/speechUtils.test.js

import { buildScanAnnouncement, createSpokenPlate, speakAndWaitForStart } from '../speechUtils';

describe('buildScanAnnouncement', () => {
  test('อ่านทีละตัว ตามด้วยจังหวัด', () => {
    expect(createSpokenPlate('กค 583')).toBe('กอ ไก่ คอ ควาย ห้า แปด สาม');
    expect(buildScanAnnouncement('กค583', 'นนทบุรี', { found: true })).toBe(
      'ทะเบียน, กอ ไก่ คอ ควาย ห้า แปด สาม, นนทบุรี',
    );
  });

  test('ไม่พบ C7 และลงทะเบียนแล้ว ต่อท้ายประโยคเดียวกัน', () => {
    expect(buildScanAnnouncement('12', 'สงขลา', { found: false, hasDuplicate: true })).toBe(
      'ทะเบียน, หนึ่ง สอง, สงขลา, ลงทะเบียนแล้ว, ไม่พบซีเจ็ด',
    );
  });

  test('OCR อ่านไม่ได้', () => {
    expect(buildScanAnnouncement('', '', { found: false })).toBe(
      'ทะเบียน, ไม่พบทะเบียน, ไม่พบจังหวัด, ไม่พบซีเจ็ด',
    );
  });
});

describe('speakAndWaitForStart — รอให้เสียงออกก่อนแสดงรูป', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const fakeSpeech = () => {
    const s = { stop: jest.fn(), speak: jest.fn((text, opts) => { s.opts = opts; }) };
    return s;
  };
  const settled = async (p) => {
    let done = false;
    p.then(() => { done = true; });
    await Promise.resolve();
    return done;
  };

  test('ยังไม่ resolve จนกว่าเสียงเริ่ม (onStart)', async () => {
    const Speech = fakeSpeech();
    const p = speakAndWaitForStart(Speech, 'ทะเบียน', { language: 'th-TH' });
    expect(Speech.stop).toHaveBeenCalled();
    expect(Speech.speak).toHaveBeenCalledWith('ทะเบียน', expect.objectContaining({ language: 'th-TH' }));
    jest.advanceTimersByTime(1000);
    expect(await settled(p)).toBe(false);
    Speech.opts.onStart();
    expect(await settled(p)).toBe(true);
  });

  test('เสียงไม่ออกเลย → ปล่อยหลัง maxWaitMs ไม่ค้างหน้าสแกน', async () => {
    const Speech = fakeSpeech();
    const p = speakAndWaitForStart(Speech, 'x', {}, 1500);
    jest.advanceTimersByTime(1499);
    expect(await settled(p)).toBe(false);
    jest.advanceTimersByTime(1);
    expect(await settled(p)).toBe(true);
  });

  test('speak โยน error → resolve ทันที ไม่ reject', async () => {
    const Speech = { stop: jest.fn(), speak: jest.fn(() => { throw new Error('no tts'); }) };
    await expect(speakAndWaitForStart(Speech, 'x')).resolves.toBeUndefined();
  });

  test('onError ก็ปล่อยได้', async () => {
    const Speech = fakeSpeech();
    const p = speakAndWaitForStart(Speech, 'x');
    Speech.opts.onError(new Error('x'));
    expect(await settled(p)).toBe(true);
  });
});
