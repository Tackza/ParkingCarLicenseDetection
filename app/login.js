import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
// import AsyncStorage from '@react-native-async-storage/async-storage';
import { getActiveSession, saveSession } from "../constants/Database";
import { useProject } from '../contexts/ProjectContext';

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
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#3498db" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.content}>
        <View style={styles.logoContainer}>
          <Text style={styles.title}>🚗 </Text>
          <Text style={styles.title}>ระบบลงทะเบียนรถ</Text>
        </View>

        <View style={styles.formContainer}>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>ชื่อผู้ใช้</Text>
            <TextInput
              style={styles.input}
              placeholder="กรอกชื่อผู้ใช้"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              editable={!isLoading}
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>รหัสผ่าน</Text>
            <TextInput
              style={styles.input}
              placeholder="กรอกรหัสผ่าน"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              editable={!isLoading}
            />
          </View>

          <TouchableOpacity
            style={[styles.loginButton, isLoading && styles.loginButtonDisabled]}
            onPress={handleLogin}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.loginButtonText}>เข้าสู่ระบบ</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  // ✨ (เพิ่มส่วนนี้) - สไตล์สำหรับหน้าจอ Loading
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 1,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#7f8c8d',
  },
  formContainer: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 15,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  loginButton: {
    backgroundColor: '#3498db',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 10,
  },
  loginButtonDisabled: {
    backgroundColor: '#95a5a6',
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});