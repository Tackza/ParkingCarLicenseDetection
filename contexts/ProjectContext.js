// file: contexts/ProjectContext.js

import axios from 'axios';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import {
  getActiveSession,
  getCurrentProject,
  insertErrorLog,
  saveProjects,
} from '../constants/Database'; // <-- ปรับ path ให้ถูกต้อง
import { useEnvironment } from './EnvironmentContext';



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

      // ✅ Log error to database
      try {
        const session = await getActiveSession();
        await insertErrorLog({
          comp_id: null,
          error_type: 'DATABASE_ERROR',
          error_message: error.message || 'Error refreshing current project',
          error_code: error.code || 'REFRESH_PROJECT_ERROR',
          page_name: 'ProjectContext.js',
          action_name: 'refreshCurrentProject',
          user_id: session?.user_id || null
        });
      } catch (logError) {
        console.error('Failed to log error:', logError);
      }
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

      const response = await axios.get(`${API_URL}/lpr/projects`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.lpr_token}`,
        },
      });

      if (response.status !== 200) {
        throw new Error("Failed to fetch projects from API.");
      }

      const data = response.data;
      console.log('data syncProjectsWithApi :>> ', data);

      if (data.result) {
        await saveProjects(data.result);
        console.log("✅ [CONTEXT] API Sync successful, projects saved.");
      }

      // หลังจาก Sync เสร็จ, ให้อัปเดตโปรเจกต์ปัจจุบันทันที
      await refreshCurrentProject();

    } catch (error) {
      console.error("❌ Error syncing projects with API:", error);

      // ✅ Log error to database
      try {
        const session = await getActiveSession();
        await insertErrorLog({
          comp_id: null,
          error_type: 'API_ERROR',
          error_message: error.message || 'Error syncing projects with API',
          error_code: error.response?.status || error.code || 'SYNC_PROJECTS_ERROR',
          page_name: 'ProjectContext.js',
          action_name: 'syncProjectsWithApi',
          user_id: session?.user_id || null
        });
      } catch (logError) {
        console.error('Failed to log error:', logError);
      }
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

