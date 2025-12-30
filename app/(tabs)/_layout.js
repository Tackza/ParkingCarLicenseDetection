import {
  getActiveSession,
  getLastRegisterSyncState,
  saveRegisters,
} from "@/constants/Database";
import { useEnvironment } from "@/contexts/EnvironmentContext";
import { useMode } from "@/contexts/ModeContext";
import { useProject } from "@/contexts/ProjectContext";
import { SyncProvider, useSync } from "@/contexts/SyncContext";
import { Ionicons } from "@expo/vector-icons"; // หรือ Icon library อื่นๆ ที่คุณใช้
import * as ImagePicker from "expo-image-picker"; // เพิ่มการนำเข้า ImagePicker
import { Tabs, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, LogBox } from "react-native";
import BackgroundTimer from 'react-native-background-timer';
import SyncStatus from "../../components/SyncStatus";


LogBox.ignoreLogs([
  "`new NativeEventEmitter()` was called with a non-null argument"
]);

// ✅ กำหนดเวลา Sync (30 วินาที = 30,000 มิลลิวินาที)
const SYNC_INTERVAL = 30000;

// ✅ Module-level lock เพื่อป้องกัน sync ซ้ำซ้อนข้าม component re-renders
let globalSyncLock = false;


function TabLogic() {
  const router = useRouter();
  const { isModeOne } = useMode();
  const { activeProject, isLoading: isProjectLoading } = useProject();
  const { isSyncing, setIsSyncing, setIsOnline, lastSyncTime, setLastSyncTime } = useSync();
  const syncTimeoutIdRef = useRef(null);
  const isSyncInProgress = useRef(false);
  const [isOpeningCamera, setIsOpeningCamera] = useState(false);
  const { environment } = useEnvironment();


  // ✅ Ref for tracking the current unique session of the effect/timer
  const currentSyncSessionId = useRef(0);
  const timeoutIdRef = useRef(null);

  const API_URL = environment === 'prod' ?
    "https://mbus.dhammakaya.network/api" :
    "https://mbus-test.dhammakaya.network/api";

  // ✅ 1. แก้ไข useCallback โดยเอา isSyncing ออกจาก dependency array
  const syncRegistersData = useCallback(async (sessionId) => {
    // ✅ Verify Session
    if (sessionId && sessionId !== currentSyncSessionId.current) {
      console.log(`Sync aborted: Stale session (Current: ${currentSyncSessionId.current}, This: ${sessionId})`);
      return;
    }

    // ✅ ใช้ global lock แทน ref เพื่อป้องกัน sync ซ้ำข้าม re-renders
    if (globalSyncLock) {
      console.log("Sync skipped: Global lock is active.");
      return; // ไม่ schedule ใหม่ตรงนี้ ให้ sync ที่กำลังทำงานอยู่ schedule เอง
    }

    if (!activeProject) {
      console.log("Sync skipped: No active project.");
      scheduleNextSync(sessionId);
      return;
    }

    globalSyncLock = true;
    setIsSyncing(true);

    console.log("Starting sync for project:", activeProject?.project_id);
    try {
      const session = await getActiveSession();
      // ✅ ถ้าไม่มี token (เช่นตอน logout) ให้หยุดอย่างสงบ ไม่ throw error
      if (!session?.lpr_token) {
        console.log("Register Sync skipped: No LprToken (user logged out).");
        globalSyncLock = false;
        setIsSyncing(false);
        return;
      }

      const syncState = await getLastRegisterSyncState();
      const last_update = syncState?.last_update || "";
      const last_id = syncState?.last_id || 0;

      const apiUrl = `${API_URL}/lpr/registers?last_update=${last_update}&last_id=${last_id}&project_id=${activeProject.project_id}`;

      const response = await fetch(apiUrl, {
        headers: { Authorization: `Bearer ${session.lpr_token}` },
      });

      if (!response.ok) {
        throw new Error(`Network response was not ok, status: ${response.status}`);
      }
      setIsOnline(true);

      const data = await response.json();
      if (data.status === "success" && data.result?.length > 0) {
        console.log('data C7 :>> ', data);
        await saveRegisters(data.result);
        setLastSyncTime(new Date());
        console.log("Sync successful. New records:", data.result.length);
        return true;
      } else {
        return false;
      }
    } catch (error) {
      console.log('Data sync failed :>> ', error);
      setIsOnline(false);
      return false;
    } finally {
      globalSyncLock = false;
      setIsSyncing(false);
      scheduleNextSync(sessionId);
    }
  }, [activeProject, setIsOnline, setLastSyncTime, setIsSyncing, API_URL]);

  const scheduleNextSync = useCallback((sessionId) => {
    if (sessionId !== currentSyncSessionId.current) return;

    // ✅ Clear pending timer ก่อน schedule ใหม่
    if (timeoutIdRef.current) {
      BackgroundTimer.clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }

    console.log(`Scheduling next register sync in ${SYNC_INTERVAL}ms`);
    timeoutIdRef.current = BackgroundTimer.setTimeout(() => {
      syncRegistersData(sessionId);
    }, SYNC_INTERVAL);
  }, [syncRegistersData]);

  useEffect(() => {
    // 1. Generate New Session ID
    const newSessionId = Date.now();
    currentSyncSessionId.current = newSessionId;
    console.log(`Register Sync Session Started: ${newSessionId}`);

    // ✅ Clear existing timer ก่อนเสมอ
    if (timeoutIdRef.current) {
      BackgroundTimer.clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }

    if (activeProject) {
      // ✅ Initial delay - ใช้เวลานานขึ้นเพื่อให้แน่ใจว่า component stable แล้ว
      timeoutIdRef.current = BackgroundTimer.setTimeout(() => {
        syncRegistersData(newSessionId);
      }, 3000); // เพิ่มเป็น 3 วินาที
    }

    // Cleanup
    return () => {
      console.log(`Register Sync Session Cleaned: ${newSessionId}`);
      if (timeoutIdRef.current) {
        BackgroundTimer.clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
    };
  }, [activeProject, syncRegistersData]); // ✅ เพิ่ม syncRegistersData


  const handleScanTabPress = async (e) => {
    // 1. ป้องกันไม่ให้แอปเปลี่ยนไปหน้า scan ตามปกติ
    e.preventDefault();

    // ✅ ตรวจสอบว่ามี activeProject หรือไม่
    if (!activeProject) {
      Alert.alert("ไม่พบกิจกรรม", "ไม่สามารถสแกนได้");
      return;
    }

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
          height: 50,
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
            return <Ionicons name="home" size={28} color={iconColor} />;
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
            return <Ionicons name="camera" size={28} color={iconColor} />;
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
            return <Ionicons name="settings" size={28} color={iconColor} />;
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
