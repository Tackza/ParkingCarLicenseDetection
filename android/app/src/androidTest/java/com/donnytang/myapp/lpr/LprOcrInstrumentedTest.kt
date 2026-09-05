package com.donnytang.myapp.lpr

import android.net.Uri
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * Runs the real [LprOcr] on the real device against plates whose correct reading is known.
 *
 * This is the check that matters for the Kotlin port: the ONNX weights were already validated on
 * the desktop and with a C++ harness on this hardware, so anything that breaks here is in the
 * glue — bitmap decode, EXIF rotation, letterbox, tensor layout, output decode, NMS, ordering.
 *
 * Images are read from /data/local/tmp rather than bundled, to keep ~1 MB of JPEGs out of the
 * repo. Push them first:
 *
 *     adb shell mkdir -p /data/local/tmp/lprtest
 *     adb push <detector>/license-car/338111_0.jpg /data/local/tmp/lprtest/
 *     ...
 *     ./gradlew :app:connectedDebugAndroidTest
 *
 * The test skips (rather than fails) when the images are absent, so a normal CI run without a
 * prepared device stays green.
 */
@RunWith(AndroidJUnit4::class)
class LprOcrInstrumentedTest {

    private val imageDir = File("/data/local/tmp/lprtest")

    /** Hand-verified against production Cloud Run; recorded in the detector's CLAUDE.md. */
    private val expected = linkedMapOf(
        "338111_0.jpg" to ("นข2628" to "สิงห์บุรี"),
        "338089_0.jpg" to ("2กท5518" to "กรุงเทพมหานคร"),
        "338092_0.jpg" to ("นข7039" to "พิษณุโลก"),
        "338095_0.jpg" to ("ฮพ2078" to "กรุงเทพมหานคร"),
        // No Thai consonant at all — the plate really reads "32-1527" and the model has no
        // class for the hyphen. Guards against anyone "fixing" this with plate validation.
        "338120_0.jpg" to ("321527" to "กรุงเทพมหานคร")
    )

    @Test
    fun readsTheReferencePlates() {
        val present = expected.keys.filter { File(imageDir, it).exists() }
        assumeTrue(
            "no reference images in $imageDir — push them first (see the class comment)",
            present.isNotEmpty()
        )

        val ocr = LprOcr(InstrumentationRegistry.getInstrumentation().targetContext)
        val loadMs = kotlin.system.measureTimeMillis { ocr.ensureLoaded() }
        Log.i(TAG, "models loaded in $loadMs ms")

        val failures = StringBuilder()
        for (name in present) {
            val (wantPlate, wantProvince) = expected.getValue(name)
            val file = File(imageDir, name)

            val elapsed: Long
            val result: LprOcr.Result
            System.currentTimeMillis().let { t0 ->
                result = ocr.detect(Uri.fromFile(file))
                elapsed = System.currentTimeMillis() - t0
            }

            Log.i(
                TAG,
                "$name -> ${result.plate} ${result.province}  " +
                    "(${elapsed} ms: decode ${result.decodeMs}, s1 ${result.stage1Ms}, s2 ${result.stage2Ms})  " +
                    "classes=${result.detectedClasses}"
            )

            if (!result.success) {
                failures.append("$name: engine reported '${result.error}'\n")
            } else if (result.plate != wantPlate || result.province != wantProvince) {
                failures.append(
                    "$name: got '${result.plate} ${result.province}', want '$wantPlate $wantProvince'\n"
                )
            }
        }
        ocr.close()

        assertTrue("on-device readings disagree with the verified answers:\n$failures", failures.isEmpty())
    }

    @Test
    fun reportsNoPlateInsteadOfCrashingOnAnImageWithoutOne() {
        val blank = File(imageDir, "no_plate.jpg")
        assumeTrue("no $blank on the device", blank.exists())

        val ocr = LprOcr(InstrumentationRegistry.getInstrumentation().targetContext)
        val result = ocr.detect(Uri.fromFile(blank))
        ocr.close()

        assertEquals(false, result.success)
        assertEquals("ไม่พบยานพาหนะในภาพ", result.error)
    }

    companion object {
        private const val TAG = "LprOcrTest"
    }
}
