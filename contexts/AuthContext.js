import axios from 'axios';
import React, { createContext, useContext, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { getActiveSession, insertErrorLog } from '../constants/Database';
import { useEnvironment } from './EnvironmentContext';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const { environment, isLoading: isEnvLoading } = useEnvironment();


  if (isEnvLoading) {
    // ถ้ารอ Env อยู่ ให้ AuthProvider แสดงหน้า Loading ของตัวเอง
    // และ "ห้าม" ทำงานต่อ
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const API_URL = environment === 'prod' ?
    "https://mbus.dhammakaya.network/api" :
    "https://mbus-test.dhammakaya.network/api";


  const login = async (username, password) => {
    setIsLoading(true);
    console.log('username, password :>> ', JSON.stringify({ username, password }));

    try {
      const response = await axios.post(`${API_URL}/lpr/login`, {
        username,
        password,
      });

      // เช็คว่า response สำเร็จหรือไม่ (status code 200-299)
      if (response.status !== 200) {
        // ถ้า server ตอบกลับมาด้วย status error เช่น 404, 500
        // console.error('Server responded with an error:', response.status);
        const errorData = response.data; // ลองดูว่ามีข้อมูล error อะไรส่งมาไหม
        // console.error('Error details:', errorData);
        return { status: 'error', message: errorData.message || 'Server Error' };
      }

      const { result, status } = response.data;
      console.log('result , status :>> ', result, status);

      if (status === 'success') {
        const userData = {
          id: result.user.id,
          username: result.user.username,
          first_name: result.user.first_name,
          last_name: result.user.last_name,
          note: result.user.note,
          lpr_token: result.lpr_token,
        };
        console.log('userData :>> ', userData);
        setUser(userData);
        return { status, data: userData };
      }


    } catch (error) {
      // นี่คือส่วนที่จะทำงานเมื่อเกิด Network Error!
      console.error('Fetch failed with a Network Error:', error);

      // ✅ Log error to database
      try {
        const session = await getActiveSession();
        await insertErrorLog({
          comp_id: null,
          error_type: 'API_ERROR',
          error_message: error.message || 'Login failed with Network Error',
          error_code: error.response?.status || error.code || 'LOGIN_ERROR',
          page_name: 'AuthContext.js',
          action_name: 'login',
          user_id: session?.user_id || null
        });
      } catch (logError) {
        console.error('Failed to log error:', logError);
      }

      return { success: false, message: error.message };
      // ให้ดูข้อมูลใน console ว่า error บอกอะไรเพิ่มเติมบ้าง
    }

    finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff' // หรือสีพื้นหลังของแอปคุณ
  }
});