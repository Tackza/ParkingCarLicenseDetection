"""Phase 0 step 2 — the two-stage plate pipeline on plain ONNX Runtime + numpy.

This is the PORT TARGET. Everything Ultralytics does for us in Python
(letterbox, decode, NMS, box rescaling) is spelled out here, because the
Android/JS side will have to do exactly the same. Keep this file and the
eventual Kotlin/TS implementation in lockstep.

Mirrors `server.py :: detect_license_plate_from_image` decision for decision:
  - stage 1 conf 0.3, stage 2 conf 0.3, NMS IoU 0.7, max_det 300, per-class NMS
  - only the FIRST stage-1 box is used (server.py returns inside the box loop,
    and NMS output is score-ordered, so that is the highest-confidence plate)
  - of all province classes, only the single highest-confidence one is kept
  - non-province detections are ordered left-to-right by box x1
  - the province is appended last, then the string is split at the last digit
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

IMGSZ = 640
CONF_THRES = 0.3      # server.py passes conf=0.3 to both stages
IOU_THRES = 0.7       # ultralytics predict default
MAX_DET = 300         # ultralytics predict default
MAX_WH = 7680         # class-offset trick used by ultralytics for per-class NMS
PAD_VALUE = 114


# --------------------------------------------------------------------------
# preprocessing
# --------------------------------------------------------------------------
def letterbox(img: np.ndarray, new_shape: int = IMGSZ):
    """Resize keeping aspect ratio, pad to a square with 114-grey.

    Arithmetic copied from ultralytics LetterBox(auto=False, center=True,
    scaleup=True) so box coordinates come out identical.
    """
    h, w = img.shape[:2]
    r = min(new_shape / h, new_shape / w)
    new_unpad = (int(round(w * r)), int(round(h * r)))
    dw = (new_shape - new_unpad[0]) / 2
    dh = (new_shape - new_unpad[1]) / 2

    if (w, h) != new_unpad:
        img = cv2.resize(img, new_unpad, interpolation=cv2.INTER_LINEAR)

    top, bottom = int(round(dh - 0.1)), int(round(dh + 0.1))
    left, right = int(round(dw - 0.1)), int(round(dw + 0.1))
    img = cv2.copyMakeBorder(
        img, top, bottom, left, right, cv2.BORDER_CONSTANT,
        value=(PAD_VALUE, PAD_VALUE, PAD_VALUE),
    )
    return img, r, (left, top)


def to_tensor(img_bgr: np.ndarray) -> np.ndarray:
    """BGR HWC uint8 -> RGB NCHW float32 in [0,1]."""
    x = img_bgr[:, :, ::-1]                      # BGR -> RGB
    x = np.ascontiguousarray(x.transpose(2, 0, 1))  # HWC -> CHW
    return (x.astype(np.float32) / 255.0)[None]     # add batch dim


# --------------------------------------------------------------------------
# postprocessing
# --------------------------------------------------------------------------
def _nms(boxes: np.ndarray, scores: np.ndarray, iou_thres: float) -> list[int]:
    """Greedy IoU NMS, same ordering semantics as torchvision.ops.nms."""
    order = scores.argsort()[::-1]
    x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    areas = (x2 - x1) * (y2 - y1)
    keep = []
    while order.size:
        i = order[0]
        keep.append(int(i))
        if order.size == 1:
            break
        rest = order[1:]
        xx1 = np.maximum(x1[i], x1[rest])
        yy1 = np.maximum(y1[i], y1[rest])
        xx2 = np.minimum(x2[i], x2[rest])
        yy2 = np.minimum(y2[i], y2[rest])
        inter = np.clip(xx2 - xx1, 0, None) * np.clip(yy2 - yy1, 0, None)
        iou = inter / (areas[i] + areas[rest] - inter)
        order = rest[iou <= iou_thres]
    return keep


def decode(output: np.ndarray, r: float, pad, orig_hw, conf_thres=CONF_THRES):
    """(1, 4+nc, 8400) -> [(x1, y1, x2, y2, conf, cls), ...] in ORIGINAL image pixels.

    YOLOv8/11 heads emit box centre/size in network-input pixels plus per-class
    scores that are already sigmoid'd — there is no separate objectness term.
    """
    pred = output[0].T                      # (8400, 4+nc)
    boxes_xywh, class_scores = pred[:, :4], pred[:, 4:]

    cls = class_scores.argmax(1)
    conf = class_scores[np.arange(class_scores.shape[0]), cls]
    keep = conf > conf_thres                # ultralytics filters with >, not >=
    if not keep.any():
        return np.zeros((0, 6), dtype=np.float32)

    boxes_xywh, conf, cls = boxes_xywh[keep], conf[keep], cls[keep]

    xy, wh = boxes_xywh[:, :2], boxes_xywh[:, 2:4]
    boxes = np.concatenate([xy - wh / 2, xy + wh / 2], axis=1)  # xywh -> xyxy

    # per-class NMS via the class-offset trick (agnostic_nms=False)
    offset = cls[:, None].astype(np.float32) * MAX_WH
    idx = _nms(boxes + offset, conf, IOU_THRES)[:MAX_DET]
    boxes, conf, cls = boxes[idx], conf[idx], cls[idx]

    # undo the letterbox: remove padding, divide by the resize ratio, clip
    boxes[:, [0, 2]] -= pad[0]
    boxes[:, [1, 3]] -= pad[1]
    boxes /= r
    h, w = orig_hw
    boxes[:, [0, 2]] = boxes[:, [0, 2]].clip(0, w)
    boxes[:, [1, 3]] = boxes[:, [1, 3]].clip(0, h)

    return np.concatenate([boxes, conf[:, None], cls[:, None].astype(np.float32)], axis=1)


def split_license_plate_and_province(text: str):
    """Cut at the last digit — everything after it is the province.

    Same as helper.py; returns (None, None) when the string has no digit at all,
    which the API turns into `license_plate: null` with success=true.
    """
    i = len(text) - 1
    while i >= 0 and not text[i].isdigit():
        i -= 1
    if i < 0:
        return None, None
    return text[: i + 1], text[i + 1:]


# --------------------------------------------------------------------------
# the pipeline
# --------------------------------------------------------------------------
@dataclass
class Detection:
    plate: str | None = None
    province: str | None = None
    detected_classes: list = field(default_factory=list)
    combined_text: str = ""
    ok: bool = False
    error: str | None = None
    ms: dict = field(default_factory=dict)


class LprOnnx:
    def __init__(self, model_dir: Path, precision: str = "fp16", providers=None):
        model_dir = Path(model_dir)
        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        providers = providers or ["CPUExecutionProvider"]

        self.region = ort.InferenceSession(
            str(model_dir / f"plate_region.{precision}.onnx"), opts, providers=providers
        )
        self.ocr = ort.InferenceSession(
            str(model_dir / f"plate_ocr.{precision}.onnx"), opts, providers=providers
        )
        self.region_in = self.region.get_inputs()[0].name
        self.ocr_in = self.ocr.get_inputs()[0].name

        labels = json.loads((model_dir / "labels.json").read_text(encoding="utf-8"))
        self.labels = {int(k): v for k, v in labels.items()}
        self.precision = precision

    def _infer(self, session, input_name, img_bgr):
        lb, r, pad = letterbox(img_bgr)
        out = session.run(None, {input_name: to_tensor(lb)})[0]
        return decode(out, r, pad, img_bgr.shape[:2])

    def detect(self, img_bgr: np.ndarray) -> Detection:
        import time

        t0 = time.perf_counter()
        plates = self._infer(self.region, self.region_in, img_bgr)
        t1 = time.perf_counter()

        if len(plates) == 0:
            return Detection(ok=False, error="ไม่พบยานพาหนะในภาพ",
                             ms={"stage1": (t1 - t0) * 1e3})

        # server.py returns inside the box loop -> only the first (best) plate
        x1, y1, x2, y2 = (int(v) for v in plates[0][:4])
        roi = img_bgr[y1:y2, x1:x2]
        if roi.size == 0:
            return Detection(ok=False, error="ไม่พบยานพาหนะในภาพ",
                             ms={"stage1": (t1 - t0) * 1e3})

        chars = self._infer(self.ocr, self.ocr_in, roi)
        t2 = time.perf_counter()

        non_province = []           # (x1, class code)
        best_province, best_conf = None, 0.0
        for bx1, _, _, _, conf, cls in chars:
            info = self.labels[int(cls)]
            if info["is_province"]:
                if conf > best_conf:
                    best_conf, best_province = float(conf), info["code"]
            else:
                non_province.append((int(bx1), info["code"]))

        non_province.sort(key=lambda t: t[0])          # left to right
        codes = [c for _, c in non_province]
        if best_province:
            codes.append(best_province)                # province always last

        code_to_thai = {v["code"]: v["thai"] for v in self.labels.values()}
        combined = "".join(code_to_thai.get(c, c) for c in codes)
        plate, province = split_license_plate_and_province(combined)

        return Detection(
            plate=plate, province=province, detected_classes=codes,
            combined_text=combined, ok=True,
            ms={"stage1": (t1 - t0) * 1e3, "stage2": (t2 - t1) * 1e3,
                "total": (t2 - t0) * 1e3},
        )

    def detect_file(self, path) -> Detection:
        img = cv2.imdecode(np.fromfile(str(path), dtype=np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            return Detection(ok=False, error="ไม่สามารถอ่านไฟล์ภาพได้")
        return self.detect(img)
