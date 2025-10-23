import React, { createContext, useState, useContext } from 'react';

// 1. สร้าง Context object
const SyncContext = createContext({
  isOnline: true, // สถานะการเชื่อมต่อ (เริ่มต้นเป็น true)
  isSyncing: false,
  lastSyncTime: null,
  setIsOnline: () => { }, // ฟังก์ชันสำหรับอัปเดตสถานะ
  // เพิ่ม state อื่นๆ ที่ต้องการแชร์ได้
});

// 2. สร้าง Provider Component (ตัวจัดการและกระจายข้อมูล)
export const SyncProvider = ({ children }) => {
  const [isOnline, setIsOnline] = useState(true); // สถานะ network
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(null);

  const value = {
    isOnline,
    setIsOnline,
    isSyncing,
    setIsSyncing,
    lastSyncTime,
    setLastSyncTime,
  };

  return (
    <SyncContext.Provider value={value}>
      {children}
    </SyncContext.Provider>
  );
};

// 3. สร้าง Custom Hook เพื่อให้เรียกใช้ง่ายๆ
export const useSync = () => {
  return useContext(SyncContext);
};