# On-device OCR — Phase 0 (feasibility)

Goal: find out whether the two YOLO models behind `license-plate-service` can run
**inside the tablet app**, so a checkpoint keeps working with no internet and the
15 s-timeout / 20-27 s-cold-start problem disappears.

Phase 0 answers one question only: **does the model still read plates correctly
once it is exported to FP16 ONNX and run without Ultralytics?** No app code is
touched here.

## Verdict

**Yes — FP16 is safe.** Nothing that changed came from quantization.

| run | agrees with production | note |
|---|---|---|
| `onnx-fp32` | 31/33 (93.9 %) | our ported pipeline, full precision |
| **`onnx-fp16`** | **32/33 (97.0 %)** | **half the file size, no accuracy cost** |

All 5 hand-verified reference plates pass on every variant, including the
`32-1527` no-Thai-consonant edge case (`338120_0.jpg` → `321527`).

FP16 scoring *higher* than FP32 is not a real improvement — the one image
involved (`338121_0.jpg`) is a near-tie between two provinces and the two
precisions land on opposite sides of it. Treat them as equal.

### The one genuine behavioural difference

`338115_0.jpg`: production reads `นง7010`, the port reads `นง70910` — an extra
digit. `diagnose_letterbox.py` pins the cause, and **it is not ONNX and not FP16**:

```
338115_0.jpg
   .pt, rect letterbox  (production today) : นง7010 นครราชสีมา
   .pt, square 640x640  (what ONNX must do): นง79010 นครราชสีมา
   -> cause: letterbox shape
```

Feeding the *original PyTorch weights* a square input reproduces the extra digit.
Ultralytics letterboxes a `.pt` model **rectangularly** (pad only to the next
multiple of 32), but a mobile ONNX graph wants a **static** `1x3x640x640` input,
so the port has to pad to a square. That is inherent to shipping a fixed-shape
model, not a conversion bug.

Options for Phase 1, in order of preference: raise the stage-2 confidence
slightly and re-measure; or export with a dynamic input axis and letterbox
rectangularly on-device (costs mobile-runtime performance and NNAPI
compatibility); or accept it — one hard image in 33, and the operator can still
fix the plate in the manual-edit modal.

## What gets shipped

| model | role | classes | params | FP32 | **FP16** |
|---|---|---|---|---|---|
| `plate_region` (`license_plate.pt`) | stage 1, finds the plate box | 1 | 3.01 M | 12.27 MB | **6.17 MB** |
| `plate_ocr` (`data_plate.pt`) | stage 2, reads chars + province | 125 | 2.66 M | 10.90 MB | **5.50 MB** |

**11.7 MB of weights total** at FP16 — both nets are `nano` (YOLOv8n / YOLO11n).
Input `1x3x640x640` static, output `1x5x8400` and `1x129x8400`, opset 12.

Note the 2 Gi RAM the Cloud Run service needs is a **PyTorch + Ultralytics** cost,
not a model cost; ONNX Runtime carries neither.

### Class coverage

All **125** OCR classes map to a Thai label via `function/helper.py` — nothing
comes back as a raw code. Breakdown: **10 digits + 38 Thai consonants + 77
provinces**.

⚠️ `helper.py` lists **78** province codes, so one of them — **`NRT`
(นราธิวาส)** — has no class in the model and can never be emitted. The app's
`THAI_PROVINCES` carries all 78 labels, so นราธิวาส is reachable only by manual
selection today. This is pre-existing, not something the port introduced.

## Latency

| run | median | mean |
|---|---|---|
| baseline (PyTorch `.pt`) | 61.7 ms | 79.6 ms |
| onnx-fp32 | 99.5 ms | 99.7 ms |
| onnx-fp16 | 103.1 ms | 103.9 ms |

⚠️ **These are Mac numbers on ONNX Runtime's CPU provider and say very little
about the tablet.** The baseline looks faster mainly because rectangular
letterboxing feeds it a *smaller* tensor than the port's padded square, and
because PyTorch on Apple Silicon uses tuned BLAS. FP16 is not slower than FP32 in
any meaningful sense on this CPU — FP16 pays off on the phone/tablet NPU and in
download size. **Phase 1 must re-measure on the actual checkpoint tablet.**

## Files

| file | what |
|---|---|
| `export_models.py` | `.pt` → ONNX FP32 → ONNX FP16, plus `labels.json` (class idx → Thai + is_province) |
| `lpr_onnx.py` | **the port target** — the whole two-stage pipeline on ONNX Runtime + numpy, no Ultralytics |
| `compare_accuracy.py` | three-way run (baseline / fp32 / fp16) over `license-car/`, writes `phase0_results.json` |
| `diagnose_letterbox.py` | attributes a disagreement to quantization vs. letterbox shape |
| `labels.json` | the label table the app will embed (checked in — it is small and it is a contract) |
| `phase0_results.json` | full per-image output of the last run |

`lpr_onnx.py` is deliberately explicit: letterbox, decode, per-class NMS and box
rescaling are all spelled out, because the Kotlin/TypeScript implementation has
to do exactly the same. It mirrors `server.py` decision for decision — stage
conf 0.3, NMS IoU 0.7, `max_det` 300, first stage-1 box only, single
highest-confidence province, characters ordered left-to-right by box `x1`,
province appended last, split at the last digit.

## Reproducing

The model weights live in the **detector folder**, which is not under version
control:

    /Users/pongsatornbheungnoi/Documents/project/yolo_17-3-25/7.licenseplate_detector

Exported models are build artifacts and are written to `<detector>/model/onnx/`,
not committed here.

The detector's own conda env (`Yolo`) has torch + ultralytics but no ONNX
tooling. Build a venv on top of it rather than mutating it:

```bash
/opt/anaconda3/envs/Yolo/bin/python -m venv --system-site-packages /tmp/ocrenv
/tmp/ocrenv/bin/pip install onnx onnxruntime onnxslim "numpy<2"
```

`numpy<2` is required — installing onnxruntime pulls numpy 2.x, which
ultralytics 8.3.3 refuses.

```bash
/tmp/ocrenv/bin/python tools/ondevice-ocr/export_models.py
/tmp/ocrenv/bin/python tools/ondevice-ocr/compare_accuracy.py
/tmp/ocrenv/bin/python tools/ondevice-ocr/diagnose_letterbox.py
```

FP16 conversion uses `onnxruntime.transformers.float16`, **not**
`onnxconverter-common` — the latter emits a broken cast around this graph's
`Resize` nodes and the model fails to load (`Type (tensor(float)) ... does not
match expected type (tensor(float16))`).

## Measured on the real tablet — see [`android/DEVICE_RESULTS.md`](android/DEVICE_RESULTS.md)

Answered 2026-09-05 on a **SUNMI V3** (Qualcomm QCM4325, 2×A73 2.4 GHz + 4×1.9 GHz,
2.7 GB RAM, Android 13): **~725 ms for both stages, 5/5 reference plates correct.**
Faster than the warm Cloud Run round trip we have today.

FP16 turned out to buy **file size, not speed** on that CPU (ARMv8.0 has no native
FP16 arithmetic, so ORT widens back to FP32) — ship it anyway for the 11.5 MB APK
saving. NNAPI made FP32 **3.5× slower**; use the CPU provider with 4 threads.

## Not answered by Phase 0

- pre/post-processing cost in Kotlin (inference is measured, the glue is not)
- whether ONNX Runtime or TFLite is the better Android runtime — note
  `react-native-fast-tflite@3.x` needs `react-native-nitro-modules`, i.e. the New
  Architecture, and this app runs `newArchEnabled=false`; pin `1.6.1` if TFLite wins
- how model updates reach tablets once the model is no longer server-side
- whether to keep `/detect` as a fallback (it costs ~$0.36/month, so probably yes)
