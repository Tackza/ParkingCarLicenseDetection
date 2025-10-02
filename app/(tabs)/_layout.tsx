import React, { useEffect, useState } from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons"; // หรือ Icon library อื่นๆ ที่คุณใช้
import AsyncStorage from "@react-native-async-storage/async-storage";
import SyncStatus from "../../components/SyncStatus";

// กำหนดค่าเวลา (5 นาที = 300,000 มิลลิวินาที)
const SYNC_INTERVAL = 300000;

export default function TabLayout() {
  const [isSyncing, setIsSyncing] = useState(false);
 const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  // ฟังก์ชันสำหรับดึงข้อมูลจาก Server
  const syncMasterData = async () => {
    if (isSyncing) return;
    console.log("Starting data sync...");
    setIsSyncing(true);
    try {
      // const response = await fetch("https://your-api.com/master-vehicles");
      // const data = await response.json();
      const data = [
        {
          plate: "6กม3114",
          province: "กรุงเทพมหานคร",
          vehicleType: "รถบัสแอร์ 2 ชั้น",
          driverName: "นายสมชาย ใจดี",
          contact: "081-234-5678",
        },
        {
          plate: "ฮน5678",
          province: "ชลบุรี",
          vehicleType: "รถตู้",
          driverName: "นางสาวสมศรี มีสุข",
          contact: "089-876-5432",
        },
        {
          plate: "409988",
          province: "เชียงใหม่",
          vehicleType: "รถบัสพัดลม",
          driverName: "นายวิชัย ชนะศึก",
          contact: "085-555-1111",
        },
        {
          plate: "บก2567",
          province: "ภูเก็ต",
          vehicleType: "รถมินิบัส VIP",
          driverName: "นายเจริญ รุ่งเรือง",
          contact: "088-777-9999",
        },
        {
          plate: "1ฒณ7890",
          province: "นนทบุรี",
          vehicleType: "รถตู้",
          driverName: "นางสาวมานี รักไทย",
          contact: "087-654-3210",
        },
        {
          plate: "301234",
          province: "กรุงเทพมหานคร",
          vehicleType: "รถบัสแอร์ 2 ชั้น",
          driverName: "นายสมชาย ใจดี",
          contact: "081-234-5678",
        },
        {
          plate: "ฮน5678",
          province: "ชลบุรี",
          vehicleType: "รถตู้",
          driverName: "นางสาวสมศรี มีสุข",
          contact: "089-876-5432",
        },
        {
          plate: "409988",
          province: "เชียงใหม่",
          vehicleType: "รถบัสพัดลม",
          driverName: "นายวิชัย ชนะศึก",
          contact: "085-555-1111",
        },
        {
          plate: "บก2567",
          province: "ภูเก็ต",
          vehicleType: "รถมินิบัส VIP",
          driverName: "นายเจริญ รุ่งเรือง",
          contact: "088-777-9999",
        },
        {
          plate: "1ฒณ7890",
          province: "นนทบุรี",
          vehicleType: "รถตู้",
          driverName: "นางสาวมานี รักไทย",
          contact: "087-654-3210",
        },
      ];

      if (data && Array.isArray(data)) {
        await AsyncStorage.setItem("master_vehicle_list", JSON.stringify(data));

        const now = new Date();
        await AsyncStorage.setItem("last_sync_time", now.toISOString());
        setLastSyncTime(now); // <-- บรรทัดนี้จะทำงานได้ถูกต้องแล้ว
        console.log("Data sync successful!");
      }
    } catch (error) {
      // console.error("Data sync failed:", error);
    } finally {
      setIsSyncing(false);
    }
  };

   useEffect(() => {
     const loadLastSyncTime = async () => {
       const timeString = await AsyncStorage.getItem("last_sync_time");
       if (timeString) {
         setLastSyncTime(new Date(timeString));
       }
     };

     loadLastSyncTime();
     syncMasterData();

     const intervalId = setInterval(syncMasterData, SYNC_INTERVAL);

     return () => clearInterval(intervalId);
   }, []);
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false, // ซ่อน Header ของแต่ละ Tab เพราะเรามีในแต่ละหน้าจออยู่แล้ว
        tabBarActiveTintColor: "#3498db", // สีไอคอนเมื่อถูกเลือก
        tabBarInactiveTintColor: "gray", // สีไอคอนเมื่อไม่ได้ถูกเลือก
        tabBarStyle: {
          backgroundColor: "#ffffff",
          borderTopWidth: 1,
          borderTopColor: "#f0f0f0",
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "600",
        },
      })}
    >
      <Tabs.Screen
        name="scan"
        options={{
          title: "สแกน",
          headerShown: true, // <-- เปิด Header เพื่อใส่ Status
          headerTitle: "สแกนทะเบียนรถ",
          headerRight: () => (
            <SyncStatus
              isSyncing={isSyncing}
              lastSyncTime={lastSyncTime}
              onPressSync={syncMasterData}
            />
          ),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="camera-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "ประวัติ",
          headerShown: true, // <-- เปิด Header เพื่อใส่ Status
          headerTitle: "ประวัติการสแกน",
          headerRight: () => (
            <SyncStatus
              isSyncing={isSyncing}
              lastSyncTime={lastSyncTime}
              onPressSync={syncMasterData}
            />
          ),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="time-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
