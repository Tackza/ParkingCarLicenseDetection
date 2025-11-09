import React, { useCallback, useEffect, useRef, useState } from "react";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons"; // หรือ Icon library อื่นๆ ที่คุณใช้
import { Alert, ActivityIndicator } from "react-native";
import SyncStatus from "../../components/SyncStatus";
import * as ImagePicker from "expo-image-picker"; // เพิ่มการนำเข้า ImagePicker
import { useMode } from "@/contexts/ModeContext";
import { useProject } from "@/contexts/ProjectContext";
import { SyncProvider, useSync } from "@/contexts/SyncContext";
import {
  getLastRegisterSyncState,
  saveRegisters,
  getActiveSession,
} from "@/constants/Database";
import { useEnvironment } from "@/contexts/EnvironmentContext";

// ✅ กำหนดเวลา Sync (30 วินาที = 30,000 มิลลิวินาที)
const SYNC_INTERVAL = 30000;


function TabLogic() {
  const router = useRouter();
  const { isModeOne } = useMode();
  const { activeProject, isLoading: isProjectLoading } = useProject();
  const { isSyncing, setIsSyncing, setIsOnline, lastSyncTime, setLastSyncTime } = useSync();
  const syncTimeoutIdRef = useRef(null);
  const isSyncInProgress = useRef(false);
  const [isOpeningCamera, setIsOpeningCamera] = useState(false);

  // ✅ ใช้ useRef เก็บ ID ของ interval
  const intervalIdRef = useRef(null);
  const initialSyncTimeoutRef = useRef(null); // สำหรับ initial timeout

  const { environment } = useEnvironment();

  const API_URL = environment === 'prod' ?
    "https://mbus.dhammakaya.network/api" :
    "https://mbus-test.dhammakaya.network/api";

  // ✅ 1. แก้ไข useCallback โดยเอา isSyncing ออกจาก dependency array
  const syncRegistersData = useCallback(async () => {
    // หาก isSyncing เป็น true แสดงว่ากำลัง sync อยู่ ไม่ต้องเรียกซ้ำ

    if (isSyncInProgress.current) {
      console.log("Sync skipped: Ref lock is active.");
      return false; // ข้ามไปเลย
    }
    if (!activeProject) {
      console.log("Sync skipped: No active project.");
      return;
    }

    isSyncInProgress.current = true;
    setIsSyncing(true);

    console.log("Starting sync for project:", activeProject?.project_id); // เพิ่ม log
    try {
      const session = await getActiveSession();
      if (!session?.lpr_token) throw new Error("No LprToken found.");

      const syncState = await getLastRegisterSyncState();
      const last_update = syncState?.last_update || "";
      const last_id = syncState?.last_id || 0;
      const apiUrl = `${API_URL}/lpr/registers?last_update=${last_update}&last_id=${last_id}&project_id=${activeProject.project_id}`;

      const response = await fetch(apiUrl, {
        headers: { Authorization: `Bearer ${session.lpr_token}` },
      });
      // console.log('apiUrl :>> ', apiUrl);

      if (!response.ok) {
        throw new Error(`Network response was not ok, status: ${response.status}`);
      }
      setIsOnline(true);

      const data = await response.json();
      if (data.status === "success" && data.result?.length > 0) {
        console.log('data C7 :>> ', data);
        await saveRegisters(data.result);
        setLastSyncTime(new Date());
        console.log("Sync successful. New records:", data.result.length); // เพิ่ม log
        return true;
      } else {
        return false;
      }
    } catch (error) {
      console.log('Data sync failed :>> ', error);
      // console.error("Data sync failed:", error);
      setIsOnline(false);
      return false;
    } finally {
      isSyncInProgress.current = false;
      setIsSyncing(false);
    }
  }, [activeProject, setIsOnline, setLastSyncTime, setIsSyncing, API_URL]); // <-- isSyncing ถูกเอาออกไปแล้ว





  useEffect(() => {
    // ฟังก์ชันสำหรับตั้งค่า interval
    const setupInterval = () => {
      // ล้าง interval เก่าก่อนเสมอ ถ้ามี
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
      }
      if (initialSyncTimeoutRef.current) {
        clearTimeout(initialSyncTimeoutRef.current);
      }

      // ตั้งค่า initial sync และ interval ใหม่
      initialSyncTimeoutRef.current = setTimeout(() => {
        syncRegistersData(); // เรียก sync ทันทีหลังจาก initial delay
        intervalIdRef.current = setInterval(syncRegistersData, SYNC_INTERVAL);
      }, 1000); // หน่วง 1 วินาทีก่อน sync ครั้งแรก
    };

    // เรียก setupInterval เมื่อ activeProject เปลี่ยน
    // หรือเมื่อ Component mount ครั้งแรก
    if (activeProject) { // ✅ เฉพาะเมื่อมี activeProject แล้วเท่านั้น
      setupInterval();
    } else {
      // ถ้าไม่มี activeProject ก็เคลียร์ interval เก่าทิ้ง
      if (intervalIdRef.current) clearInterval(intervalIdRef.current);
      if (initialSyncTimeoutRef.current) clearTimeout(initialSyncTimeoutRef.current);
    }

    // Cleanup function: จะถูกเรียกเมื่อ Component unmount หรือ dependency เปลี่ยน (ก่อนเรียก setupInterval ใหม่)
    return () => {
      if (initialSyncTimeoutRef.current) {
        clearTimeout(initialSyncTimeoutRef.current);
      }
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
      }
    };
  }, [activeProject, syncRegistersData]);


  const handleScanTabPress = async (e) => {
    // 1. ป้องกันไม่ให้แอปเปลี่ยนไปหน้า scan ตามปกติ
    e.preventDefault();

    // ✅ ป้องกันการกดซ้ำ: ถ้ากำลังเปิดกล้องอยู่ ให้ return ทันที
    if (isOpeningCamera) {
      return;
    }



    try {
      // ✅ ตั้งสถานะเป็น "กำลังเปิด" เพื่อแสดง loading
      setIsOpeningCamera(true);
      // 2. ขออนุญาตใช้กล้อง
      const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
      if (cameraPermission.status !== "granted") {
        Alert.alert("ขออนุญาต", "กรุณาอนุญาตให้เข้าถึงกล้อง");
        return;
      }

      // 3. เปิดกล้อง
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
      });

      // 4. ถ้าถ่ายรูปสำเร็จ ให้ส่ง URI ไปที่หน้า scan
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const imageUri = result.assets[0].uri;
        // ส่งพารามิเตอร์ไปพร้อมกับการนำทาง
        router.push({
          pathname: "/scan",
          params: { imageUri: imageUri },
        });
      }
      // ถ้าผู้ใช้ยกเลิก ก็ไม่ต้องทำอะไร ผู้ใช้จะยังอยู่ที่หน้าเดิม
    } catch (error) {
      Alert.alert("ข้อผิดพลาด", "ไม่สามารถเปิดกล้องได้");
    } finally {
      // ✅ คืนสถานะเป็น "ว่าง" เสมอ ไม่ว่าจะสำเร็จ, ล้มเหลว, หรือยกเลิก
      // เพื่อให้ผู้ใช้สามารถกดได้อีกครั้ง
      setTimeout(() => {
        setIsOpeningCamera(false);
      }, 1000);
    }
  };

  return (
    <Tabs
      key={isModeOne ? "modeOne" : "modeTwo"}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#3498db",
        tabBarInactiveTintColor: "gray",
        tabBarStyle: {
          backgroundColor: "#f8f9fa",
          borderTopWidth: 1,
          borderTopColor: "#f8f9fa",
          height: 40,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: "200",
        },
      }}
    >
      {/* ... Screen ทั้งหมดเหมือนเดิม แต่ตอนนี้ headerRight จะแสดงสถานะ Sync ได้แล้ว ... */}
      <Tabs.Screen
        name="main"
        options={{
          title: "หน้าหลัก",
          tabBarShowLabel: false,
          headerShown: false, // <-- เปิด Header เพื่อใส่ Status
          // headerRight: () => (
          //   <SyncStatus
          //     isSyncing={isSyncing}
          //     lastSyncTime={lastSyncTime}
          //     // onPressSync={syncMasterData}
          //   />
          // ),
          tabBarIcon: ({ focused, color, size }) => {
            const iconColor = focused
              ? isModeOne
                ? "#3498db"
                : "#f39c12"
              : color;
            return <Ionicons name="home" size={22} color={iconColor} />;
          },
        }}
      />
      <Tabs.Screen
        name="scan"
        listeners={{
          tabPress: handleScanTabPress, // เมื่อกดแท็บ ให้เรียกใช้ฟังก์ชันของเรา
        }}
        options={{
          title: "สแกน",
          tabBarShowLabel: false,
          headerShown: false, // <-- เปิด Header เพื่อใส่ Status
          headerTitle: "สแกนทะเบียนรถ",
          // headerRight: () => (
          //   <SyncStatus
          //     isSyncing={isSyncing}
          //     lastSyncTime={lastSyncTime}
          //   // onPressSync={syncMasterData}
          //   />
          // ),
          tabBarIcon: ({ focused, color, size }) => {
            // ✅ ตรวจสอบสถานะ isOpeningCamera
            if (isOpeningCamera) {
              // ถ้ากำลังเปิดกล้อง ให้แสดง ActivityIndicator
              return <ActivityIndicator size="small" color={isModeOne ? "#3498db" : "#f39c12"} />;
            }

            // ถ้าไม่ได้เปิดกล้อง ให้แสดงไอคอนตามปกติ
            const iconColor = focused
              ? isModeOne
                ? "#3498db"
                : "#f39c12"
              : color;
            return <Ionicons name="camera" size={22} color={iconColor} />;
          },
          tabBarStyle: { display: "none" },
        }}
      />

      {/* <Tabs.Screen
        name="main_normal"
        options={{
          title: "หน้าหลัก",
          tabBarShowLabel: false,
          headerShown: false, // <-- เปิด Header เพื่อใส่ Status
          headerRight: () => (
            <SyncStatus
              isSyncing={isSyncing}
              lastSyncTime={lastSyncTime}
            // onPressSync={syncMasterData}
            />
          ),
          tabBarIcon: ({ focused, color, size }) => {
            const iconColor = focused
              ? isModeOne
                ? "#3498db"
                : "#f39c12"
              : color;
            return <Ionicons name="home-sharp" size={22} color={iconColor} />;
          },
          href: !isModeOne ? undefined : null,
        }}
      /> */}
      {/* <Tabs.Screen
        name="scan_normal"
        listeners={{
          tabPress: handleScanTabPress, // เมื่อกดแท็บ ให้เรียกใช้ฟังก์ชันของเรา
        }}
        options={{
          title: "สแกน",
          tabBarShowLabel: false,
          headerShown: false, // <-- เปิด Header เพื่อใส่ Status
          headerTitle: "สแกนทะเบียนรถ",
          headerRight: () => (
            <SyncStatus
              isSyncing={isSyncing}
              lastSyncTime={lastSyncTime}
            // onPressSync={syncMasterData}
            />
          ),
          tabBarIcon: ({ focused, color, size }) => {
            const iconColor = focused
              ? isModeOne
                ? "#3498db"
                : "#f39c12"
              : color;
            return (
              <Ionicons
                name="camera-sharp"
                size={22}
                color={iconColor}
              />
            );
          },
          tabBarStyle: { display: "none" }, // ซ่อน Tab bar เมื่ออยู่ในหน้า Scan
          href: !isModeOne ? undefined : null,
        }}
      /> */}

      <Tabs.Screen
        name="settings"
        options={{
          title: "ตั้งค่า",
          tabBarShowLabel: false,
          headerShown: false, // <-- เปิด Header เพื่อใส่ Status
          headerTitle: "สแกนทะเบียนรถ",
          headerRight: () => (
            <SyncStatus
              isSyncing={isSyncing}
              lastSyncTime={lastSyncTime}
            // onPressSync={syncMasterData}
            />
          ),
          tabBarIcon: ({ focused, color, size }) => {
            const iconColor = focused
              ? isModeOne
                ? "#3498db"
                : "#f39c12"
              : color;
            return <Ionicons name="person" size={22} color={iconColor} />;
          },
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  return (
    <SyncProvider>
      <TabLogic />
    </SyncProvider>
  );
}
