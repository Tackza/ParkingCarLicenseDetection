// file: components/LoginScene.js
//
// ฉากเมืองด้านล่างของหน้าเข้าสู่ระบบ — ถอดแบบจาก LoginScene.vue ของหน้า login ระบบแอดมิน
// (mbus_dhamakaya/mbus_admin_w/src/components/bus/hero/LoginScene.vue) ผู้ใช้ขอ 2026-11-28
//
// ต้นฉบับเป็น SVG + CSS keyframes แต่แอปนี้ไม่มี react-native-svg / expo-linear-gradient (native — ต้อง build APK)
// จึงวาดด้วย View ล้วนและขยับด้วย Animated (native driver) เพื่อให้ส่งผ่าน OTA ได้
//
// พิกัดทั้งหมดเป็น "หน่วย" ของต้นฉบับ (viewBox 1440×300) แล้วคูณ s ตอนวาด
// จอ SUNMI กว้าง 360dp จึงตัดเหลือช่วง x 800–1440 (เจดีย์ ตึก ป้ายรถ คนรอขึ้นรถ) — ศาลาฝั่งซ้ายตกจอ
// รอบ 14 วินาที: 0–25% รถเข้ามาจอด · 25–62% จอดรอคนขึ้น · 62–100% ออกไป (เหมือนต้นฉบับ)

import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, useWindowDimensions, View } from 'react-native';

const VIEW_X = 800;          // ขอบซ้ายของช่วงที่แสดง (หน่วยต้นฉบับ)
const VIEW_W = 640;          // ความกว้างที่แสดง (หน่วยต้นฉบับ)
const VIEW_H = 300;
const CYCLE_MS = 14000;
const ACCENT = '#1d6fa5';
const GOLD = '#f2b33d';

// ─── keyframes → Animated.interpolate ───────────────────────────────────────
// interpolate รับได้แค่เส้นตรงระหว่างจุด จึงสุ่มค่าละเอียดจากฟังก์ชัน keyframe (รวม easing) เป็นตาราง
const SAMPLES = 280;
const sampled = (fn) => {
  const inputRange = [];
  const outputRange = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    inputRange.push(t);
    outputRange.push(fn(t));
  }
  return { inputRange, outputRange };
};

// keys: [[t, value, easing?]] — easing ใช้กับช่วงจาก key นั้นไป key ถัดไป
const keyframes = (keys) => (t) => {
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0, ease] = keys[i];
    const [t1, v1] = keys[i + 1];
    if (t >= t0 && t <= t1) {
      const p = t1 === t0 ? 1 : (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * (ease ? ease(p) : p);
    }
  }
  return keys[keys.length - 1][1];
};

const IN = Easing.bezier(0.2, 0.65, 0.3, 1);
const OUT = Easing.bezier(0.6, 0, 0.85, 0.4);
const STOP_X = 1110;

// รถรับคน: เข้ามาจอด → รอ → ออก
const boardX = keyframes([[0, -300, IN], [0.25, STOP_X], [0.62, STOP_X, OUT], [1, 1780]]);

// ผู้โดยสาร: ยืนรอ → เดินถึงประตู → หายหลังรถ → ชุดใหม่เดินเข้ามาจากขวา (delay = เลื่อนรอบ)
const paxX = (dx) => keyframes([[0, 0], [0.28, 0], [0.37, dx], [0.39, dx], [0.70, 260], [0.71, 260], [0.92, 0], [1, 0]]);
const paxOpacity = keyframes([[0, 1], [0.37, 1], [0.39, 0], [0.70, 0], [0.71, 1], [1, 1]]);
// ตัวโยกเป็นจังหวะก้าวเฉพาะตอนเดิน
const paxBob = (t) => {
  const pct = Math.floor(t * 100);
  const walking = (pct >= 28 && pct <= 37) || (pct >= 71 && pct <= 92);
  return walking && pct % 2 === 1 ? -1.4 : 0;
};
const shifted = (fn, delaySec) => (t) => fn((((t - delaySec * 1000 / CYCLE_MS) % 1) + 1) % 1);

const PASSENGERS = [
  { id: 'adult', x: 1300, dx: -104, delay: 0 },
  { id: 'monk', x: 1322, dx: -126, delay: 0.6 },
  { id: 'child', x: 1346, dx: -150, delay: 1.2 },
  { id: 'woman', x: 1372, dx: -176, delay: 1.8 },
];

// รถเลนหน้าวิ่งผ่านตลอด (เส้นตรง 22 วินาที) ; rest = ที่จอดนิ่งเมื่อเครื่องตั้งลดการเคลื่อนไหว
const TRAFFIC = [
  { id: 1, variant: 'white', durationMs: 22000, offset: 6 / 22, rest: 900 },
  { id: 2, variant: 'gold', durationMs: 22000, offset: 17 / 22, rest: 1250 },
];

// ตึกในช่วงที่แสดง [x, y, w, h]
const FAR = [[1040, 116, 56, 110], [1104, 80, 44, 146], [1156, 132, 70, 94], [1236, 100, 40, 126], [1390, 120, 50, 106]];
const NEAR = [[1060, 156, 64, 70], [1180, 170, 70, 56]];
const TREES = [[960, 212, 18], [984, 202, 22], [1408, 210, 16]];
const BUSHES = [[978, 220, 11]];

// ─── ชิ้นส่วนวาด ─────────────────────────────────────────────────────────────

const Box = ({ s, x, y, w, h, color, r = 0, style }) => (
  <View
    style={[{ position: 'absolute', left: (x - VIEW_X) * s, top: y * s, width: w * s, height: h * s, backgroundColor: color, borderRadius: r * s }, style]}
  />
);

const Dot = ({ s, cx, cy, r, color }) => (
  <Box s={s} x={cx - r} y={cy - r} w={r * 2} h={r * 2} r={r} color={color} />
);

// สามเหลี่ยมยอดแหลม (ใช้ border) — ฐานกว้าง w สูง h ปลายบนอยู่กลาง
const Spire = ({ s, x, y, w, h, color }) => (
  <View
    style={{
      position: 'absolute', left: (x - VIEW_X) * s, top: y * s, width: 0, height: 0,
      borderLeftWidth: (w / 2) * s, borderRightWidth: (w / 2) * s, borderBottomWidth: h * s,
      borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: color,
    }}
  />
);

/** รถบัสด้านข้าง กล่อง 64×34 หน่วยรถ ; k = px ต่อหน่วยรถ — แบบเดียวกับ BusArtShapes.vue */
const Bus = ({ k, variant }) => {
  const white = variant !== 'accent';
  const body = white ? '#ffffff' : ACCENT;
  const glass = white ? '#bfddf0' : '#dcebf5';
  const roof = variant === 'white' ? ACCENT : variant === 'gold' ? GOLD : null;
  const stripe = variant === 'gold' ? ACCENT : GOLD;
  const at = (x, y, w, h, extra) => ({ position: 'absolute', left: x * k, top: y * k, width: w * k, height: h * k, ...extra });
  return (
    <View style={{ width: 64 * k, height: 34 * k }}>
      <View
        style={at(3, 3, 59, 26, {
          backgroundColor: body, borderTopLeftRadius: 4 * k, borderTopRightRadius: 9 * k,
          borderBottomLeftRadius: 2 * k, borderBottomRightRadius: 2 * k, overflow: 'hidden',
          borderWidth: white ? Math.max(1, 0.6 * k) : 0, borderColor: '#c9dce8',
        })}
      >
        {roof && <View style={at(0, 0, 59, 3, { backgroundColor: roof })} />}
      </View>
      {[8, 20, 32].map((x) => (
        <View key={x} style={at(x, white ? 9 : 8, 9, 7, { backgroundColor: glass, borderRadius: 1.5 * k })} />
      ))}
      <View style={at(45, white ? 9 : 8, 11, 7, { backgroundColor: glass, borderTopRightRadius: 4 * k, borderRadius: 1 * k })} />
      <View style={at(3, 19, 59, 2.5, { backgroundColor: stripe })} />
      <View style={at(58.5, 22.5, 3, 2, { backgroundColor: '#ffd66b', borderRadius: 1 * k })} />
      {[15, 49].map((cx) => (
        <View key={cx} style={at(cx - 4.5, 22.5, 9, 9, { backgroundColor: '#20323f', borderRadius: 4.5 * k, alignItems: 'center', justifyContent: 'center' })}>
          <View style={{ width: 3.2 * k, height: 3.2 * k, borderRadius: 1.6 * k, backgroundColor: '#e3ecf2' }} />
        </View>
      ))}
    </View>
  );
};

/** ผู้โดยสาร — จุดอ้างอิงคือเท้า (กลางล่าง) ; k = px ต่อหน่วย */
const Person = ({ k, kind }) => {
  const at = (x, y, w, h, color, r = 0) => (
    <View style={{ position: 'absolute', left: (x + 8) * k, top: (y + 30) * k, width: w * k, height: h * k, backgroundColor: color, borderRadius: r * k }} />
  );
  const head = (cy, r, skin, hair) => (
    <>
      {at(-r, cy - r, r * 2, r * 2, skin, r)}
      {hair && <View style={{ position: 'absolute', left: (8 - r) * k, top: (30 + cy - r) * k, width: r * 2 * k, height: r * k, backgroundColor: hair, borderTopLeftRadius: r * k, borderTopRightRadius: r * k }} />}
    </>
  );
  const scale = kind === 'child' ? 0.78 : 1;
  return (
    <View style={{ width: 16 * k, height: 30 * k, transform: [{ scale }, { translateY: kind === 'child' ? 3.3 * k : 0 }] }}>
      {kind === 'adult' && (
        <>
          {at(-3.6, -8, 3, 8, '#2b3a4a', 1.4)}
          {at(0.6, -8, 3, 8, '#2b3a4a', 1.4)}
          {at(-5, -20, 10, 13, ACCENT, 4)}
          {at(4, -17, 4, 6, GOLD, 1.2)}
          {head(-24, 4.2, '#f1c9a5', '#2b2b2b')}
        </>
      )}
      {kind === 'monk' && (
        <>
          {at(-6, -20, 12, 19.6, '#e8912d', 2)}
          {at(-4.4, -1.2, 8.8, 1.4, '#7a4e00', 0.7)}
          {head(-24, 4.2, '#e9be98', null)}
        </>
      )}
      {kind === 'child' && (
        <>
          {at(-3.4, -8, 3, 8, '#1d6fa5', 1.4)}
          {at(0.4, -8, 3, 8, '#1d6fa5', 1.4)}
          {at(-5, -19, 10, 12, GOLD, 4)}
          {head(-23, 4.4, '#f1c9a5', '#3a2a20')}
        </>
      )}
      {kind === 'woman' && (
        <>
          {at(-3.2, -7, 2.6, 7, '#2b3a4a', 1.2)}
          {at(0.6, -7, 2.6, 7, '#2b3a4a', 1.2)}
          {at(-5.5, -20, 11, 13.4, '#1e8a6e', 3)}
          {head(-24, 4.2, '#f1c9a5', '#3a2a20')}
          {at(-6.8, -28.2, 4.4, 4.4, '#3a2a20', 2.2)}
        </>
      )}
    </View>
  );
};

// ─── ฉาก ─────────────────────────────────────────────────────────────────────

export default function LoginScene() {
  const { width } = useWindowDimensions();
  const s = width / VIEW_W;
  const height = VIEW_H * s;

  const cycle = useRef(new Animated.Value(0)).current;
  const drive = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);

  useEffect(() => {
    if (reduceMotion) return undefined;
    const loops = [
      Animated.loop(Animated.timing(cycle, { toValue: 1, duration: CYCLE_MS, easing: Easing.linear, useNativeDriver: true })),
      Animated.loop(Animated.timing(drive, { toValue: 1, duration: TRAFFIC[0].durationMs, easing: Easing.linear, useNativeDriver: true })),
    ];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [cycle, drive, reduceMotion]);

  // แปลงหน่วยต้นฉบับเป็น px ตอนสร้างตาราง ไม่ต้องคูณ s ซ้ำทุกเฟรม
  const anim = useMemo(() => {
    const px = (fn) => (t) => fn(t) * s;
    const board = cycle.interpolate(sampled(px((t) => boardX(t) - VIEW_X)));
    const pax = PASSENGERS.map((p) => ({
      ...p,
      tx: cycle.interpolate(sampled(px(shifted(paxX(p.dx), p.delay)))),
      ty: cycle.interpolate(sampled(px(shifted(paxBob, p.delay)))),
      opacity: cycle.interpolate(sampled(shifted(paxOpacity, p.delay))),
    }));
    const traffic = TRAFFIC.map((b) => ({
      ...b,
      // เส้นตรงที่วนรอบ: ใส่จุดตัดตรงๆ ไม่ใช้ตารางสุ่ม ไม่งั้นช่วงที่ค่ากระโดดกลับซ้ายจะกลายเป็นรถวิ่งย้อนข้ามจอ
      tx: drive.interpolate({
        inputRange: [0, 1 - b.offset, 1 - b.offset + 1e-4, 1],
        outputRange: [-320 + b.offset * 2100, 1780, -320, -320 + b.offset * 2100].map((u) => (u - VIEW_X) * s),
      }),
    }));
    return { board, pax, traffic };
  }, [cycle, drive, s]);

  const stillBoard = (STOP_X - VIEW_X) * s;

  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={{ width, height, overflow: 'hidden' }}>
      {/* ตึกแถวหลัง (บางตึกมีหน้าต่าง) และแถวหน้า */}
      {FAR.map(([x, y, w, h], i) => (
        <Box key={`f${i}`} s={s} x={x} y={y} w={w} h={h} color="#d4e8f2" />
      ))}
      {[...Array(9)].map((_, row) => [0, 1, 2].map((col) => (
        <Box key={`w${row}-${col}`} s={s} x={1107 + col * 12} y={88 + row * 14} w={5} h={6} r={1} color="#e7f2f9" />
      )))}
      {NEAR.map(([x, y, w, h], i) => (
        <Box key={`n${i}`} s={s} x={x} y={y} w={w} h={h} r={2} color="#c4ddea" />
      ))}

      {/* เจดีย์ */}
      <Spire s={s} x={853} y={90} w={14} h={70} color="#f0b35a" />
      <Dot s={s} cx={860} cy={88} r={3} color={GOLD} />
      <Box s={s} x={852} y={160} w={16} h={12} color="#f3d79a" />
      <Box s={s} x={836} y={172} w={48} h={48} r={24} color="#fff8ea" style={{ borderWidth: 1.5 * s, borderColor: '#ead9b0' }} />
      <Box s={s} x={832} y={196} w={56} h={12} color="#fff8ea" style={{ borderWidth: 1.5 * s, borderColor: '#ead9b0' }} />
      <Box s={s} x={822} y={208} w={76} h={18} color="#fff8ea" style={{ borderWidth: 1.5 * s, borderColor: '#ead9b0' }} />

      {TREES.map(([cx, cy, r], i) => <Dot key={`t${i}`} s={s} cx={cx} cy={cy} r={r} color="#a9d6c3" />)}
      {BUSHES.map(([cx, cy, r], i) => <Dot key={`b${i}`} s={s} cx={cx} cy={cy} r={r} color="#8cc7ae" />)}

      {/* ทางเท้า ถนน เส้นประ */}
      <Box s={s} x={VIEW_X} y={226} w={VIEW_W} h={14} color="#eaf2f7" style={{ borderTopWidth: 1.5 * s, borderTopColor: '#d7e5ee' }} />
      <Box s={s} x={VIEW_X} y={240} w={VIEW_W} h={60} color="#dde8ef" style={{ borderTopWidth: 2 * s, borderTopColor: '#cadbe6' }} />
      {[...Array(12)].map((_, i) => (
        <Box key={`d${i}`} s={s} x={VIEW_X + 10 + i * 56} y={269} w={30} h={4} color="#ffffff" />
      ))}

      {/* ป้ายรถ */}
      <Box s={s} x={1294} y={197} w={78} h={27} color="rgba(255,255,255,0.55)" style={{ borderWidth: 1 * s, borderColor: '#cadbe6' }} />
      <Box s={s} x={1286} y={190} w={94} h={7} r={3} color={GOLD} />
      <Box s={s} x={1292} y={197} w={3} h={39} color={ACCENT} />
      <Box s={s} x={1371} y={197} w={3} h={39} color={ACCENT} />
      <Box s={s} x={1267} y={200} w={2} h={36} color="#8aa1b3" />
      <Dot s={s} cx={1268} cy={196} r={8} color={ACCENT} />
      <Box s={s} x={1263.5} y={193} w={9} h={5} r={1.5} color="#ffffff" />

      {/* ผู้โดยสาร — อยู่หลังรถที่จอด เดินถึงประตูแล้วหายไป = ขึ้นรถแล้ว */}
      {anim.pax.map((p) => (
        <Animated.View
          key={p.id}
          style={{
            position: 'absolute', left: (p.x - VIEW_X - 8) * s, top: (236 - 30) * s,
            opacity: reduceMotion ? 1 : p.opacity,
            transform: reduceMotion ? [] : [{ translateX: p.tx }, { translateY: p.ty }],
          }}
        >
          <Person k={s} kind={p.id} />
        </Animated.View>
      ))}

      {/* รถที่เข้ามาจอดรับผู้โดยสาร (เลนติดทางเท้า) */}
      <Animated.View style={{ position: 'absolute', left: 0, top: 205 * s, transform: [{ translateX: reduceMotion ? stillBoard : anim.board }] }}>
        <Bus k={1.6 * s} variant="accent" />
      </Animated.View>

      {/* รถเลนหน้า */}
      {anim.traffic.map((b) => (
        <Animated.View key={b.id}
          style={{ position: 'absolute', left: 0, top: 237 * s, transform: [{ translateX: reduceMotion ? (b.rest - VIEW_X) * s : b.tx }] }}>
          <Bus k={1.75 * s} variant={b.variant} />
        </Animated.View>
      ))}
    </View>
  );
}
