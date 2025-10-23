import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { AuthProvider } from "../contexts/AuthContext";
import { ModeProvider } from "../contexts/ModeContext";
import { setupDatabase } from "../constants/Database";
import { ProjectProvider } from "../contexts/ProjectContext";
import { SyncProvider } from "@/contexts/SyncContext";

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
  }, []);

  if (!loaded) {
    return null;
  }

  return (
    <AuthProvider>
      <ThemeProvider value={DefaultTheme}>
        <SyncProvider>
          <ProjectProvider>
            <ModeProvider>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="login" />
                <Stack.Screen name="bluetooth-setup" />
                <Stack.Screen name="(tabs)" />
              </Stack>
            </ModeProvider>
          </ProjectProvider>
        </SyncProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}
