import { Alert, NativeModules, Platform } from 'react-native';
import { BluetoothEscposPrinter } from 'react-native-bluetooth-escpos-printer';

const { SunmiPrinter } = NativeModules;

/**
 * Receipt printing with two transports behind one call.
 *
 * On a SUNMI the built-in printer is driven through SUNMI's print service
 * (android/.../sunmi/SunmiPrinterModule.kt): the printer state is checked first, so an empty
 * paper roll or an open cover becomes a Thai error the operator sees instead of a slip that
 * silently never prints, and the call resolves only once the slip has actually come out.
 * Bluetooth does not need to be on.
 *
 * Everywhere else — another tablet with an external printer, or an APK built before the module
 * existed — it falls back to Bluetooth ESC/POS exactly as before.
 *
 * Errors from the SUNMI path carry a ready-to-show Thai `message` and a `code` such as
 * `PRINTER_4` (paper out) or `PRINTER_6` (cover open).
 */

/** What PrinterContext shows as the connected printer on a SUNMI. */
export const INNER_PRINTER_DEVICE = { name: 'เครื่องพิมพ์ในตัว (SUNMI)', address: 'sunmi-inner' };

/** Blank lines fed after the slip so it clears the tear bar. Matches the old '\r\n\r\n'. */
const FEED_LINES = 2;

// The service binds once per process; cache the answer so every print does not re-ask.
let innerAvailable = null;

export async function isInnerPrinterAvailable() {
  if (Platform.OS !== 'android' || !SunmiPrinter) return false;
  if (innerAvailable === null) {
    try {
      innerAvailable = await SunmiPrinter.isAvailable();
    } catch (e) {
      innerAvailable = false;
    }
  }
  return innerAvailable;
}

/** `{ ok, code, message }`, or null when there is no built-in printer to ask. */
export async function getInnerPrinterStatus() {
  if (!(await isInnerPrinterAvailable())) return null;
  return SunmiPrinter.getStatus();
}

/**
 * Holds the operator at a "printer not ready" prompt until the built-in printer is ready —
 * paper loaded, cover closed — or they cancel. Call it *before* saving a check-in that will be
 * printed, so an empty roll never produces a saved check-in without its slip.
 *
 * Resolves true when printing can go ahead, false when the operator cancelled (nothing saved).
 * Without a built-in printer it resolves true at once: Bluetooth cannot report paper state.
 */
export async function waitForPrinterReady() {
  for (;;) {
    let status = null;
    try {
      status = await getInnerPrinterStatus();
    } catch (e) {
      return true; // cannot ask — let the print itself report the failure
    }
    if (!status || status.ok) return true;

    const retry = await new Promise((resolve) =>
      Alert.alert(
        'เครื่องพิมพ์ไม่พร้อม',
        `${status.message}\nยังไม่ได้บันทึกข้อมูล แก้ไขแล้วกด "พิมพ์อีกครั้ง"`,
        [
          { text: 'ยกเลิก', style: 'cancel', onPress: () => resolve(false) },
          { text: 'พิมพ์อีกครั้ง', onPress: () => resolve(true) },
        ],
        { cancelable: false }
      )
    );
    if (!retry) return false;
  }
}

/**
 * Prints a receipt image — the base64 PNG from react-native-view-shot's captureRef.
 * Returns which transport printed it: 'sunmi' or 'bluetooth'.
 */
export async function printReceiptImage(base64) {
  if (await isInnerPrinterAvailable()) {
    await SunmiPrinter.printImage(base64, FEED_LINES);
    return 'sunmi';
  }

  // 520 is clamped by the library to its configured paper width (384 dots for 58 mm).
  await BluetoothEscposPrinter.printPic(base64, { width: 520, left: 0 });
  await BluetoothEscposPrinter.printerAlign(BluetoothEscposPrinter.ALIGN.CENTER);
  await BluetoothEscposPrinter.printText('\r\n\r\n', {});
  return 'bluetooth';
}
