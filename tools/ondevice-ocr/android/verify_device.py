import sys, json
from pathlib import Path
import numpy as np, cv2
REPO = Path("/Users/pongsatornbheungnoi/Documents/project/expo-react-native-bluetooth-escpos-printer")
sys.path.insert(0, str(REPO / "tools/ondevice-ocr"))
from lpr_onnx import decode, split_license_plate_and_province  # noqa
D = Path("/Users/pongsatornbheungnoi/Documents/project/yolo_17-3-25/7.licenseplate_detector")
B = Path(sys.argv[1])
labels = {int(k): v for k, v in json.loads((D/"model/onnx/labels.json").read_text(encoding="utf-8")).items()}
c2t = {v["code"]: v["thai"] for v in labels.values()}
meta = json.loads((B/"set5/meta.json").read_text(encoding="utf-8"))
EXPECT = {"338111_0.jpg":("นข2628","สิงห์บุรี"),"338089_0.jpg":("2กท5518","กรุงเทพมหานคร"),
          "338092_0.jpg":("นข7039","พิษณุโลก"),"338095_0.jpg":("ฮพ2078","กรุงเทพมหานคร"),
          "338120_0.jpg":("321527","กรุงเทพมหานคร")}
print(f"{'image':<16} {'device (SUNMI V3)':<26} {'mac':<26} {'expected':<26} match")
print("-"*106)
allok = True
for name, m in meta.items():
    o1 = np.fromfile(B/f"set5out/{name}.o1.bin", np.float32).reshape(1,5,8400)
    box = decode(o1, m["r1"], tuple(m["pad1"]), (m["img"][1], m["img"][0]))[0]
    o2 = np.fromfile(B/f"set5out/{name}.o2.bin", np.float32).reshape(1,129,8400)
    chars = decode(o2, m["r2"], tuple(m["pad2"]), (m["roi"][1], m["roi"][0]))
    npv, bp, bc = [], None, 0.0
    for bx1,_,_,_,conf,cls in chars:
        i = labels[int(cls)]
        if i["is_province"]:
            if conf > bc: bc, bp = float(conf), i["code"]
        else: npv.append((int(bx1), i["code"]))
    npv.sort(key=lambda t:t[0])
    codes = [c for _,c in npv] + ([bp] if bp else [])
    plate, prov = split_license_plate_and_province("".join(c2t.get(c,c) for c in codes))
    dev, mac, exp = (plate or "", prov or ""), tuple(m["mac"]), EXPECT[name]
    ok = dev == mac == exp
    allok &= ok
    print(f"{name:<16} {dev[0]+' '+dev[1]:<26} {mac[0]+' '+mac[1]:<26} {exp[0]+' '+exp[1]:<26} {'OK' if ok else 'FAIL'}")
print("\n" + ("✅ device == mac == hand-verified, 5/5" if allok else "❌ mismatch"))
