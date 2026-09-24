"""Phase 0 step 4 — attribute each disagreement to its real cause.

When the ported ONNX pipeline disagrees with production, there are two candidate
causes and they call for completely different responses:

  FP16 quantization   -> ship FP32 instead, or retrain/calibrate
  square letterbox    -> inherent to a fixed-shape mobile export; tune or accept

Ultralytics feeds a .pt model a RECTANGULAR letterbox (auto=True: pad only up to
the next multiple of 32). Our ONNX graph has a static 1x3x640x640 input, so the
port has to pad to a square. This script feeds the *original PyTorch weights*
that same square input — if the .pt moves too, FP16 is exonerated.

Run:  python tools/ondevice-ocr/diagnose_letterbox.py 338115_0.jpg 338121_0.jpg
"""
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
DETECTOR = Path("/Users/pongsatornbheungnoi/Documents/project/yolo_17-3-25/7.licenseplate_detector")
sys.path.insert(0, str(DETECTOR))

from lpr_onnx import letterbox, split_license_plate_and_province  # noqa: E402
from function.helper import data_province, get_thai_character      # noqa: E402
from ultralytics import YOLO                                       # noqa: E402


def run_pt(region, ocr, img, square: bool):
    """server.py's pipeline, optionally pre-letterboxed to a square 640."""
    src = letterbox(img)[0] if square else img
    for result in region(src, conf=0.3, verbose=False):
        for box in result.boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            roi = src[y1:y2, x1:x2]
            if roi.size == 0:
                continue
            roi_in = letterbox(roi)[0] if square else roi
            non_province, best_prov, best_conf = [], None, 0.0
            for pr in ocr(roi_in, conf=0.3, verbose=False):
                for pb in pr.boxes:
                    code, conf = ocr.names[int(pb.cls[0])], float(pb.conf[0])
                    if code in data_province:
                        if conf > best_conf:
                            best_conf, best_prov = conf, code
                    else:
                        non_province.append((int(pb.xyxy[0][0]), code))
            non_province.sort(key=lambda t: t[0])
            codes = [c for _, c in non_province] + ([best_prov] if best_prov else [])
            return split_license_plate_and_province("".join(get_thai_character(c) for c in codes))
    return (None, None)


def main():
    names = sys.argv[1:] or ["338115_0.jpg", "338121_0.jpg"]
    region = YOLO(str(DETECTOR / "model/license_plate.pt"))
    ocr = YOLO(str(DETECTOR / "model/data_plate.pt"))

    for name in names:
        img = cv2.imdecode(np.fromfile(str(DETECTOR / "license-car" / name), np.uint8), cv2.IMREAD_COLOR)
        rect = run_pt(region, ocr, img, square=False)
        sq = run_pt(region, ocr, img, square=True)
        verdict = "letterbox shape" if rect != sq else "not the letterbox — look at the port/quantization"
        print(f"{name}")
        print(f"   .pt, rect letterbox  (production today) : {rect[0]} {rect[1]}")
        print(f"   .pt, square 640x640  (what ONNX must do): {sq[0]} {sq[1]}")
        print(f"   -> cause: {verdict}\n")


if __name__ == "__main__":
    main()
