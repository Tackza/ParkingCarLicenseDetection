"""Phase 0 step 1 — export the two YOLO models to ONNX (FP32 + FP16) for on-device use.

Source of truth is the detector folder (not under version control):
    /Users/pongsatornbheungnoi/Documents/project/yolo_17-3-25/7.licenseplate_detector

Outputs land in <detector>/model/onnx/ and are NOT committed here — they are
build artifacts. Only the label table is copied back into this repo, because
the app will embed it.

Run:  python tools/ondevice-ocr/export_models.py
"""
import argparse
import json
import shutil
from pathlib import Path

import onnx
# onnxconverter-common's converter emits a broken cast around the Resize nodes in
# these YOLO graphs ("Type (tensor(float)) ... does not match expected type
# (tensor(float16))" at load time). ONNX Runtime's own converter handles them.
from onnxruntime.transformers.float16 import convert_float_to_float16
from ultralytics import YOLO

DETECTOR = Path("/Users/pongsatornbheungnoi/Documents/project/yolo_17-3-25/7.licenseplate_detector")
MODELS = {
    # name          source .pt            what it does
    "plate_region": "model/license_plate.pt",   # stage 1 — finds the plate box (1 class)
    "plate_ocr": "model/data_plate.pt",         # stage 2 — reads chars/digits/province (125 classes)
}
IMGSZ = 640
# opset 12 is understood by every ONNX Runtime Android build we might ship;
# raising it buys nothing for these two nano nets.
OPSET = 12


def export_one(name: str, pt_rel: str, out_dir: Path) -> dict:
    src = DETECTOR / pt_rel
    if not src.exists():
        raise SystemExit(f"missing model: {src}")

    model = YOLO(str(src))
    n_params = sum(p.numel() for p in model.model.parameters())
    names = dict(model.model.names)

    print(f"[{name}] {pt_rel} — {len(names)} classes, {n_params/1e6:.2f}M params")

    # ultralytics writes <name>.onnx next to the .pt; stash anything already
    # there first — the detector folder has no version control to fall back on.
    collision = src.with_suffix(".onnx")
    stashed = None
    if collision.exists():
        stashed = collision.with_suffix(".onnx.bak")
        shutil.copy2(collision, stashed)
        print(f"[{name}] stashed pre-existing {collision.name} -> {stashed.name}")

    produced = model.export(
        format="onnx",
        imgsz=IMGSZ,
        opset=OPSET,
        dynamic=False,   # fixed 1x3x640x640 — mobile runtimes prefer static shapes
        simplify=True,
        half=False,      # FP16 is done below; ultralytics refuses half=True on CPU export
        device="cpu",
        verbose=False,
    )

    fp32 = out_dir / f"{name}.fp32.onnx"
    shutil.move(str(produced), fp32)
    if stashed:  # put the original back where it was
        shutil.move(str(stashed), collision)

    fp16 = out_dir / f"{name}.fp16.onnx"
    # keep_io_types=True: graph maths in FP16, but input/output stay FP32 so the
    # Android/JS caller keeps feeding plain float32 buffers.
    onnx.save(
        convert_float_to_float16(onnx.load(str(fp32)), keep_io_types=True),
        str(fp16),
    )

    m = onnx.load(str(fp32))
    inp = m.graph.input[0]
    out = m.graph.output[0]
    shape = lambda v: [d.dim_value or d.dim_param for d in v.type.tensor_type.shape.dim]

    info = {
        "name": name,
        "source_pt": pt_rel,
        "classes": len(names),
        "params_m": round(n_params / 1e6, 2),
        "imgsz": IMGSZ,
        "opset": OPSET,
        "input": {"name": inp.name, "shape": shape(inp)},
        "output": {"name": out.name, "shape": shape(out)},
        "size_mb": {
            "pt": round(src.stat().st_size / 1e6, 2),
            "fp32": round(fp32.stat().st_size / 1e6, 2),
            "fp16": round(fp16.stat().st_size / 1e6, 2),
        },
        "names": {int(k): v for k, v in names.items()},
    }
    print(
        f"[{name}] in {info['input']['shape']} -> out {info['output']['shape']} | "
        f"pt {info['size_mb']['pt']}MB, fp32 {info['size_mb']['fp32']}MB, fp16 {info['size_mb']['fp16']}MB"
    )
    return info


def build_label_table(ocr_names: dict) -> dict:
    """Class index -> {code, thai, is_province}, read straight out of helper.py.

    helper.py is the detector's own source of truth; we import it rather than
    re-typing 125 labels, so the two systems cannot drift here.
    """
    import sys

    sys.path.insert(0, str(DETECTOR))
    from function.helper import data_province, get_thai_character  # noqa: E402

    table, unmapped = {}, []
    for idx, code in sorted(ocr_names.items()):
        thai = get_thai_character(code)
        if thai == code and not code.isdigit():
            unmapped.append(code)
        table[str(idx)] = {
            "code": code,
            "thai": thai,
            "is_province": code in data_province,
        }
    if unmapped:
        print(f"⚠️  {len(unmapped)} class codes have no Thai mapping: {unmapped}")
    else:
        print(f"✅ all {len(table)} OCR classes map to a Thai label")
    return table


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(DETECTOR / "model" / "onnx"))
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest = {"imgsz": IMGSZ, "opset": OPSET, "models": {}}
    for name, pt_rel in MODELS.items():
        manifest["models"][name] = export_one(name, pt_rel, out_dir)

    labels = build_label_table(manifest["models"]["plate_ocr"]["names"])
    manifest["label_count"] = len(labels)
    manifest["province_count"] = sum(1 for v in labels.values() if v["is_province"])

    (out_dir / "labels.json").write_text(
        json.dumps(labels, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    # the label table is small and the app has to embed it — keep a copy in-repo
    repo_labels = Path(__file__).parent / "labels.json"
    repo_labels.write_text(json.dumps(labels, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\nwrote {out_dir}/  (labels.json, manifest.json, *.fp32.onnx, *.fp16.onnx)")
    print(f"labels: {len(labels)} classes, {manifest['province_count']} of them provinces")


if __name__ == "__main__":
    main()
