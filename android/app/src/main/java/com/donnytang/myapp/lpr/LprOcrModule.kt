package com.donnytang.myapp.lpr

import android.net.Uri
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.Executors

/**
 * Bridges [LprOcr] to JS as `NativeModules.LprOcr`.
 *
 * The resolved shape deliberately mirrors the Cloud Run `/detect` response so the scan screen
 * can treat on-device and server results identically:
 *
 *     { success: true,  data: { license_plate, province }, timing: {...} }
 *     { success: false, error: "ไม่พบยานพาหนะในภาพ",       timing: {...} }
 *
 * "No plate in the photo" resolves rather than rejects — it is an ordinary outcome, not a
 * failure of the module, and the caller handles it the same way it handles the service's 500.
 * The promise only rejects when the module itself could not run.
 */
class LprOcrModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    // Single worker: the models are not re-entrant and two concurrent scans on a 6-core tablet
    // would only fight each other for the two big cores.
    private val executor = Executors.newSingleThreadExecutor()
    private val engine = LprOcr(reactContext.applicationContext)

    override fun getName() = "LprOcr"

    /**
     * Loads both models (~390 ms on the SUNMI V3) so the first real scan does not pay for it.
     * Call once after the app settles.
     */
    @ReactMethod
    fun warmUp(promise: Promise) {
        executor.execute {
            try {
                val t0 = System.currentTimeMillis()
                engine.ensureLoaded()
                promise.resolve(System.currentTimeMillis() - t0)
            } catch (e: Throwable) {
                promise.reject("LPR_WARMUP_FAILED", e.message, e)
            }
        }
    }

    @ReactMethod
    fun detect(uriString: String, promise: Promise) {
        executor.execute {
            try {
                val result = engine.detect(Uri.parse(uriString))

                val timing = Arguments.createMap().apply {
                    putInt("decodeMs", result.decodeMs.toInt())
                    putInt("stage1Ms", result.stage1Ms.toInt())
                    putInt("stage2Ms", result.stage2Ms.toInt())
                    putInt("totalMs", (result.decodeMs + result.stage1Ms + result.stage2Ms).toInt())
                }

                val payload = Arguments.createMap().apply {
                    putBoolean("success", result.success)
                    putMap("timing", timing)
                    if (result.success) {
                        putMap("data", Arguments.createMap().apply {
                            // null stays null: the service reports success with a null plate when
                            // the read contains no digit, and the caller relies on that.
                            if (result.plate == null) putNull("license_plate")
                            else putString("license_plate", result.plate)
                            if (result.province == null) putNull("province")
                            else putString("province", result.province)
                        })
                        putString("combined_text", result.combinedText)
                        putArray("detected_classes", Arguments.createArray().apply {
                            result.detectedClasses.forEach { pushString(it) }
                        })
                    } else {
                        putString("error", result.error)
                    }
                }
                promise.resolve(payload)
            } catch (e: Throwable) {
                promise.reject("LPR_DETECT_FAILED", e.message ?: e.toString(), e)
            }
        }
    }

    override fun invalidate() {
        super.invalidate()
        executor.execute { engine.close() }
        executor.shutdown()
    }
}
