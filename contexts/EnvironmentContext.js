import React, { createContext, useContext, useState, useEffect } from 'react';
import { getSetting, saveSetting } from '../constants/Database'; // <-- ปรับ path ให้ถูก
import { ActivityIndicator, View, StyleSheet } from 'react-native';

// 1. สร้าง Context
const EnvironmentContext = createContext(null);

// 2. สร้าง Provider (ตัวหุ้มแอป)
export const EnvironmentProvider = ({ children }) => {
  const [environment, setEnvironment] = useState(null); // 'test', 'prod', or null
  const [isLoading, setIsLoading] = useState(true);

  // 3. โหลดค่าจาก DB ตอนเปิดแอปครั้งเดียว
  useEffect(() => {
    const loadEnvironment = async () => {
      try {
        const storedEnv = await getSetting('environment');
        console.log('storedEnv :>> ', storedEnv);
        setEnvironment(storedEnv || 'prod'); // ถ้าไม่มี ให้ใช้ 'prod' เป็นค่าเริ่มต้น
      } catch (e) {
        console.error('Failed to load environment', e);
        setEnvironment('test'); // ถ้าพัง ก็ให้ใช้ 'test' ไปก่อน
      } finally {
        setIsLoading(false);
      }
    };

    loadEnvironment();
  }, []);

  // 4. สร้างฟังก์ชันสำหรับอัปเดตค่า (จะถูกเรียกจาก SettingsScreen)
  const updateEnvironment = async (newEnv) => {
    if (newEnv !== 'prod' && newEnv !== 'test') return;
    try {
      await saveSetting('environment', newEnv); // บันทึกลง DB
      setEnvironment(newEnv); // อัปเดต State ใน Context
    } catch (e) {
      console.error('Failed to save environment', e);
      // อาจจะโยน Error ให้หน้า Settings ไป Alert
      throw e;
    }
  };

  // 5. ถ้ายังโหลดค่าไม่เสร็จ ให้แสดงหน้า Loading
  // if (isLoading) {
  //   return (
  //     <View style={styles.loadingContainer}>
  //       <ActivityIndicator size="large" />
  //     </View>
  //   );
  // }

  // 6. ส่งค่าและฟังก์ชันไปให้ Child Components
  return (
    <EnvironmentContext.Provider value={{ environment, updateEnvironment, isLoading }}>
      {children}
    </EnvironmentContext.Provider>
  );
};

// 7. สร้าง Hook สำหรับเรียกใช้ง่ายๆ
export const useEnvironment = () => {
  const context = useContext(EnvironmentContext);
  if (context === null) {
    // ถ้า Error นี้เกิดอีก แสดงว่า _layout.js ผิด
    // แต่ถ้าไม่เกิด แสดงว่าเรามาถูกทางแล้ว
    throw new Error('useEnvironment must be used within an EnvironmentProvider');
  }
  return context;
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});