import { EnvironmentProvider } from "@/contexts/EnvironmentContext";
import { SyncProvider } from "@/contexts/SyncContext";
import { DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { warmUpOnDeviceOcr } from "../utils/lprOcr";
import { setupDatabase } from "../constants/Database";
import { AuthProvider } from "../contexts/AuthContext";
import { ModeProvider } from "../contexts/ModeContext";
import { ProjectProvider } from "../contexts/ProjectContext";

import CheckInSyncManager from "../components/CheckInSyncManager";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
    "Sarabun-Regular": require("../assets/fonts/Sarabun-Regular.ttf"),
  });

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  // 2. เพิ่ม useEffect สำหรับการตั้งค่าฐานข้อมูล
  useEffect(() => {
    // โค้ดส่วนนี้จะทำงานแค่ครั้งเดียวตอนแอปเริ่ม
    console.log("Initializing database...");
    setupDatabase();
    // โหลดโมเดล OCR บนเครื่องล่วงหน้า (~0.4 วิ) เพื่อไม่ให้สแกนครั้งแรกต้องรอ
    // ไม่ throw — ถ้าโหลดไม่สำเร็จจะไป fallback ที่ Cloud Run เอง
    warmUpOnDeviceOcr();
  }, []);

  if (!loaded) {
    return null;
  }

  return (
    <EnvironmentProvider>
      <AuthProvider>
        <SyncProvider>
          <ProjectProvider>
            <ModeProvider>
              <ThemeProvider value={DefaultTheme}>
                <CheckInSyncManager />
                <Stack screenOptions={{ headerShown: false }}>
                  <Stack.Screen name="login" />
                  <Stack.Screen name="bluetooth-setup" />
                  <Stack.Screen name="(tabs)" />
                </Stack>
              </ThemeProvider>
            </ModeProvider>
          </ProjectProvider>
        </SyncProvider>
      </AuthProvider>
    </EnvironmentProvider>
  );
}
