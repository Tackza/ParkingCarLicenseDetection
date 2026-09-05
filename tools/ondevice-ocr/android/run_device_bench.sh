#!/usr/bin/env bash
# End-to-end on-device measurement. Needs: adb, Android NDK, the ONNX exports
# from ../export_models.py, and a python env with onnx/onnxruntime/opencv.
#
#   ./run_device_bench.sh
#
set -euo pipefail

DETECTOR=${DETECTOR:-/Users/pongsatornbheungnoi/Documents/project/yolo_17-3-25/7.licenseplate_detector}
NDK=${NDK:-$HOME/Library/Android/sdk/ndk/27.1.12297006}
ORT_VERSION=${ORT_VERSION:-1.23.2}          # match the desktop onnxruntime used to validate
PY=${PY:-/tmp/ocrenv/bin/python}
WORK=${WORK:-$(mktemp -d)}
T=/data/local/tmp/lprbench
HERE=$(cd "$(dirname "$0")" && pwd)

adb get-state >/dev/null   # fails loudly if USB debugging is off

echo "==> ONNX Runtime Android AAR $ORT_VERSION"
curl -sSL -o "$WORK/ort.aar" \
  "https://repo1.maven.org/maven2/com/microsoft/onnxruntime/onnxruntime-android/$ORT_VERSION/onnxruntime-android-$ORT_VERSION.aar"
unzip -oq "$WORK/ort.aar" -d "$WORK/aar"

echo "==> cross-compiling for arm64-v8a"
CXX=$NDK/toolchains/llvm/prebuilt/darwin-x86_64/bin/aarch64-linux-android24-clang++
for src in bench pipeline_bench; do
  "$CXX" -O2 -std=c++17 -I"$WORK/aar/headers" -L"$WORK/aar/jni/arm64-v8a" \
    -lonnxruntime -o "$WORK/$src" "$HERE/$src.cpp"
done

echo "==> preparing input tensors on the host"
"$PY" "$HERE/prep_device_inputs.py" "$WORK/set5"

echo "==> pushing to the device"
adb shell "rm -rf $T && mkdir -p $T"
adb push "$WORK/aar/jni/arm64-v8a/libonnxruntime.so" \
         "$NDK/toolchains/llvm/prebuilt/darwin-x86_64/sysroot/usr/lib/aarch64-linux-android/libc++_shared.so" \
         "$WORK/bench" "$WORK/pipeline_bench" "$T/"
adb push "$DETECTOR"/model/onnx/plate_{region,ocr}.fp{16,32}.onnx "$T/"
adb push "$WORK/set5" "$T/"
adb shell "chmod 755 $T/bench $T/pipeline_bench"

echo "==> per-model latency sweep"
adb shell "cd $T && export LD_LIBRARY_PATH=$T && for m in plate_region plate_ocr; do for p in fp32 fp16; do for t in 1 2 4 6; do
  if [ \$m = plate_region ]; then IN=set5/338111_0.jpg.s1.bin; else IN=set5/338111_0.jpg.s2.bin; fi
  ./bench \$m.\$p.onnx \$IN 10 \$t; done; done; done"

echo "==> both models resident (what the app will do) + peak RSS"
for p in fp16 fp32; do
  adb shell "cd $T && LD_LIBRARY_PATH=$T ./pipeline_bench plate_region.$p.onnx set5/338111_0.jpg.s1.bin plate_ocr.$p.onnx set5/338111_0.jpg.s2.bin 10 6"
done

echo "==> correctness on the reference set"
adb shell "cd $T && export LD_LIBRARY_PATH=$T && for n in 338111_0.jpg 338089_0.jpg 338092_0.jpg 338095_0.jpg 338120_0.jpg; do
  ./bench plate_region.fp16.onnx set5/\$n.s1.bin 3 6 cpu set5/\$n.o1.bin
  ./bench plate_ocr.fp16.onnx    set5/\$n.s2.bin 3 6 cpu set5/\$n.o2.bin; done" >/dev/null
adb pull "$T/set5" "$WORK/set5out" >/dev/null
mkdir -p "$WORK/pull/set5out" && cp "$WORK/set5out"/*.o?.bin "$WORK/pull/set5out/"
cp -r "$WORK/set5" "$WORK/pull/set5"
"$PY" "$HERE/verify_device.py" "$WORK/pull"

echo "workdir: $WORK"
