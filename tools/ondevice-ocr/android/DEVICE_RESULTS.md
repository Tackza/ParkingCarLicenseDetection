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

## What is still missing before this ships

These measurements cover **inference only** — the part that dominates, but not
all of it. Phase 1 proper still has to add, in Kotlin:

1. JPEG decode + letterbox + tensor fill (~1108×1477 source images here)
2. output decode + per-class NMS + box rescaling
3. the crop between the two stages

`lpr_onnx.py` in the parent folder is the reference for all of it. Budget
~100–200 ms on this CPU, so plan on **~0.85–0.95 s end to end**.

Also unmeasured: thermal behaviour over a long queue of vehicles, and memory
pressure when the ~200 MB inference peak lands on top of the React Native heap
on a 2.7 GB device. Watch for `onTrimMemory` / background kills.

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
