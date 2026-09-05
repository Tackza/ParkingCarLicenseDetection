package com.donnytang.myapp.lpr

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import org.json.JSONObject
import java.io.InputStream
import java.nio.FloatBuffer
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Two-stage Thai licence-plate reader running entirely on the device.
 *
 * This is a transliteration of `tools/ondevice-ocr/lpr_onnx.py`, which is itself a
 * decision-for-decision port of the Cloud Run service's `server.py`. If you change the
 * behaviour here, change it there too and re-run `tools/ondevice-ocr/compare_accuracy.py` —
 * those three implementations are meant to agree.
 *
 * Stage 1 (`plate_region`) finds the plate rectangle, stage 2 (`plate_ocr`) reads the
 * characters inside the crop. Everything Ultralytics does for free in Python — letterbox,
 * output decode, non-max suppression, box rescaling — is spelled out below.
 */
class LprOcr(private val context: Context) {

    companion object {
        private const val IMGSZ = 640
        private const val CONF_THRES = 0.3f   // server.py passes conf=0.3 to both stages
        private const val IOU_THRES = 0.7f    // ultralytics predict default
        private const val MAX_DET = 300       // ultralytics predict default
        private const val PAD = 114           // letterbox fill

        /**
         * Measured best on the SUNMI V3 (2 big cores): 4 threads is the knee, 6 buys ~20 ms
         * while competing with the UI thread. See tools/ondevice-ocr/android/DEVICE_RESULTS.md.
         */
        private const val INTRA_OP_THREADS = 4

        /**
         * Camera photos can be 12 MP, which is 48 MB as ARGB_8888 and a real risk on a 2.7 GB
         * tablet. Stage 2 reads characters out of a crop of the *original* pixels, so we cannot
         * downscale to 640 up front — but nothing is gained above this bound either.
         */
        private const val MAX_DECODE_EDGE = 2048

        private const val REGION_MODEL = "plate_region.fp16.onnx"
        private const val OCR_MODEL = "plate_ocr.fp16.onnx"
        private const val LABELS = "labels.json"
    }

    data class Label(val code: String, val thai: String, val isProvince: Boolean)

    data class Detection(
        val x1: Float, val y1: Float, val x2: Float, val y2: Float,
        val score: Float, val cls: Int
    )

    data class Result(
        val success: Boolean,
        val plate: String? = null,
        val province: String? = null,
        val combinedText: String = "",
        val detectedClasses: List<String> = emptyList(),
        val error: String? = null,
        val decodeMs: Long = 0,
        val stage1Ms: Long = 0,
        val stage2Ms: Long = 0
    )

    private var env: OrtEnvironment? = null
    private var regionSession: OrtSession? = null
    private var ocrSession: OrtSession? = null
    private var labels: Map<Int, Label> = emptyMap()
    private var codeToThai: Map<String, String> = emptyMap()

    @Volatile
    private var loaded = false

    /** Loads both models and the label table. Safe to call repeatedly; only the first does work. */
    @Synchronized
    fun ensureLoaded() {
        if (loaded) return
        val environment = OrtEnvironment.getEnvironment()
        val opts = OrtSession.SessionOptions().apply {
            setIntraOpNumThreads(INTRA_OP_THREADS)
            setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
            // Deliberately NOT NNAPI: on the QCM4325 it made FP32 3.5x slower and did nothing
            // for FP16. The CPU provider is the measured-best option.
        }
        regionSession = environment.createSession(readAsset(REGION_MODEL), opts)
        ocrSession = environment.createSession(readAsset(OCR_MODEL), opts)

        val json = JSONObject(String(readAsset(LABELS), Charsets.UTF_8))
        val table = HashMap<Int, Label>()
        val byCode = HashMap<String, String>()
        for (key in json.keys()) {
            val o = json.getJSONObject(key)
            val label = Label(o.getString("code"), o.getString("thai"), o.getBoolean("is_province"))
            table[key.toInt()] = label
            byCode[label.code] = label.thai
        }
        labels = table
        codeToThai = byCode
        env = environment
        loaded = true
    }

    fun close() {
        regionSession?.close(); regionSession = null
        ocrSession?.close(); ocrSession = null
        loaded = false
    }

    private fun readAsset(name: String): ByteArray =
        context.assets.open(name).use { it.readBytes() }

    // ------------------------------------------------------------------
    // image loading
    // ------------------------------------------------------------------

    /**
     * Decodes the picked photo, honouring EXIF orientation.
     *
     * BitmapFactory ignores EXIF, but the camera writes portrait shots as landscape pixels plus
     * an orientation tag — feeding those to the detector unrotated finds nothing.
     */
    private fun loadBitmap(uri: Uri): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        openStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / sample > MAX_DECODE_EDGE) sample *= 2

        val opts = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        val decoded = openStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) } ?: return null

        val rotation = openStream(uri)?.use { readExifRotation(it) } ?: 0
        if (rotation == 0) return decoded
        val m = Matrix().apply { postRotate(rotation.toFloat()) }
        val rotated = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, m, true)
        if (rotated != decoded) decoded.recycle()
        return rotated
    }

    private fun openStream(uri: Uri): InputStream? = try {
        if (uri.scheme == null || uri.scheme == "file") {
            java.io.File(uri.path!!).inputStream()
        } else {
            context.contentResolver.openInputStream(uri)
        }
    } catch (e: Exception) {
        null
    }

    private fun readExifRotation(stream: InputStream): Int =
        when (ExifInterface(stream).getAttributeInt(
            ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL
        )) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90
            ExifInterface.ORIENTATION_ROTATE_180 -> 180
            ExifInterface.ORIENTATION_ROTATE_270 -> 270
            else -> 0
        }

    // ------------------------------------------------------------------
    // preprocessing
    // ------------------------------------------------------------------

    /** Ratio and left/top padding produced by [letterbox], needed to map boxes back. */
    private data class Pad(val r: Float, val left: Int, val top: Int)

    /**
     * Resize preserving aspect ratio and pad to a square with 114-grey.
     *
     * Arithmetic follows ultralytics `LetterBox(auto=false, center=true, scaleup=true)` so the
     * boxes come out in the same coordinate frame the Python port produces.
     */
    private fun letterbox(src: Bitmap): Pair<Bitmap, Pad> {
        val w = src.width
        val h = src.height
        val r = min(IMGSZ.toFloat() / h, IMGSZ.toFloat() / w)
        val newW = (w * r).roundToInt()
        val newH = (h * r).roundToInt()
        val dw = (IMGSZ - newW) / 2f
        val dh = (IMGSZ - newH) / 2f
        val left = (dw - 0.1f).roundToInt()
        val top = (dh - 0.1f).roundToInt()

        val out = Bitmap.createBitmap(IMGSZ, IMGSZ, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        canvas.drawColor(android.graphics.Color.rgb(PAD, PAD, PAD))
        val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
        canvas.drawBitmap(
            src,
            Rect(0, 0, w, h),
            Rect(left, top, left + newW, top + newH),
            paint
        )
        return out to Pad(r, left, top)
    }

    /** ARGB bitmap -> RGB CHW float32 in [0,1], the layout the exported graphs expect. */
    private fun toTensor(bmp: Bitmap): FloatBuffer {
        val n = IMGSZ * IMGSZ
        val pixels = IntArray(n)
        bmp.getPixels(pixels, 0, IMGSZ, 0, 0, IMGSZ, IMGSZ)
        val buf = FloatBuffer.allocate(3 * n)
        val out = buf.array()
        for (i in 0 until n) {
            val p = pixels[i]
            out[i] = ((p shr 16) and 0xFF) / 255f            // R
            out[n + i] = ((p shr 8) and 0xFF) / 255f         // G
            out[2 * n + i] = (p and 0xFF) / 255f             // B
        }
        return buf
    }

    // ------------------------------------------------------------------
    // postprocessing
    // ------------------------------------------------------------------

    /**
     * Turns a raw `(1, 4+nc, 8400)` head into boxes in ORIGINAL image pixels.
     *
     * YOLOv8/11 emit box centre/size in network-input pixels plus already-sigmoid'd class
     * scores; there is no separate objectness term.
     */
    private fun decode(
        raw: FloatArray, channels: Int, anchors: Int,
        pad: Pad, origW: Int, origH: Int
    ): List<Detection> {
        val nc = channels - 4
        val candidates = ArrayList<Detection>()

        for (i in 0 until anchors) {
            var bestCls = 0
            var bestScore = raw[4 * anchors + i]
            for (c in 1 until nc) {
                val s = raw[(4 + c) * anchors + i]
                if (s > bestScore) { bestScore = s; bestCls = c }
            }
            if (bestScore <= CONF_THRES) continue   // ultralytics filters with >, not >=

            val cx = raw[i]
            val cy = raw[anchors + i]
            val bw = raw[2 * anchors + i]
            val bh = raw[3 * anchors + i]
            candidates.add(
                Detection(cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2, bestScore, bestCls)
            )
        }
        if (candidates.isEmpty()) return emptyList()

        // Greedy per-class NMS, score-descending — same ordering torchvision.ops.nms produces,
        // which matters because stage 1 uses "the first box" to mean "the best one".
        candidates.sortByDescending { it.score }
        val kept = ArrayList<Detection>()
        val suppressed = BooleanArray(candidates.size)
        for (a in candidates.indices) {
            if (suppressed[a]) continue
            val da = candidates[a]
            kept.add(da)
            if (kept.size >= MAX_DET) break
            for (b in a + 1 until candidates.size) {
                if (suppressed[b]) continue
                val db = candidates[b]
                if (db.cls != da.cls) continue      // agnostic_nms = false
                if (iou(da, db) > IOU_THRES) suppressed[b] = true
            }
        }

        // undo the letterbox: strip padding, divide by the resize ratio, clip to the image
        return kept.map {
            Detection(
                ((it.x1 - pad.left) / pad.r).coerceIn(0f, origW.toFloat()),
                ((it.y1 - pad.top) / pad.r).coerceIn(0f, origH.toFloat()),
                ((it.x2 - pad.left) / pad.r).coerceIn(0f, origW.toFloat()),
                ((it.y2 - pad.top) / pad.r).coerceIn(0f, origH.toFloat()),
                it.score, it.cls
            )
        }
    }

    private fun iou(a: Detection, b: Detection): Float {
        val xx1 = max(a.x1, b.x1)
        val yy1 = max(a.y1, b.y1)
        val xx2 = min(a.x2, b.x2)
        val yy2 = min(a.y2, b.y2)
        val inter = max(0f, xx2 - xx1) * max(0f, yy2 - yy1)
        if (inter <= 0f) return 0f
        val areaA = (a.x2 - a.x1) * (a.y2 - a.y1)
        val areaB = (b.x2 - b.x1) * (b.y2 - b.y1)
        return inter / (areaA + areaB - inter)
    }

    /**
     * Cut at the last digit — everything after it is the province.
     *
     * Returns null/null when the string has no digit at all, which the service reports as
     * `success: true` with `license_plate: null`. The scan screen treats that as "ask the
     * operator", so keep the same shape.
     */
    private fun splitPlateAndProvince(text: String): Pair<String?, String?> {
        var i = text.length - 1
        while (i >= 0 && !text[i].isDigit()) i--
        if (i < 0) return null to null
        return text.substring(0, i + 1) to text.substring(i + 1)
    }

    // ------------------------------------------------------------------
    // the pipeline
    // ------------------------------------------------------------------

    private fun runModel(session: OrtSession, bmp: Bitmap, pad: Pad, origW: Int, origH: Int): List<Detection> {
        val environment = env!!
        val inputName = session.inputNames.iterator().next()
        val tensor = OnnxTensor.createTensor(
            environment, toTensor(bmp), longArrayOf(1, 3, IMGSZ.toLong(), IMGSZ.toLong())
        )
        tensor.use {
            session.run(mapOf(inputName to it)).use { results ->
                val out = results[0] as OnnxTensor
                val shape = out.info.shape           // [1, 4+nc, anchors]
                val channels = shape[1].toInt()
                val anchors = shape[2].toInt()
                val buf = out.floatBuffer
                val raw = FloatArray(buf.remaining())
                buf.get(raw)
                return decode(raw, channels, anchors, pad, origW, origH)
            }
        }
    }

    fun detect(uri: Uri): Result {
        ensureLoaded()

        val t0 = System.currentTimeMillis()
        val image = loadBitmap(uri) ?: return Result(false, error = "ไม่สามารถอ่านไฟล์ภาพได้")
        val decodeMs = System.currentTimeMillis() - t0

        try {
            val (lb1, pad1) = letterbox(image)
            val t1 = System.currentTimeMillis()
            val plates = runModel(regionSession!!, lb1, pad1, image.width, image.height)
            val stage1Ms = System.currentTimeMillis() - t1
            lb1.recycle()

            if (plates.isEmpty()) {
                return Result(false, error = "ไม่พบยานพาหนะในภาพ", decodeMs = decodeMs, stage1Ms = stage1Ms)
            }

            // server.py returns inside the box loop, so only the best plate is ever read
            val best = plates[0]
            val x1 = best.x1.toInt().coerceIn(0, image.width)
            val y1 = best.y1.toInt().coerceIn(0, image.height)
            val x2 = best.x2.toInt().coerceIn(0, image.width)
            val y2 = best.y2.toInt().coerceIn(0, image.height)
            if (x2 <= x1 || y2 <= y1) {
                return Result(false, error = "ไม่พบยานพาหนะในภาพ", decodeMs = decodeMs, stage1Ms = stage1Ms)
            }

            val roi = Bitmap.createBitmap(image, x1, y1, x2 - x1, y2 - y1)
            val (lb2, pad2) = letterbox(roi)
            val t2 = System.currentTimeMillis()
            val chars = runModel(ocrSession!!, lb2, pad2, roi.width, roi.height)
            val stage2Ms = System.currentTimeMillis() - t2
            lb2.recycle()
            roi.recycle()

            // characters left-to-right; of all province classes keep only the most confident one
            val nonProvince = ArrayList<Pair<Int, String>>()
            var bestProvince: String? = null
            var bestProvinceConf = 0f
            for (d in chars) {
                val label = labels[d.cls] ?: continue
                if (label.isProvince) {
                    if (d.score > bestProvinceConf) {
                        bestProvinceConf = d.score
                        bestProvince = label.code
                    }
                } else {
                    nonProvince.add(d.x1.toInt() to label.code)
                }
            }
            nonProvince.sortBy { it.first }

            val codes = ArrayList<String>(nonProvince.map { it.second })
            bestProvince?.let { codes.add(it) }   // province always last

            val combined = codes.joinToString("") { codeToThai[it] ?: it }
            val (plate, province) = splitPlateAndProvince(combined)

            return Result(
                success = true,
                plate = plate,
                province = province,
                combinedText = combined,
                detectedClasses = codes,
                decodeMs = decodeMs,
                stage1Ms = stage1Ms,
                stage2Ms = stage2Ms
            )
        } finally {
            image.recycle()
        }
    }
}
