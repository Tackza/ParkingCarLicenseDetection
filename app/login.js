import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import LoginScene from '../components/LoginScene';
import { getActiveSession, saveSession } from "../constants/Database";
import { useAuth } from '../contexts/AuthContext';
import { useProject } from '../contexts/ProjectContext';

// หน้าเข้าสู่ระบบ — ฟ้า พระอาทิตย์ เมฆ และฉากเมืองแบบหน้า login ของระบบแอดมิน (ผู้ใช้ขอ 2026-11-28)
// ไม่มี react-native-svg / expo-linear-gradient ในแอป (native ต้อง build APK) จึงทำไล่สีฟ้าด้วยแถบ View
// และ animation ด้วย Animated (native driver) — ส่งผ่าน OTA ได้

// ไล่สีฟ้า #bee3f6 → #d9effa (46%) → #f4f9fc เป็นแถบบางๆ 64 แถบ แทน linear-gradient
// (11 แถบเห็นเป็นลายขั้นบันไดบนจอ SUNMI) — คำนวณครั้งเดียวตอนโหลดไฟล์
const mix = (a, b, t) => {
  const c = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `rgb(${[0, 1, 2].map((i) => Math.round(c(a, i) + (c(b, i) - c(a, i)) * t)).join(',')})`;
};
const SKY = Array.from({ length: 64 }, (_, i) => {
  const t = i / 63;
  return t < 0.46 ? mix('#bee3f6', '#d9effa', t / 0.46) : mix('#d9effa', '#f4f9fc', (t - 0.46) / 0.54);
});
const ICON_MUTED = '#6e7580';
const ACCENT = '#1d6fa5';

// เงาการ์ด — RN ใช้ shadow* คู่กับ elevation ของ Android ซึ่ง utility ของ Tailwind ไม่ครอบคลุม
const CARD_SHADOW = {
  shadowColor: '#164262',
  shadowOffset: { width: 0, height: 18 },
  shadowOpacity: 0.22,
  shadowRadius: 26,
  elevation: 10,
};
const BUTTON_SHADOW = {
  shadowColor: '#145c8c',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.35,
  shadowRadius: 12,
  elevation: 6,
};

const Cloud = ({ width, style }) => (
  <Animated.View pointerEvents="none" style={[{ position: 'absolute', width, height: width * 0.42 }, style]}>
    {[[38, 30, 14], [60, 22, 18], [82, 30, 13]].map(([cx, cy, r]) => (
      <View key={cx} style={{ position: 'absolute', left: ((cx - r) / 120) * width, top: ((cy - r) / 120) * width, width: (r * 2 / 120) * width, height: (r * 2 / 120) * width, borderRadius: width, backgroundColor: '#ffffff' }} />
    ))}
    <View style={{ position: 'absolute', left: (24 / 120) * width, top: (30 / 120) * width, width: (72 / 120) * width, height: (14 / 120) * width, borderRadius: (7 / 120) * width, backgroundColor: '#ffffff' }} />
  </Animated.View>
);

export default function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // เพิ่ม state เพื่อตรวจสอบสถานะการโหลดข้อมูลจาก AsyncStorage
  const [isCheckingStorage, setIsCheckingStorage] = useState(true);
  const { login, isLoading } = useAuth();
  const router = useRouter();
  const { syncProjectsWithApi } = useProject();
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState(null); // 'user' | 'pass' | null
  // คีย์บอร์ดเปิด = ซ่อนฉากเมือง ให้การ์ดมีที่พอบนจอ 800dp
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const rise = useRef(new Animated.Value(0)).current;
  const sun = useRef(new Animated.Value(0)).current;
  const cloud = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // การ์ดลอยขึ้นตอนเปิด, พระอาทิตย์หายใจ 6 วินาที, เมฆลอยไปกลับ — เหมือนหน้า login ของระบบแอดมิน
  useEffect(() => {
    Animated.timing(rise, { toValue: 1, duration: 800, delay: 120, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    const loops = [
      Animated.loop(Animated.sequence([
        Animated.timing(sun, { toValue: 1, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(sun, { toValue: 0, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])),
      Animated.loop(Animated.sequence([
        Animated.timing(cloud, { toValue: 1, duration: 16000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(cloud, { toValue: 0, duration: 16000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])),
    ];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [rise, sun, cloud]);

  // ✨ (เพิ่มส่วนนี้) - ตรวจสอบการล็อกอินอัตโนมัติเมื่อคอมโพเนนต์เริ่มทำงาน
  useEffect(() => {
    const checkLoginStatus = async () => {
      try {
        console.log('กำลังตรวจสอบ Session ใน SQLite...');
        const session = await getActiveSession();
        console.log('session :>> ', session);

        // ถ้ามี token อยู่ ให้ข้ามไปหน้าหลักเลย
        if (session) {
          console.log('พบ Token, กำลังเข้าสู่ระบบอัตโนมัติ...');
          // อาจจะต้องมีการตรวจสอบ token กับ server อีกครั้งใน useAuth
          // แต่ในที่นี้เราจะข้ามไปเลยเพื่อความง่าย
          router.replace('/bluetooth-setup');
        }
      } catch (e) {
        console.error('ไม่สามารถอ่านข้อมูลจาก AsyncStorage ได้', e);
      } finally {
        // ตรวจสอบเสร็จสิ้น ให้แสดงฟอร์มล็อกอิน
        setIsCheckingStorage(false);
      }
    };

    checkLoginStatus();
  }, []);

  const handleLogin = async () => {
    if (!username || !password) {
      Alert.alert('ข้อผิดพลาด', 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
      return;
    }

    const result = await login(username, password);
    console.log('result :>> ', result);

    if (result?.status == 'success') {
      try {
        // บันทึก Session และ Token ลง DB ก่อน
        await saveSession(result.data);
        console.log('Session saved successfully.');

        // ✅ 3. สั่งให้ Sync ข้อมูลโปรเจกต์ทันทีหลังจาก Login สำเร็จ
        await syncProjectsWithApi();

        // เมื่อทุกอย่างพร้อม ก็ไปหน้าต่อไป
        router.replace('/bluetooth-setup');

      } catch (e) {
        console.error('ไม่สามารถบันทึกข้อมูลลง SQLite ได้', e);
        Alert.alert('ข้อผิดพลาด', 'ไม่สามารถบันทึกเซสชันการล็อกอินได้');
      }
    } else {
      Alert.alert('เข้าสู่ระบบไม่สำเร็จ', result.message);
    }
  };

  // ✨ (เพิ่มส่วนนี้) - แสดงหน้าจอ Loading ขณะตรวจสอบข้อมูล
  if (isCheckingStorage) {
    return (
      <View className="flex-1 justify-center items-center" style={{ backgroundColor: '#d9effa' }}>
        <ActivityIndicator size="large" color={ACCENT} />
      </View>
    );
  }

  const sunScale = sun.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const cloudX = cloud.interpolate({ inputRange: [0, 1], outputRange: [0, 70] });
  const cloudXSlow = cloud.interpolate({ inputRange: [0, 1], outputRange: [0, 40] });
  const fieldBox = (name) =>
    `flex-row items-center rounded-[14px] border bg-surface px-[14px] h-[54px] ${focused === name ? 'border-primary' : 'border-border'}`;

  return (
    <View className="flex-1">
      {/* ฟ้า */}
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
        {SKY.map((c, i) => <View key={i} style={{ flex: 1, backgroundColor: c }} />)}
      </View>

      {/* พระอาทิตย์ (แสงฟุ้งเป็นวงซ้อน) และเมฆ */}
      <Animated.View pointerEvents="none"
        style={{ position: 'absolute', top: 36, right: -24, width: 170, height: 170, alignItems: 'center', justifyContent: 'center', transform: [{ scale: sunScale }] }}>
        <View style={{ position: 'absolute', width: 170, height: 170, borderRadius: 85, backgroundColor: 'rgba(255,225,140,0.16)' }} />
        <View style={{ position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255,225,140,0.28)' }} />
        <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: '#fff7da' }} />
      </Animated.View>
      <Cloud width={110} style={{ top: 92, left: '22%', opacity: 0.9, transform: [{ translateX: cloudX }] }} />
      <Cloud width={74} style={{ top: 210, left: '4%', opacity: 0.7, transform: [{ translateX: cloudXSlow }] }} />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
        <View className="flex-1 justify-center px-6">
          <Animated.View
            style={[CARD_SHADOW, {
              opacity: rise,
              transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
            }]}
            className="rounded-[28px] bg-surface p-[18px]"
          >
            {/* หัวการ์ด */}
            <View className="rounded-[20px] px-4 py-[14px] mb-[18px]" style={{ backgroundColor: '#e8f4fb' }}>
              <View className="flex-row items-center gap-[10px]">
                <View className="h-[40px] w-[40px] items-center justify-center rounded-[13px]" style={{ backgroundColor: ACCENT }}>
                  <Ionicons name="bus" size={22} color="#ffffff" />
                </View>
                <Text className="text-[16px] font-bold" style={{ color: '#16324a' }}>Mbus Scan</Text>
              </View>
              <Text className="mt-3 text-[24px] font-bold" style={{ color: '#16324a' }}>ระบบลงทะเบียนรถ</Text>
              <Text className="mt-1 text-[13px] leading-[19px] text-text-muted">เข้าสู่ระบบด้วยบัญชีของจุดตรวจ</Text>
            </View>

            <Text className="text-[13px] font-semibold text-text mb-[6px]">ชื่อผู้ใช้</Text>
            <View className={fieldBox('user')}>
              <Ionicons name="person-outline" size={18} color={focused === 'user' ? ACCENT : ICON_MUTED} />
              <TextInput
                className="flex-1 ml-[10px] text-[16px] text-text"
                placeholder="กรอกชื่อผู้ใช้"
                placeholderTextColor="#9aa1aa"
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isLoading}
                onFocus={() => setFocused('user')}
                onBlur={() => setFocused(null)}
                returnKeyType="next"
              />
            </View>

            <Text className="text-[13px] font-semibold text-text mb-[6px] mt-[14px]">รหัสผ่าน</Text>
            <View className={fieldBox('pass')}>
              <Ionicons name="lock-closed-outline" size={18} color={focused === 'pass' ? ACCENT : ICON_MUTED} />
              <TextInput
                className="flex-1 ml-[10px] text-[16px] text-text"
                placeholder="กรอกรหัสผ่าน"
                placeholderTextColor="#9aa1aa"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                editable={!isLoading}
                onFocus={() => setFocused('pass')}
                onBlur={() => setFocused(null)}
                returnKeyType="go"
                onSubmitEditing={handleLogin}
              />
              <TouchableOpacity onPress={() => setShowPassword((v) => !v)} hitSlop={10}
                accessibilityLabel={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={ICON_MUTED} />
              </TouchableOpacity>
            </View>

            {/* สลับสีพื้นด้วย ternary ไม่ใช่ต่อ class — ตัวที่ชนะคือลำดับใน CSS ที่สร้าง ไม่ใช่ลำดับในสตริง */}
            <TouchableOpacity
              className="mt-[20px] h-[54px] flex-row items-center justify-center gap-2 rounded-[14px]"
              style={[{ backgroundColor: isLoading ? '#687a7c' : ACCENT }, !isLoading && BUTTON_SHADOW]}
              onPress={handleLogin}
              disabled={isLoading}
              activeOpacity={0.85}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="log-in-outline" size={20} color="#ffffff" />
                  <Text className="text-white text-[16px] font-semibold">เข้าสู่ระบบ</Text>
                </>
              )}
            </TouchableOpacity>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>

      {/* ฉากเมือง: รถเข้าจอดรับคนที่ป้ายทุก 14 วินาที — ซ่อนตอนคีย์บอร์ดเปิด */}
      {!keyboardOpen && (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
          <LoginScene />
        </View>
      )}
    </View>
  );
}
