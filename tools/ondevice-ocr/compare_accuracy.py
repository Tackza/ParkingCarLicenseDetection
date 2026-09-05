"""Phase 0 step 3 — does ONNX FP16 read the same plates as production does?

Three runs over the same images:

  baseline   ultralytics + the .pt weights, mirroring server.py  <- ground truth
  onnx-fp32  our ported pipeline, FP32 weights   <- checks the PORT is faithful
  onnx-fp16  our ported pipeline, FP16 weights   <- checks QUANTIZATION is safe

Splitting it three ways matters: if fp32 already disagrees with the baseline the
fault is in the port (letterbox/NMS/ordering), not in the quantization.

Run:  python tools/ondevice-ocr/compare_accuracy.py
"""
import argparse
import json
import statistics
import sys
import time
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from lpr_onnx import LprOnnx, split_license_plate_and_province  # noqa: E402

DETECTOR = Path("/Users/pongsatornbheungnoi/Documents/project/yolo_17-3-25/7.licenseplate_detector")
ONNX_DIR = DETECTOR / "model" / "onnx"

# Verified by hand against production Cloud Run (recorded in the detector's CLAUDE.md).
# 338120_0.jpg is the no-Thai-consonant plate that really reads "32-1527".
KNOWN = {
    "338111_0.jpg": ("นข2628", "สิงห์บุรี"),
    "338089_0.jpg": ("2กท5518", "กรุงเทพมหานคร"),
    "338092_0.jpg": ("นข7039", "พิษณุโลก"),
    "338095_0.jpg": ("ฮพ2078", "กรุงเทพมหานคร"),
    "338120_0.jpg": ("321527", "กรุงเทพมหานคร"),
}


def run_baseline(images):
    """Ultralytics .pt, decision-for-decision the same as server.py."""
    from ultralytics import YOLO

    sys.path.insert(0, str(DETECTOR))
    from function.helper import data_province, get_thai_character

    region = YOLO(str(DETECTOR / "model/license_plate.pt"))
    ocr = YOLO(str(DETECTOR / "model/data_plate.pt"))

    out = {}
    for path in images:
        img = cv2.imdecode(np.fromfile(str(path), dtype=np.uint8), cv2.IMREAD_COLOR)
        t0 = time.perf_counter()
        res = {"plate": None, "province": None, "ok": False, "codes": []}
        for result in region(img, conf=0.3, verbose=False):
            for box in result.boxes:
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                roi = img[y1:y2, x1:x2]
                if roi.size == 0:
                    continue
                non_province, best_prov, best_conf = [], None, 0.0
                for plate in ocr(roi, conf=0.3, verbose=False):
                    for pb in plate.boxes:
                        code = ocr.names[int(pb.cls[0])]
                        conf = float(pb.conf[0])
                        px1 = int(pb.xyxy[0][0])
                        if code in data_province:
                            if conf > best_conf:
                                best_conf, best_prov = conf, code
                        else:
                            non_province.append((px1, code))
                non_province.sort(key=lambda t: t[0])
                codes = [c for _, c in non_province]
                if best_prov:
                    codes.append(best_prov)
                combined = "".join(get_thai_character(c) for c in codes)
                plate_no, province = split_license_plate_and_province(combined)
                res = {"plate": plate_no, "province": province, "ok": True, "codes": codes}
                break
            break
        res["ms"] = (time.perf_counter() - t0) * 1e3
        out[path.name] = res
    return out


def run_onnx(images, precision):
    engine = LprOnnx(ONNX_DIR, precision=precision)
    out = {}
    for path in images:
        d = engine.detect_file(path)
        out[path.name] = {
            "plate": d.plate, "province": d.province, "ok": d.ok,
            "codes": d.detected_classes, "ms": d.ms.get("total", 0.0),
        }
    return out


def key(r):
    """What the app actually consumes: the plate string and the province string."""
    return (r["plate"] or "", r["province"] or "") if r["ok"] else ("<no-plate>", "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", default=str(DETECTOR / "license-car"))
    ap.add_argument("--warmup", type=int, default=2, help="untimed runs before measuring")
    ap.add_argument("--out", default=str(Path(__file__).parent / "phase0_results.json"))
    args = ap.parse_args()

    images = sorted(Path(args.images).glob("*.jpg"))
    if not images:
        raise SystemExit(f"no images under {args.images}")
    print(f"{len(images)} images from {args.images}\n")

    for _ in range(args.warmup):  # first ORT run pays graph-optimisation cost
        run_onnx(images[:1], "fp16")

    runs = {}
    for name, fn in (
        ("baseline", lambda: run_baseline(images)),
        ("onnx-fp32", lambda: run_onnx(images, "fp32")),
        ("onnx-fp16", lambda: run_onnx(images, "fp16")),
    ):
        t = time.perf_counter()
        runs[name] = fn()
        print(f"  {name:<10} done in {time.perf_counter()-t:5.1f}s")

    base = runs["baseline"]
    print(f"\n{'image':<16} {'baseline':<26} {'onnx-fp32':<26} {'onnx-fp16':<26}")
    print("-" * 96)
    disagree = {"onnx-fp32": [], "onnx-fp16": []}
    for path in images:
        n = path.name
        b = key(base[n])
        cells = [f"{b[0]} {b[1]}".strip()]
        for v in ("onnx-fp32", "onnx-fp16"):
            k = key(runs[v][n])
            mark = "" if k == b else "  ⟵ DIFF"
            if k != b:
                disagree[v].append((n, b, k))
            cells.append(f"{k[0]} {k[1]}".strip() + mark)
        print(f"{n:<16} {cells[0]:<26} {cells[1]:<26} {cells[2]:<26}")

    n = len(images)
    print("\n" + "=" * 96)
    print(f"agreement with the current production pipeline ({n} images)")
    for v in ("onnx-fp32", "onnx-fp16"):
        agree = n - len(disagree[v])
        print(f"  {v:<10} {agree}/{n} = {agree/n*100:5.1f}%")

    print(f"\nverified reference plates ({len(KNOWN)} images with hand-checked values)")
    for fname, expect in KNOWN.items():
        row = [f"{fname:<16}"]
        for v in ("baseline", "onnx-fp32", "onnx-fp16"):
            got = key(runs[v][fname])
            row.append(f"{v}={'OK ' if got == expect else 'FAIL'}")
        print("  " + "  ".join(row) + f"   expected {expect[0]} {expect[1]}")

    print("\nlatency per image on this Mac (CPU EP, not a tablet — indicative only)")
    for v in ("baseline", "onnx-fp32", "onnx-fp16"):
        ms = [runs[v][p.name]["ms"] for p in images]
        print(f"  {v:<10} median {statistics.median(ms):6.1f} ms   mean {statistics.mean(ms):6.1f} ms")

    for v in ("onnx-fp32", "onnx-fp16"):
        if disagree[v]:
            print(f"\ndisagreements — {v}")
            for fname, b, k in disagree[v]:
                print(f"  {fname}: baseline '{b[0]} {b[1]}'  ->  {v} '{k[0]} {k[1]}'")

    Path(args.out).write_text(
        json.dumps({"images": [p.name for p in images], "runs": runs,
                    "disagreements": disagree}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\nfull results -> {args.out}")


if __name__ == "__main__":
    main()
