import axios from 'axios';
import { NativeModules, Platform } from 'react-native';

const { LprOcr } = NativeModules;

/**
 * Licence-plate OCR with two engines behind one call.
 *
 * The native module (android/.../lpr/) runs the same two YOLO models the Cloud Run service
 * runs, on the device, in ~0.75 s and with no network at all. The service stays as a fallback
 * for anything the module cannot handle — iOS, an APK built before the module existed, or a
 * genuine failure inside it.
 *
 * Both engines return the identical shape, so callers do not branch on which one answered:
 *
 *     { data: { license_plate, province }, engine, timing }
 *
 * The server is authoritative about its own failures: when the fallback runs, its axios error
 * is rethrown untouched so the caller's existing timeout / 5xx / no-response handling still works.
 */

/** Flip to false to force every scan through the service (kill switch for a bad rollout). */
export const ON_DEVICE_OCR_ENABLED = true;

export const OCR_SERVICE_URL =
  'https://license-plate-service-833646348122.asia-southeast1.run.app/detect';

/** The service cold-starts in 20-27 s, so this timeout is a deliberate "give up and ask the operator". */
export const OCR_SERVER_TIMEOUT = 15000;

export function isOnDeviceOcrAvailable() {
  return Platform.OS === 'android' && !!LprOcr;
}

/**
 * Loads both models (~0.4 s on a SUNMI V3) so the first scan of the day does not pay for it.
 * Never throws — a warm-up failure just means the first detect() is slower, or falls back.
 */
export async function warmUpOnDeviceOcr() {
  if (!ON_DEVICE_OCR_ENABLED || !isOnDeviceOcrAvailable()) return null;
  try {
    const ms = await LprOcr.warmUp();
    console.log(`[lprOcr] on-device models loaded in ${ms} ms`);
    return ms;
  } catch (e) {
    console.log('[lprOcr] warm-up failed, will fall back to the service:', e?.message);
    return null;
  }
}

async function detectOnServer(uri) {
  const formData = new FormData();
  formData.append('image', { uri, type: 'image/jpeg', name: `image_${Date.now()}.jpg` });

  const response = await axios.post(OCR_SERVICE_URL, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: OCR_SERVER_TIMEOUT,
  });
  return { data: response.data.data, engine: 'server', timing: null };
}

/**
 * @param {string} uri  file:// or content:// URI of the photo
 * @returns {Promise<{data: {license_plate: ?string, province: ?string}, engine: string, timing: ?object}>}
 * @throws the axios error from the service when the on-device engine is unavailable or broken
 */
export async function detectPlate(uri) {
  if (ON_DEVICE_OCR_ENABLED && isOnDeviceOcrAvailable()) {
    try {
      const result = await LprOcr.detect(uri);

      if (result.success) {
        console.log(
          `[lprOcr] on-device ${result.data.license_plate} ${result.data.province} ` +
          `(${result.timing?.totalMs} ms: decode ${result.timing?.decodeMs}, ` +
          `s1 ${result.timing?.stage1Ms}, s2 ${result.timing?.stage2Ms})`
        );
        return { data: result.data, engine: 'ondevice', timing: result.timing };
      }

      // "No plate in this photo" is a real answer, not an engine failure — the service runs
      // the same weights and would say the same thing, so falling back would only cost the
      // operator a 15 s wait before the same manual-entry prompt.
      console.log(`[lprOcr] on-device found no plate: ${result.error}`);
      return {
        data: { license_plate: null, province: null },
        engine: 'ondevice',
        timing: result.timing,
      };
    } catch (e) {
      // The module itself broke (missing asset, corrupt model, OOM). Fall through to the service.
      console.log('[lprOcr] on-device engine failed, falling back to the service:', e?.message);
    }
  }

  return detectOnServer(uri);
}
