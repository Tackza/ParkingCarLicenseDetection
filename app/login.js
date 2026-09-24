import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
// import AsyncStorage from '@react-native-async-storage/async-storage';
import { getActiveSession, saveSession } from "../constants/Database";
import { useProject } from '../contexts/ProjectContext';

// เงาของกล่องฟอร์ม — ค่าเดียวกับที่เคยอยู่ใน StyleSheet.create เดิมทุกตัว
//
// ไม่แปลงเป็น utility class เพราะ RN ใช้ shadowColor/Offset/Opacity/Radius คู่กับ
// elevation ของ Android ซึ่ง shadow-* ของ Tailwind ให้ค่าคนละชุด และไม่มีตัวไหน
// ครอบคลุม elevation เลย — scope งานนี้คือหน้าตาต้องไม่เปลี่ยน จึงคงค่าเดิมไว้ตรงๆ
// ประกาศนอก component เพื่อไม่ให้สร้าง object ใหม่ทุกรอบ render
const CARD_SHADOW = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.1,
  shadowRadius: 8,
  elevation: 5,
};

export default function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // เพิ่ม state เพื่อตรวจสอบสถานะการโหลดข้อมูลจาก AsyncStorage
  const [isCheckingStorage, setIsCheckingStorage] = useState(true);
  const { login, isLoading } = useAuth();
  const router = useRouter();
  const { syncProjectsWithApi } = useProject();

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
      <View className="flex-1 justify-center items-center bg-background">
        <ActivityIndicator size="large" color="#3498db" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-background"
    >
      <View className="flex-1 justify-center px-[30px]">
        <View className="items-center mb-5">
          <Text className="text-[26px] font-bold text-text mb-px">🚗 </Text>
          <Text className="text-[26px] font-bold text-text mb-px">ระบบลงทะเบียนรถ</Text>
        </View>

        {/* เงายังต้องเขียนเป็น style object — RN ใช้ shadow* + elevation ซึ่งไม่มี
            utility ของ Tailwind ตัวไหน map ค่าได้ตรง ถ้าใช้ shadow-md แทนจะได้เงาคนละแบบ
            และ elevation เป็นของ Android โดยเฉพาะที่ NativeWind ไม่ครอบคลุม */}
        <View className="bg-surface rounded-[20px] p-[25px]" style={CARD_SHADOW}>
          <View className="mb-5">
            <Text className="text-[14px] font-semibold text-text mb-2">ชื่อผู้ใช้</Text>
            <TextInput
              className="bg-input rounded-xl p-[15px] text-[16px] border border-border"
              placeholder="กรอกชื่อผู้ใช้"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              editable={!isLoading}
            />
          </View>

          <View className="mb-5">
            <Text className="text-[14px] font-semibold text-text mb-2">รหัสผ่าน</Text>
            <TextInput
              className="bg-input rounded-xl p-[15px] text-[16px] border border-border"
              placeholder="กรอกรหัสผ่าน"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              editable={!isLoading}
            />
          </View>

          {/* สลับสีพื้นด้วย ternary ไม่ใช่ต่อ class เพิ่มท้าย — ถ้าเขียน
              "bg-primary ... bg-primary-muted" ตัวที่ชนะคือตัวที่มาทีหลังใน CSS
              ที่ถูกสร้าง ไม่ใช่ตัวที่มาทีหลังในสตริง ผลลัพธ์จึงคาดเดาไม่ได้ */}
          <TouchableOpacity
            className={`${isLoading ? 'bg-primary-muted' : 'bg-primary'} rounded-xl p-4 items-center mt-2.5`}
            onPress={handleLogin}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-surface text-[16px] font-semibold">เข้าสู่ระบบ</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
