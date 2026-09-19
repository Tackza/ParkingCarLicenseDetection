"""Prepare stage-1 + stage-2 tensors for the 5 hand-verified reference images."""
import sys, json
from pathlib import Path
import numpy as np, cv2
REPO = Path("/Users/pongsatornbheungnoi/Documents/project/expo-react-native-bluetooth-escpos-printer")
sys.path.insert(0, str(REPO / "tools/ondevice-ocr"))
from lpr_onnx import LprOnnx, letterbox, to_tensor, decode  # noqa
D = Path("/Users/pongsatornbheungnoi/Documents/project/yolo_17-3-25/7.licenseplate_detector")
OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
IMAGES = ["338111_0.jpg","338089_0.jpg","338092_0.jpg","338095_0.jpg","338120_0.jpg"]
eng = LprOnnx(D/"model/onnx", precision="fp16")
meta = {}
for name in IMAGES:
    img = cv2.imdecode(np.fromfile(str(D/"license-car"/name), np.uint8), cv2.IMREAD_COLOR)
    lb1, r1, pad1 = letterbox(img); t1 = to_tensor(lb1).astype(np.float32)
    t1.tofile(OUT/f"{name}.s1.bin")
    out1 = eng.region.run(None, {eng.region_in: t1})[0]
    b = decode(out1, r1, pad1, img.shape[:2])[0]
    x1,y1,x2,y2 = (int(v) for v in b[:4]); roi = img[y1:y2, x1:x2]
    lb2, r2, pad2 = letterbox(roi); to_tensor(lb2).astype(np.float32).tofile(OUT/f"{name}.s2.bin")
    d = eng.detect(img)
    meta[name] = {"box":[x1,y1,x2,y2], "roi":[roi.shape[1],roi.shape[0]],
                  "r1":r1,"pad1":list(pad1),"r2":r2,"pad2":list(pad2),
                  "img":[img.shape[1],img.shape[0]], "mac":[d.plate,d.province]}
    print(f"{name}: mac fp16 -> {d.plate} {d.province}")
(OUT/"meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
