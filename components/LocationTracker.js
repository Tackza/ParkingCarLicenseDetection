// file: components/LocationTracker.js
//
// เก็บเส้นทางเดินของเครื่องไว้ให้ dashboard วาดเส้น (headless, mount ครั้งเดียวที่ root)
//
// - เก็บเฉพาะตอน: ล็อกอินอยู่ + มีกิจกรรมที่กำลังดำเนิน + แอปอยู่หน้าจอ (จอเปิด)
//   จอดับ / สลับไปแอปอื่น → หยุด (ไม่มี foreground service — ตั้งใจ ดู CLAUDE.md § Route tracking)
// - ขอพิกัดทุก 10 วิ บันทึกลง location_points ตามกติกาใน utils/routeTracking.js
// - ส่งขึ้น server เป็นชุดทุก 1 นาที ไป POST /lpr/locations (ROUTE_UPLOAD_ENABLED)
//
// ทุกค่าในแถว (รหัสเครื่อง ผู้ใช้ กิจกรรม) อ่าน ณ เวลาที่เก็บ ไม่ใช่ตอนส่ง

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import axios from 'axios';
import BackgroundTimer from 'react-native-background-timer';
import {
  getActiveSession,
  getSetting,
  getUnsyncedLocationPoints,
  insertErrorLogThrottled,
  insertLocationPoint,
  markLocationPointsSynced,
} from '@/constants/Database';
import { useEnvironment } from '@/contexts/EnvironmentContext';
import { useProject } from '@/contexts/ProjectContext';
import { ensurePermission } from '@/utils/location';
import {
  ROUTE_UPLOAD_ENABLED,
  ROUTE_UPLOAD_PATH,
  SAMPLE_INTERVAL_MS,
  UPLOAD_BATCH_SIZE,
  UPLOAD_INTERVAL_MS,
  nextLocationUpload,
  setTrackingState,
  shouldRecordPoint,
  toLocationRow,
} from '@/utils/routeTracking';

const UPLOAD_TIMEOUT = 30000;

const LocationTracker = () => {
  const { activeProject } = useProject();
  const { environment } = useEnvironment();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [hasSession, setHasSession] = useState(false);

  const projectRef = useRef(activeProject);
  useEffect(() => { projectRef.current = activeProject; }, [activeProject]);

  const lastPointRef = useRef(null);
  const uploadingRef = useRef(false);
  const uploadTimerRef = useRef(null);

  const apiUrl = environment === 'prod'
    ? 'https://mbus.dhammakaya.network/api'
    : 'https://mbus-test.dhammakaya.network/api';
  const apiUrlRef = useRef(apiUrl);
  useEffect(() => { apiUrlRef.current = apiUrl; }, [apiUrl]);

  // จอเปิด/ปิด — Android ส่ง background เมื่อจอดับหรือสลับแอป
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  // ── ส่งขึ้น server + ตรวจ session ทุก 1 นาที (chain แบบเดียวกับลูปอื่น ไม่ใช้ setInterval) ──
  const tick = useCallback(async () => {
    try {
      const session = await getActiveSession();
      setHasSession(!!session?.lpr_token);

      if (!ROUTE_UPLOAD_ENABLED || !session?.lpr_token || uploadingRef.current) return;
      uploadingRef.current = true;

      // ดึงเผื่อไว้ 2 เท่า — ชุดหนึ่งส่งได้กลุ่ม (comp_id, project_id) เดียว
      const rows = await getUnsyncedLocationPoints(UPLOAD_BATCH_SIZE * 2);
      if (rows.length === 0) return;
      const upload = nextLocationUpload(rows, await getSetting('machineCode'));
      if (!upload) return; // ยังไม่ตั้งรหัสเครื่อง — server บังคับ comp_id

      const res = await axios.post(`${apiUrlRef.current}${ROUTE_UPLOAD_PATH}`, upload.body, {
        headers: { Authorization: `Bearer ${session.lpr_token}`, 'Content-Type': 'application/json' },
        timeout: UPLOAD_TIMEOUT,
      });
      if (res.data?.status === 'success') {
        await markLocationPointsSynced(upload.ids);
      } else {
        throw new Error(res.data?.message || 'Unexpected response');
      }
    } catch (error) {
      // จุดยังอยู่ในเครื่อง รอบหน้าส่งใหม่ — 401 ปล่อยให้ลูปเช็กอินพาไปหน้าล็อกอิน
      insertErrorLogThrottled({
        error_type: 'ROUTE_UPLOAD_ERROR',
        error_message: error?.response?.data?.message || error?.message || String(error),
        error_code: error?.response?.status?.toString() || error?.code || null,
        page_name: 'LocationTracker',
        action_name: 'upload',
      }).catch(() => {});
    } finally {
      uploadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loop = async () => {
      await tick();
      if (!cancelled) uploadTimerRef.current = BackgroundTimer.setTimeout(loop, UPLOAD_INTERVAL_MS);
    };
    uploadTimerRef.current = BackgroundTimer.setTimeout(loop, 3000);
    return () => {
      cancelled = true;
      if (uploadTimerRef.current) BackgroundTimer.clearTimeout(uploadTimerRef.current);
    };
  }, [tick]);

  // ── เก็บพิกัด ──
  const projectKey = activeProject ? `${activeProject.project_id}|${activeProject.activity_id}` : null;
  const shouldTrack = appActive && hasSession && !!projectKey;

  useEffect(() => {
    if (!shouldTrack) {
      setTrackingState({
        active: false,
        reason: !hasSession ? 'no-session' : !projectKey ? 'no-project' : 'background',
      });
      return undefined;
    }

    let subscription = null;
    let stopped = false;

    (async () => {
      if (!(await ensurePermission())) {
        setTrackingState({ active: false, reason: 'no-permission' });
        return;
      }
      try {
        const sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: SAMPLE_INTERVAL_MS, distanceInterval: 0 },
          async (loc) => {
            const next = {
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              accuracy: loc.coords.accuracy,
              timestamp: loc.timestamp,
            };
            if (!shouldRecordPoint(lastPointRef.current, next)) return;
            lastPointRef.current = next;

            const project = projectRef.current;
            const [session, machineCode] = await Promise.all([getActiveSession(), getSetting('machineCode')]);
            if (!session) return; // ออกจากระบบไประหว่างทาง
            await insertLocationPoint(toLocationRow(loc, {
              comp_id: machineCode,
              user_id: session.user_id,
              project_id: project?.project_id,
              activity_id: project?.activity_id,
            }));
          }
        );
        if (stopped) sub.remove();
        else {
          subscription = sub;
          setTrackingState({ active: true, reason: 'tracking' });
        }
      } catch (error) {
        setTrackingState({ active: false, reason: 'error' });
        insertErrorLogThrottled({
          error_type: 'ROUTE_TRACK_ERROR',
          error_message: error?.message || String(error),
          error_code: error?.code || null,
          page_name: 'LocationTracker',
          action_name: 'watchPosition',
        }).catch(() => {});
      }
    })();

    return () => {
      stopped = true;
      subscription?.remove();
    };
  }, [shouldTrack, hasSession, projectKey]);

  return null;
};

export default LocationTracker;
