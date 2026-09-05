# On-device measurement — SUNMI V3 (2026-09-05)

The number Phase 0 could not answer: **how fast is this on the tablet that is
actually used at the checkpoint, and does it still read the plate correctly?**

## Verdict

**Yes on both counts. ~0.73 s per scan, 5/5 plates correct.**

That is *faster than the warm Cloud Run round trip we have today* (0.9–2.2 s,
before you add uploading a full-resolution photo over the checkpoint's network),
and it removes the 20–27 s cold start entirely.

## The device

| | |
|---|---|
| model | SUNMI **V3** (`adb` serial `VA0825AD42875`) |
| SoC | Qualcomm **QCM4325** (`bengal`) |
| CPU | 2× Cortex-A73 @ 2.4 GHz + 4× Kryo Silver @ 1.9 GHz (6 cores) |
| RAM | **2.7 GB** |
| OS | Android 13 (API 33), arm64-v8a |

A low-end 2020-era IoT SoC — deliberately the pessimistic case. Anything newer
will be faster.

## Latency (ONNX Runtime 1.23.2, CPU EP, median of 10)

Both models resident, one after the other, as the app would run them:

| precision | both stages | model load (once) | peak RSS |
|---|---|---|---|
| **FP16** | **725 ms** | 389 ms | 203 MB |
| FP32 | 706 ms | 149 ms | 177 MB |

Per model, sweeping the thread count:

| model | 1 thread | 2 | 4 | 6 |
|---|---|---|---|---|
| `plate_region` FP32 | 835 | 450 | 471 | 470 |
| `plate_region` FP16 | 831 | 449 | **366** | **343** |
| `plate_ocr` FP32 | 769 | 420 | 344 | **322** |
| `plate_ocr` FP16 | 774 | 423 | 344 | 327 |

Scaling stops paying after 4 threads — there are only 2 big cores. **Use 4;** 6
buys ~20 ms and competes with the UI thread.

## FP16 buys file size, not speed — and that was predictable

FP16 and FP32 run at the same speed here, and FP16 is *slower to load* and uses
*more* RAM. The Cortex-A73 is ARMv8.0 with **no native FP16 arithmetic** (that
arrived in ARMv8.2), so ONNX Runtime widens everything back to FP32 to compute
and pays for the conversion.

| | FP32 | FP16 |
|---|---|---|
| weights shipped in the APK | 23.2 MB | **11.7 MB** |
| both stages | 706 ms | 725 ms |
| load | 149 ms | 389 ms |
| peak RSS | 177 MB | 203 MB |

**Recommendation: ship FP16 anyway.** 11.5 MB off the APK is worth 19 ms per
scan and 26 MB of transient RAM, the accuracy is identical (Phase 0 and the
checks below), and on any newer ARMv8.2 tablet FP16 flips to being faster too.
If APK size ever stops mattering, FP32 is a one-line switch.

## NNAPI does not help on this device

| | FP32 | FP16 |
|---|---|---|
| `plate_region` NNAPI | 1619 ms | 366 ms |
| `plate_ocr` NNAPI | 1669 ms | 349 ms |
| (CPU EP, 4 threads) | 471 / 344 ms | 366 / 344 ms |

FP32 through NNAPI is **3.5× slower** — the driver cannot take the graph and the
partitioning overhead dominates. FP16 merely matches CPU. **Use the CPU
provider; do not enable NNAPI on this hardware.**

## Correctness on the device

The tablet ran the same input tensors the Mac ran, and its output tensors were
decoded with the same code:

| image | device (SUNMI V3) | mac | hand-verified | |
|---|---|---|---|---|
| `338111_0.jpg` | นข2628 สิงห์บุรี | นข2628 สิงห์บุรี | นข2628 สิงห์บุรี | OK |
| `338089_0.jpg` | 2กท5518 กรุงเทพมหานคร | 2กท5518 กรุงเทพมหานคร | 2กท5518 กรุงเทพมหานคร | OK |
| `338092_0.jpg` | นข7039 พิษณุโลก | นข7039 พิษณุโลก | นข7039 พิษณุโลก | OK |
| `338095_0.jpg` | ฮพ2078 กรุงเทพมหานคร | ฮพ2078 กรุงเทพมหานคร | ฮพ2078 กรุงเทพมหานคร | OK |
| `338120_0.jpg` | 321527 กรุงเทพมหานคร | 321527 กรุงเทพมหานคร | 321527 กรุงเทพมหานคร | OK |

**5/5.** Raw tensors are not bit-identical across the two CPUs — `max|Δ|` is
1.8e-4 (FP32 stage 1), 2.4e-3 (FP32 stage 2) and 5.0e-1 for FP16, the last being
exactly one FP16 ulp at coordinate magnitudes near 512. None of it changes a
single detected class or box.

## Phase 1: the real Kotlin module, end to end on the device

The numbers above are inference only. These are the shipped `LprOcr.kt` doing
everything — JPEG decode, EXIF, letterbox, tensor fill, both models, decode, NMS,
crop, character ordering, province pick, split — measured by
`:app:connectedDebugAndroidTest` on the same SUNMI V3:

| image | on-device reading | expected | total | decode | stage 1 | stage 2 |
|---|---|---|---|---|---|---|
| `338111_0.jpg` | นข2628 สิงห์บุรี | ✅ | 1075 ms | 57 | 491 | 503 |
| `338089_0.jpg` | 2กท5518 กรุงเทพมหานคร | ✅ | 961 ms | 31 | 481 | 439 |
| `338092_0.jpg` | นข7039 พิษณุโลก | ✅ | 863 ms | 26 | 426 | 402 |
| `338095_0.jpg` | ฮพ2078 กรุงเทพมหานคร | ✅ | 898 ms | 31 | 399 | 459 |
| `338120_0.jpg` | 321527 กรุงเทพมหานคร | ✅ | 925 ms | 26 | 405 | 485 |

**5/5**, model load 315 ms, median **925 ms** end to end — inside the 0.85–0.95 s
that was budgeted from the inference-only numbers.

The Kotlin port is not merely close, it is exact: for `338111_0.jpg` the module
emitted the raw classes `A25 A02 2 6 2 8 SBR`, character for character the
sequence recorded for that image in the detector's own CLAUDE.md.

That also settles the one risk flagged in Phase 0 — Android's `Canvas` bilinear
resize is not `cv2.INTER_LINEAR`, and it turned out not to matter for any of
these images.

Inference is slower here than the 725 ms C++ figure because the module uses
4 intra-op threads rather than 6, and because letterbox and tensor fill are
inside the timed region. Both are deliberate: the UI thread needs the big cores.

### Running it again

```bash
adb shell mkdir -p /data/local/tmp/lprtest
adb push <detector>/license-car/338111_0.jpg /data/local/tmp/lprtest/   # and the other four
cd android && ./gradlew :app:connectedDebugAndroidTest
adb logcat -d -s LprOcrTest:I
```

Two gotchas cost a build cycle each and are now handled in the repo:

- **`expo-dev-launcher` aborts the process under instrumentation**
  (`IllegalStateException: DevelopmentClientController was initialized.` from
  `MainApplication.onCreate`). `LprTestRunner` boots a plain `Application`
  instead — the engine needs a Context, not React Native.
- **A debug build cannot install over a production APK**
  (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`, different signing key). Uninstall first,
  or give the debug build type an `applicationIdSuffix`.

## APK cost

From the debug APK, uncompressed:

| | |
|---|---|
| models + labels (`assets/`) | **11.1 MB** |
| `libonnxruntime.so` arm64-v8a | 16.8 MB |
| armeabi-v7a | 11.8 MB |
| x86 + x86_64 | **38.8 MB** |
| total added | **78.6 MB** |

The checkpoint fleet is arm64-v8a. Roughly **39 MB of that is x86 libraries no
tablet will ever load**, carried only so the app still runs on an emulator.
Trimming it is an ABI-filter or ABI-split decision for the whole app, not just
this feature, so it is left alone here.

## What is still unmeasured

- thermal behaviour over a long queue of vehicles
- memory pressure when the ~200 MB inference peak lands on top of the React
  Native heap on a 2.7 GB device — watch for `onTrimMemory` / background kills
- accuracy across the full 33-image set on-device (the desktop run covers those;
  the instrumented test covers the 5 with hand-verified answers)

## Reproducing

```bash
tools/ondevice-ocr/android/run_device_bench.sh
```

Needs USB debugging on, the Android NDK, and the exports from
`../export_models.py`. Override `DETECTOR`, `NDK`, `PY`, `ORT_VERSION` by env var.

| file | what |
|---|---|
| `bench.cpp` | one model, N timed runs, optional output dump |
| `pipeline_bench.cpp` | both models resident, end-to-end timing + peak RSS |
| `prep_device_inputs.py` | builds the stage-1/stage-2 tensors on the host |
| `verify_device.py` | decodes the device's output tensors and compares to host + expected |

Pinning ONNX Runtime **1.23.2** on both sides is deliberate — the desktop
validation in Phase 0 used exactly that version.

## Note: the app ships ONNX Runtime 1.20.0, not 1.23.2

These measurements were taken with 1.23.2, but the app depends on **1.20.0**.

`onnxruntime-android` **1.21.0 and later declare `minSdkVersion 24`**. This app
declares 23, and the manifest merger refuses to build:

```
uses-sdk:minSdkVersion 23 cannot be smaller than version 24 declared in library
[com.microsoft.onnxruntime:onnxruntime-android:1.23.2]
```

Raising the app's floor to 24 would quietly drop Android 6.0 devices from the
supported fleet — a product decision, not a dependency-resolution one. **1.20.0
is the last release that still declares 21**, so it is the pin. The instrumented
test (`:app:connectedDebugAndroidTest`) re-checks the reference plates through
whatever version gradle actually resolves, so the app's real dependency stays
verified regardless of what this file was measured with.

| ORT version | declared minSdk |
|---|---|
| ≤ 1.20.0 | 21 |
| ≥ 1.21.0 | **24** |
