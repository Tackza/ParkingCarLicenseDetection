// `components/CheckInSyncManager.js`
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
// import { Ionicons } from '@expo/vector-icons';
import {
  getActiveSession,
  getCurrentProject,
  getUnsyncedCheckIns,
  insertErrorLog,
  markCheckInAsSynced,
  markCheckInAsSyncedError
} from '@/constants/Database';
import { useAuth } from '@/contexts/AuthContext';
import { useEnvironment } from '@/contexts/EnvironmentContext';
import { useProject } from '@/contexts/ProjectContext';
import axios from 'axios';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import BackgroundTimer from 'react-native-background-timer';

const SYNC_INTERVAL = 10000; // 1 นาที


const CheckInSyncManager = () => {
  const { activeProject } = useProject();
  // ✅ ใช้ state ของ Component นี้เอง
  const [isCheckInSyncing, setIsCheckInSyncing] = useState(false);
  const [lastCheckInSyncTime, setLastCheckInSyncTime] = useState(null);
  const [syncError, setSyncError] = useState(null);
  const [uploadedCount, setUploadedCount] = useState(0); // ✅ เพิ่ม state สำหรับนับจำนวนที่อัปโหลดสำเร็จ
  const [totalToUpload, setTotalToUpload] = useState(0); // ✅ เพิ่ม state สำหรับจำนวนทั้งหมดที่จะอัปโหลด

  // ✅ ใช้ useSync context สำหรับสถานะรวม (ถ้าคุณต้องการแสดงผลที่ SyncStatus component)
  // ถ้าไม่ต้องการ ให้ลบ setIsOnline ออก
  // const { setIsOnline } = useSync();

  const intervalIdRef = useRef(null);
  const initialSyncTimeoutRef = useRef(null);
  const isSyncInProgress = useRef(false);

  // ✅ Use a ref to keep track of activeProject without forcing re-renders or re-creating callbacks
  const activeProjectRef = useRef(activeProject);
  const { user } = useAuth();

  useEffect(() => {
    activeProjectRef.current = activeProject;
  }, [activeProject]);

  const { environment } = useEnvironment();

  const API_URL = environment === 'prod' ?
    "https://mbus.dhammakaya.network/api" :
    "https://mbus-test.dhammakaya.network/api";

  const isDuplicateError = (errorMessage) => {
    console.log('errorMessage 44 :>> ', errorMessage);
    if (!errorMessage) return false;

    // ✅ สร้าง string จาก error ทุกแบบ
    let errorText = '';

    if (typeof errorMessage === 'string') {
      errorText = errorMessage;
    } else if (errorMessage instanceof Error) {
      errorText = errorMessage.message;
    } else if (errorMessage.message) {
      errorText = errorMessage.message;
    } else {
      errorText = JSON.stringify(errorMessage);
    }

    // ✅ แปลงเป็นตัวพิมพ์เล็กเพื่อให้ match ง่ายขึ้น
    errorText = errorText.toLowerCase();
    console.log('errorText to check :>> ', errorText);


    return errorText.includes('duplicate') || errorText.includes('already exists');
  };


  // ✅ Ref for tracking the current unique session of the effect/timer
  const currentSyncSessionId = useRef(0);
  const timeoutIdRef = useRef(null); // ✅ Use a single ref for the timeout


  const checkOCRConnection = (data) => {
    if (!data.detect_plate_no && !data.detect_plate_no) {
      return "0"
    }
    return "1"
  }

  const syncCheckInsToServer = useCallback(async (sessionId) => {
    // console.log('syncCheckInsToServer called');
    const currentProject = activeProjectRef.current; // ✅ Access via ref

    // ✅ Verify Session: If the session ID passed to this function doesn't match the current ref,
    // it means a new effect/timer has started, so we should abort this stale process.
    if (sessionId && sessionId !== currentSyncSessionId.current) {
      console.log(`Sync aborted: Stale session (Current: ${currentSyncSessionId.current}, This: ${sessionId})`);
      return;
    }

    if (isSyncInProgress.current) {
      console.log("Check-in Sync skipped: Ref lock is active.");
      // ✅ Even if skipped, we must schedule the next run!
      scheduleNextSync(sessionId);
      return;
    }

    if (!currentProject) { // ✅ Check currentProject
      console.log("Check-in Sync skipped: No active project.");
      // ✅ Even if skipped, we must schedule the next run (or maybe wait for project change, but keeping it running is safer for now)
      scheduleNextSync(sessionId);
      return;
    }

    isSyncInProgress.current = true;
    setIsCheckInSyncing(true);
    setSyncError(null); // เคลียร์ error เก่า
    setUploadedCount(0); // ✅ รีเซ็ตเคาน์เตอร์
    setTotalToUpload(0); // ✅ รีเซ็ตเคาน์เตอร์
    console.log("Starting check-ins sync for project:", currentProject?.project_id);

    try {
      const currentProject = await getCurrentProject();
      const session = await getActiveSession();
      console.log('currentProject checksyns :>> ', currentProject);
      // ✅ ถ้าไม่มี token (เช่นตอน logout) ให้หยุดอย่างสงบ ไม่ throw error
      if (!session?.lpr_token) {
        console.log("Check-in Sync skipped: No LprToken (user logged out).");
        setIsCheckInSyncing(false);
        return;
      }

      const unsyncedCheckIns = await getUnsyncedCheckIns();
      console.log('unsyncedCheckIns :>> ', unsyncedCheckIns.length);
      if (unsyncedCheckIns.length === 0) {
        console.log("No unsynced check-ins to upload.");
        setLastCheckInSyncTime(new Date()); // อัปเดตเวลาแม้จะไม่มีข้อมูลให้ Sync
        setIsCheckInSyncing(false); // ✅ ต้องปิดสถานะ Sync ตรงนี้
        return;
      }

      setTotalToUpload(unsyncedCheckIns.length); // ✅ ตั้งค่าจำนวนทั้งหมด
      console.log(`Preparing to upload ${unsyncedCheckIns.length} unsynced check-ins to server, one by one.`);

      const apiUrl = `${API_URL}/lpr/checkins`; // <-- ✅ เปลี่ยน API Endpoint สำหรับส่งทีละรายการ

      let successfulUploads = 0;
      for (const checkIn of unsyncedCheckIns) {


        // checkIn = {
        //   ...checkIn,
        //   activity_id: checkIn.activity_id === null ? "" : checkIn.activity_id,
        //   seq_no: checkIn.seq_no === null ? "" : checkIn.seq_no,
        // }

        // ✅ Check abort condition INSIDE loop
        if (currentSyncSessionId.current !== sessionId) {
          console.log("🛑 Sync loop aborted mid-process due to session change.");
          break;
        }

        console.log('checkIn :>> ', checkIn);
        try {


          if (checkIn.photo_path) {
            const fileInfo = await FileSystem.getInfoAsync(checkIn.photo_path);
            if (fileInfo.exists) {

              const manipulateResult = await ImageManipulator.manipulateAsync(
                checkIn.photo_path,
                [{ resize: { width: 400 } }], // ✅ ลดความกว้างเหลือ 800px (ความสูงจะปรับอัตโนมัติ)
                {
                  compress: 0.7, // ✅ ลดคุณภาพเป็น 70% (0.0 - 1.0)
                  format: ImageManipulator.SaveFormat.JPEG, // ✅ บังคับเป็น JPEG
                  base64: false, // ไม่ต้องแปลงเป็น Base64
                }
              );
              processedPhotoUri = manipulateResult.uri;

            } else {
              console.log(`Original photo file not found for check-in uid ${checkIn.uid}: ${checkIn.photo_path}`);
            }
          }

          const ocrConnected = checkOCRConnection(checkIn) ? '1' : '0';

          const formData = new FormData();

          formData.append('uid', checkIn.uid);
          formData.append('local_id', checkIn.id.toString());
          formData.append('project_id', checkIn.project_id);
          formData.append('activity_id', checkIn.activity_id === null ? "" : checkIn.activity_id);
          formData.append('register_id', checkIn.register_id || ''); // ถ้า register_id เป็น null/undefined ส่งเป็น empty string
          formData.append('detect_plate_no', checkIn.detect_plate_no);
          formData.append('detect_plate_province', checkIn.detect_plate_province);
          formData.append('plate_no', checkIn.plate_no || '');
          formData.append('plate_province', checkIn.plate_province || '');
          formData.append('is_manual', checkIn.is_plate_manual ? '1' : '0'); // แปลง boolean/integer เป็น string '1'/'0'
          formData.append('bus_type', checkIn.bus_type || '');
          formData.append('passenger', checkIn.passenger || '');
          formData.append('mileage', checkIn.mileage || '');
          formData.append('sticker_no', checkIn.sticker_no === null ? "" : checkIn.sticker_no);
          formData.append('note', checkIn.note || '');
          formData.append('comp_id', checkIn.comp_id || '');
          formData.append('ocr_connected', ocrConnected);
          formData.append('lat', 0);
          formData.append('long', 0);
          formData.append('seq_no', currentProject.seq_no === null ? "" : currentProject.seq_no);
          formData.append('printed', checkIn.printed ? '1' : '0');
          formData.append('created_at', checkIn.created_at || new Date().toISOString()); // ใช้ ISO string หรือรูปแบบที่ server ต้องการ
          formData.append('created_by', checkIn.created_by || '');

          if (processedPhotoUri) { // ✅ ใช้ processedPhotoUri ที่ถูกลดขนาดแล้ว
            const filename = processedPhotoUri.split('/').pop();
            const fileType = 'image/jpeg'; // รูปภาพที่ถูกลดขนาดจะถูกแปลงเป็น JPEG
            formData.append('photo_file', {
              uri: processedPhotoUri,
              name: filename,
              type: fileType,
            });
            console.log(`Attached processed photo_file: ${filename}`);
          } else if (checkIn.photo_path) {
            // กรณีลดขนาดไม่ได้ แต่มี photo_path เดิมอยู่ ก็พยายามส่งตัวเดิมไป
            const filename = checkIn.photo_path.split('/').pop();
            const fileType = 'image/jpeg'; // หรือ 'image/png'
            formData.append('photo_file', {
              uri: checkIn.photo_path,
              name: filename,
              type: fileType,
            });
            // console.warn(`Attached original photo_file (failed to process): ${filename}`);
          } else {
            console.log(`No photo_file to attach for check-in uid ${checkIn.uid}`);
          }

          console.log('--- (React Native) ดูข้อมูล formData._parts ---');
          console.log(formData._parts);

          const response = await axios.post(apiUrl, formData, {
            headers: {
              'Authorization': `Bearer ${session.lpr_token}`,
              'Content-Type': 'multipart/form-data',

            },
          });

          if (response.status !== 200) {
            const errorText = await response.text();
            // throw new Error(`Server response for uid ${checkIn.uid} not ok, status: ${response.status}, message: ${errorText}`);
            const err = new Error(errorText);
            err.status = response.status;
            throw err;
          }
          // setIsOnline(true);
          const responseData = await response.data;
          console.log('responseData :>> ', responseData);
          // --- สิ้นสุดโค้ดจริง --- 

          if (responseData.status === "success") {
            console.log(`Check-in uid ${checkIn.uid} uploaded successfully. Marking as synced.`);
            await markCheckInAsSynced(checkIn.id, 2);
            successfulUploads++;
            setUploadedCount(successfulUploads); // ✅ อัปเดตเคาน์เตอร์
          } else {
            const errorMessage = responseData.message || "Unknown error from server.";

            if (isDuplicateError(errorMessage)) {
              console.log(`✅ UID ${checkIn.uid} already exists (from response). Marking as synced.`);
              await markCheckInAsSynced(checkIn.id, 2);
              successfulUploads++;
              setUploadedCount(successfulUploads);
            } else {
              console.log(`Server reported an error for check-in uid ${checkIn.uid}:`, errorMessage);
              setSyncError(`บางรายการมีปัญหา: ${errorMessage.substring(0, 50)}...`);
              await markCheckInAsSyncedError(checkIn.id, errorMessage, 4);
            }
          }
        } catch (itemError) {
          const errorMsg = itemError.message || itemError.toString();
          console.log(`Failed to upload check-in uid ${checkIn.uid}:`, errorMsg);
          console.log('itemError message :>> ', itemError);
          console.log('isDuplicateError(errorMessage) :>> ', isDuplicateError(errorMsg));

          // ✅ Log error to database
          try {
            await insertErrorLog({
              comp_id: checkIn.comp_id || null,
              error_type: 'SYNC_ERROR',
              error_message: errorMsg,
              error_code: itemError.response?.status || itemError.status || itemError.code || 'CHECKIN_UPLOAD_ERROR',
              page_name: 'CheckInSyncManager.js',
              action_name: 'syncCheckInsToServer - itemError',
              user_id: user?.id || null
            });
          } catch (logError) {
            console.error('Failed to log error:', logError);
          }

          // ✅ ตรวจสอบ Network Error แลา HTTP Status Code อย่างละเอียด
          let syncStatus = 3; // ค่าเริ่มต้นสำหรับ Network/Server Error

          if (itemError.response?.status) {
            // ✅ ถ้ามี HTTP status code จาก axios response
            console.log('itemError.response.status :>> ', itemError.response.status);
            if (itemError.response.status >= 400 && itemError.response.status < 500) syncStatus = 4;
            else if (itemError.response.status >= 500) syncStatus = 3;
          } else if (itemError.code === 'ECONNABORTED' || errorMsg.includes('timeout')) {
            // ✅ Request timeout
            syncStatus = 3;
            console.log('Network timeout detected');
          } else if (itemError.code === 'ENOTFOUND' || errorMsg.includes('Network')) {
            // ✅ Network Error (No Internet)
            syncStatus = 3;
            console.log('Network connection error detected');
          } else {
            console.log('itemError.status :>> ', itemError.status);
            if (itemError.status) {
              if (itemError.status >= 400 && itemError.status < 500) syncStatus = 4;
              else if (itemError.status >= 500) syncStatus = 3;
            }
          }

          // ✅ ตรวจสอบว่าเป็น error ซ้ำหรือไม่
          if (isDuplicateError(errorMsg)) {
            console.log(`✅ UID ${checkIn.uid} already exists on server. Marking as synced.`);
            await markCheckInAsSynced(checkIn.id, 2);
            successfulUploads++;
            setUploadedCount(successfulUploads);
          } else {
            setSyncError(`บางรายการมีปัญหา: ${errorMsg.substring(0, 50)}...`);
            await markCheckInAsSyncedError(checkIn.id, errorMsg, syncStatus);
            // setIsOnline(false);
          }
        }
      } // สิ้นสุด for-loop

      if (successfulUploads === unsyncedCheckIns.length) {
        console.log(`✅ All ${successfulUploads} check-ins uploaded successfully.`);
        setSyncError(null); // เคลียร์ error ถ้าสำเร็จทั้งหมด
      } else {
        console.log(`⚠️ Upload finished. ${successfulUploads} of ${unsyncedCheckIns.length} check-ins uploaded successfully.`);
        // ถ้ามีบางรายการไม่สำเร็จ เราจะคง syncError ไว้
      }
      setLastCheckInSyncTime(new Date());

    } catch (fullSyncError) { // ข้อผิดพลาดที่เกิดขึ้นก่อนเริ่ัมวนลูป (เช่น ไม่ได้ token)
      setSyncError(fullSyncError.message);
      console.error("Check-ins full sync failed:", fullSyncError);

      // ✅ Log error to database
      try {
        await insertErrorLog({
          comp_id: null,
          error_type: 'SYNC_ERROR',
          error_message: fullSyncError.message || 'Check-ins full sync failed',
          error_code: fullSyncError.code || 'FULL_SYNC_ERROR',
          page_name: 'CheckInSyncManager.js',
          action_name: 'syncCheckInsToServer - fullSyncError',
          user_id: user?.id || null
        });
      } catch (logError) {
        console.error('Failed to log error:', logError);
      }

      // setIsOnline(false);
    } finally {
      isSyncInProgress.current = false;
      setIsCheckInSyncing(false);
      // ✅ Schedule next run regardless of success/failure
      scheduleNextSync(sessionId);
    }
  }, [
    // activeProject, // ❌ REMOVE dependency to avoid re-creation
    //  setIsOnline, 
    API_URL]);

  const scheduleNextSync = (sessionId) => {
    // Only schedule if the session is still valid
    if (sessionId !== currentSyncSessionId.current) return;

    console.log(`Scheduling next sync for session ${sessionId} in ${SYNC_INTERVAL}ms`);
    timeoutIdRef.current = BackgroundTimer.setTimeout(() => {
      syncCheckInsToServer(sessionId);
    }, SYNC_INTERVAL);
  };


  useEffect(() => {
    // 1. Generate New Session ID
    const newSessionId = Date.now();
    currentSyncSessionId.current = newSessionId; // Set current "valid" session
    console.log(`Session Started: ${newSessionId}`);

    // Clear any existing timer
    if (timeoutIdRef.current) {
      BackgroundTimer.clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }

    if (activeProject) {
      console.log("Setting up initial background timer...");
      // Initial delay before first sync
      timeoutIdRef.current = BackgroundTimer.setTimeout(() => {
        console.log("BackgroundTimer: Initial sync triggered.");
        syncCheckInsToServer(newSessionId);
      }, 20000); // 20 seconds initial delay
    } else {
      console.log("No active project, sync not started.");
    }

    // ✅ 6. Cleanup function (สำคัญมาก!)
    return () => {
      console.log(`Session Cleaned: ${newSessionId} (Timer removed)`);
      if (timeoutIdRef.current) {
        BackgroundTimer.clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
    };
  }, [activeProject]); // ✅ Depend on activeProject to restart session when it changes

  return null; // Component นี้ไม่จำเป็นต้อง render อะไร


};

const styles = StyleSheet.create({
  container: {
    padding: 5,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    marginHorizontal: 16, // ปรับให้เท่ากับ HistoryItem
    marginTop: 5,
  },
  syncStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncText: {
    marginLeft: 8,
    fontSize: 12,
    color: '#34495e',
  },
});

export default CheckInSyncManager;