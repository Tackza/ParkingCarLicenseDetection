import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';

export default function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { login, isLoading } = useAuth();
  const router = useRouter();

  const handleLogin = async () => {
    if (!username || !password) {
      Alert.alert('ข้อผิดพลาด', 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
      return;
    }

    const result = await login(username, password);

    if (result.success) {
      router.replace('/bluetooth-setup');
    } else {
      Alert.alert('เข้าสู่ระบบไม่สำเร็จ', result.message);
    }
  };

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