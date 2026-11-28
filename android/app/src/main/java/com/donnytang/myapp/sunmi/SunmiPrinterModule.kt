package com.donnytang.myapp.sunmi

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.sunmi.peripheral.printer.InnerPrinterCallback
import com.sunmi.peripheral.printer.InnerPrinterManager
import com.sunmi.peripheral.printer.InnerResultCallback
import com.sunmi.peripheral.printer.SunmiPrinterService
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The SUNMI built-in printer, driven through SUNMI's own print service instead of the
 * "InnerPrinter" virtual Bluetooth device.
 *
 * Exposed to JS as `NativeModules.SunmiPrinter`; [utils/printer.js] is the only caller and falls
 * back to Bluetooth ESC/POS on anything that is not a SUNMI. What this buys over Bluetooth:
 *  - the printer state (paper out, cover open, overheated) is checked before printing, so a slip
 *    is never silently lost;
 *  - the print runs as a transaction and the promise resolves only once the service reports the
 *    slip actually came out;
 *  - Bluetooth does not have to be on.
 */
class SunmiPrinterModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    // One print at a time; the service would interleave two transactions' output.
    private val executor = Executors.newSingleThreadExecutor()

    @Volatile private var service: SunmiPrinterService? = null
    @Volatile private var bindAttempted = false
    private var connected = CountDownLatch(1)

    private val callback = object : InnerPrinterCallback() {
        override fun onConnected(s: SunmiPrinterService) {
            service = s
            connected.countDown()
        }

        override fun onDisconnected() {
            // The service restarts on its own (e.g. after a firmware update); rebind lazily.
            service = null
            bindAttempted = false
            connected = CountDownLatch(1)
        }
    }

    override fun getName() = "SunmiPrinter"

    /** Must run off the UI thread: may wait up to [timeoutMs] for the service to bind. */
    private fun awaitService(timeoutMs: Long = 3000): SunmiPrinterService? {
        service?.let { return it }
        if (!Build.MANUFACTURER.equals("SUNMI", ignoreCase = true)) return null
        if (!bindAttempted) {
            bindAttempted = true
            val bound = try {
                InnerPrinterManager.getInstance().bindService(reactApplicationContext, callback)
            } catch (e: Throwable) {
                false
            }
            if (!bound) return null
        }
        connected.await(timeoutMs, TimeUnit.MILLISECONDS)
        return service
    }

    /** True only on a SUNMI whose print service is reachable and reports a printer. */
    @ReactMethod
    fun isAvailable(promise: Promise) {
        executor.execute {
            val s = awaitService()
            promise.resolve(
                s != null && try {
                    InnerPrinterManager.getInstance().hasPrinter(s)
                } catch (e: Throwable) {
                    false
                }
            )
        }
    }

    /**
     * Device serial number (the SN on the label), or "" when it cannot be read.
     *
     * Build.getSerial() needs READ_PRIVILEGED_PHONE_STATE on Android 10+, which a normal app
     * cannot hold. SUNMI exposes the same value as vendor properties that apps may read;
     * ro.serialno is tried last because SELinux usually blocks it for apps.
     * Synchronous properties only, so no executor; resolves a String (bridge-safe).
     */
    @ReactMethod
    fun getDeviceSerial(promise: Promise) {
        val keys = listOf("ro.sunmi.serial", "ro.sunmi.se.sn", "ro.serialno")
        val serial = try {
            val get = Class.forName("android.os.SystemProperties")
                .getMethod("get", String::class.java, String::class.java)
            keys.asSequence()
                .map { (get.invoke(null, it, "") as? String).orEmpty().trim() }
                .firstOrNull { it.isNotEmpty() && it != "unknown" }
        } catch (e: Throwable) {
            null
        }
        promise.resolve(serial.orEmpty())
    }

    /** `{ ok, code, message }` — `message` is Thai, ready to show the operator. */
    @ReactMethod
    fun getStatus(promise: Promise) {
        executor.execute {
            val s = awaitService()
            if (s == null) {
                promise.resolve(status(NO_SERVICE))
                return@execute
            }
            promise.resolve(status(readState(s)))
        }
    }

    /**
     * Prints a base64 PNG/JPEG (what react-native-view-shot returns), scaled down to the paper
     * width, then feeds [feedLines] blank lines so the slip clears the tear bar.
     *
     * Rejects with code `PRINTER_<state>` and a Thai message when the printer is not ready, and
     * with `PRINT_FAILED` when the service reports the job did not complete.
     */
    @ReactMethod
    fun printImage(base64: String, feedLines: Int, promise: Promise) {
        executor.execute {
            val s = awaitService()
            if (s == null) {
                promise.reject("PRINTER_UNAVAILABLE", message(NO_SERVICE))
                return@execute
            }
            val state = readState(s)
            if (state != STATE_OK) {
                promise.reject("PRINTER_$state", message(state))
                return@execute
            }

            val bitmap = try {
                decode(base64)?.let { fitToPaper(it, paperWidthPx(s)) }
            } catch (e: Throwable) {
                null
            }
            if (bitmap == null) {
                promise.reject("PRINT_BAD_IMAGE", "ไม่สามารถสร้างภาพใบเสร็จได้")
                return@execute
            }

            val settled = AtomicBoolean(false)
            val done = CountDownLatch(1)
            val result = object : InnerResultCallback() {
                override fun onRunResult(isSuccess: Boolean) = Unit
                override fun onReturnString(value: String?) = Unit

                override fun onRaiseException(code: Int, msg: String?) {
                    if (settled.compareAndSet(false, true)) {
                        promise.reject("PRINT_FAILED", "พิมพ์ไม่สำเร็จ ($code) ${msg.orEmpty()}".trim())
                        done.countDown()
                    }
                }

                // Transaction result: 0 = the slip was printed.
                override fun onPrintResult(code: Int, msg: String?) {
                    if (!settled.compareAndSet(false, true)) return
                    if (code == 0) {
                        promise.resolve(null)
                    } else {
                        // The job most often fails because the state changed mid-print
                        // (paper ran out); report that rather than the service's terse text.
                        val now = readState(s)
                        if (now != STATE_OK) promise.reject("PRINTER_$now", message(now))
                        else promise.reject("PRINT_FAILED", "พิมพ์ไม่สำเร็จ ($code) ${msg.orEmpty()}".trim())
                    }
                    done.countDown()
                }
            }

            try {
                s.enterPrinterBuffer(true)
                s.printerInit(null)
                s.setAlignment(ALIGN_CENTER, null)
                s.printBitmap(bitmap, null)
                s.lineWrap(feedLines.coerceIn(0, 10), null)
                s.exitPrinterBufferWithCallback(true, result)
            } catch (e: Throwable) {
                if (settled.compareAndSet(false, true)) {
                    promise.reject("PRINT_FAILED", e.message ?: e.toString(), e)
                }
                return@execute
            }

            // Keep the queue serial until this slip is out (or clearly not coming).
            if (!done.await(PRINT_TIMEOUT_S, TimeUnit.SECONDS) && settled.compareAndSet(false, true)) {
                promise.reject("PRINT_TIMEOUT", "เครื่องพิมพ์ไม่ตอบสนอง")
            }
            bitmap.recycle()
        }
    }

    private fun readState(s: SunmiPrinterService): Int =
        try {
            s.updatePrinterState()
        } catch (e: Throwable) {
            NO_SERVICE
        }

    private fun paperWidthPx(s: SunmiPrinterService): Int =
        try {
            if (s.printerPaper == PAPER_80MM) WIDTH_80MM else WIDTH_58MM
        } catch (e: Throwable) {
            WIDTH_58MM
        }

    private fun decode(base64: String): Bitmap? {
        val raw = base64.substringAfter("base64,", base64)
        val bytes = Base64.decode(raw, Base64.DEFAULT)
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    }

    private fun fitToPaper(src: Bitmap, width: Int): Bitmap {
        if (src.width <= width) return src
        val height = (src.height.toLong() * width / src.width).toInt()
        return Bitmap.createScaledBitmap(src, width, height, true).also { if (it !== src) src.recycle() }
    }

    private fun status(code: Int): WritableMap = Arguments.createMap().apply {
        putBoolean("ok", code == STATE_OK)
        putInt("code", code)
        putString("message", message(code))
    }

    private fun message(code: Int): String = when (code) {
        STATE_OK -> "เครื่องพิมพ์พร้อมใช้งาน"
        2 -> "เครื่องพิมพ์กำลังเตรียมพร้อม กรุณารอสักครู่"
        3 -> "เครื่องพิมพ์สื่อสารผิดปกติ"
        4 -> "กระดาษหมด กรุณาเติมกระดาษ"
        5 -> "หัวพิมพ์ร้อนเกินไป กรุณารอสักครู่"
        6 -> "ฝาเครื่องพิมพ์เปิดอยู่ กรุณาปิดฝา"
        7 -> "ใบมีดตัดกระดาษผิดปกติ"
        505 -> "ไม่พบเครื่องพิมพ์"
        507 -> "อัปเดตเฟิร์มแวร์เครื่องพิมพ์ไม่สำเร็จ"
        NO_SERVICE -> "เชื่อมต่อเครื่องพิมพ์ในตัวไม่ได้"
        else -> "เครื่องพิมพ์ผิดปกติ (รหัส $code)"
    }

    override fun invalidate() {
        super.invalidate()
        executor.execute {
            if (service != null) {
                try {
                    InnerPrinterManager.getInstance().unBindService(reactApplicationContext, callback)
                } catch (_: Throwable) {
                }
            }
        }
        executor.shutdown()
    }

    private companion object {
        // updatePrinterState() codes, per SUNMI's printer service documentation.
        const val STATE_OK = 1
        const val NO_SERVICE = -1

        const val ALIGN_CENTER = 1
        const val PAPER_80MM = 2          // getPrinterPaper(): 1 = 58 mm, 2 = 80 mm
        const val WIDTH_58MM = 384        // printable dots
        const val WIDTH_80MM = 576
        const val PRINT_TIMEOUT_S = 20L
    }
}
