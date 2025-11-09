// file: contexts/ProjectContext.js

import React, { createContext, useState, useEffect, useContext, useCallback } from 'react';
import {
  saveProjects,
  getCurrentProject,
  getActiveSession,
} from '../constants/Database'; // <-- ปรับ path ให้ถูกต้อง
import { useEnvironment } from './EnvironmentContext';
import { ActivityIndicator, View, StyleSheet } from 'react-native';



// 1. สร้าง Context object
const ProjectContext = createContext({
  activeProject: null,
  isLoading: true,
  syncProjectsWithApi: async () => { },    // ฟังก์ชันสำหรับเรียกหลัง Login
  refreshCurrentProject: async () => { }, // ฟังก์ชันสำหรับเรียกเมื่อเข้าหน้าต่างๆ
});



// 2. สร้าง Provider Component (ตัวจัดการและกระจายข้อมูล)
export const ProjectProvider = ({ children }) => {
  const [activeProject, setActiveProject] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const { environment, isLoading: isEnvLoading } = useEnvironment();


  if (isEnvLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const API_URL = environment === 'prod' ?
    "https://mbus.dhammakaya.network/api" :
    "https://mbus-test.dhammakaya.network/api";



  const refreshCurrentProject = useCallback(async () => {
    setIsLoading(true);
    try {
      const currentProject = await getCurrentProject();
      console.log('currentProject :>> ', currentProject);
      setActiveProject(currentProject);
      console.log("✅ [CONTEXT] Refreshed current project from local DB.");
    } catch (error) {
      console.error("❌ Error refreshing current project:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const syncProjectsWithApi = useCallback(async () => {
    console.log("🚀 Attempting to sync projects with API...");
    setIsLoading(true);
    try {
      const session = await getActiveSession();
      if (!session || !session.lpr_token) {
        throw new Error("No active session found. Cannot sync projects.");
      }

      const response = await fetch(`${API_URL}/lpr/projects`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.lpr_token}`,
        },
      });
      if (!response.ok) throw new Error("Failed to fetch projects from API.");

      const data = await response.json();
      console.log('data syncProjectsWithApi :>> ', data);

      if (data.status === 'success' && data.result) {
        await saveProjects(data.result);
        console.log("✅ [CONTEXT] API Sync successful, projects saved.");
      }

      // หลังจาก Sync เสร็จ, ให้อัปเดตโปรเจกต์ปัจจุบันทันที
      await refreshCurrentProject();

    } catch (error) {
      console.error("❌ Error syncing projects with API:", error);
    } finally {
      setIsLoading(false);
    }
  }, [refreshCurrentProject, API_URL]);



  useEffect(() => {
    refreshCurrentProject();
  }, [refreshCurrentProject]);

  // 4. กำหนดค่าที่จะส่งลงไปให้ Component ลูก
  const value = {
    activeProject,
    isLoading,
    syncProjectsWithApi,
    refreshCurrentProject,
  };

  return (
    <ProjectContext.Provider value={value}>
      {children}
    </ProjectContext.Provider>
  );
};

// 5. สร้าง Custom Hook เพื่อให้เรียกใช้ง่ายๆ
export const useProject = () => {
  return useContext(ProjectContext);
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  }
});

