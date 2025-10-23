import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { ActivityIndicator, Alert } from 'react-native'; // อย่าลืม import Alert

// ✅ 1. นำเข้าฟังก์ชันจาก Database.js
import { getSetting, saveSetting } from '../constants/Database';

// 1. สร้าง Context
const ModeContext = createContext({
  isModeOne: true,
  toggleMode: async () => { }, // ทำให้เป็น async
  isLoading: true,
});

// 2. สร้าง Provider Component
export const ModeProvider = ({ children }) => {
  // State ที่จะเก็บค่าโหมดปัจจุบัน
  const [isModeOne, setIsModeOne] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadMode = async () => {
      try {
        const savedModeString = await getSetting('appMode');

        // แปลงค่า string "true"/"false" กลับเป็น boolean
        // ถ้า getSetting คืนค่า null (ยังไม่มีค่า) ให้ใช้ true เป็นค่าเริ่มต้น
        if (savedModeString !== null) {
          setIsModeOne(savedModeString === 'true');
        } else {
          setIsModeOne(true); // ค่าเริ่มต้นถ้ายังไม่เคยบันทึก
        }
      } catch (e) {
        console.error('Failed to load mode from SQLite', e);
      } finally {
        setIsLoading(false);
      }
    };

    loadMode();
  }, []);

  const toggleMode = useCallback(async () => {
    try {
      const newMode = !isModeOne;
      setIsModeOne(newMode);
      // ใช้ saveSetting แทน AsyncStorage.setItem
      // แปลง boolean เป็น string ก่อนบันทึก
      await saveSetting('appMode', newMode.toString());
    } catch (e) {
      console.error('Failed to save mode to SQLite', e);
      Alert.alert("เกิดข้อผิดพลาด", "ไม่สามารถบันทึกการตั้งค่าโหมดได้");
    }
  }, [isModeOne]);

  // ถ้ายังโหลดค่าไม่เสร็จ อาจจะแสดงหน้า Loading
  if (isLoading) {
    return <ActivityIndicator />
  }

  return (
    <ModeContext.Provider value={{ isModeOne, toggleMode, isLoading }}>
      {children}
    </ModeContext.Provider>
  );
};

// 4. สร้าง Custom Hook เพื่อให้เรียกใช้ง่ายๆ
export const useMode = () => useContext(ModeContext);