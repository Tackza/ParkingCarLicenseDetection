// `components/CheckInSyncManager.js`
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
// import { Ionicons } from '@expo/vector-icons';
import {
  clearSession,
  getActiveSession,
  getUnsyncedCheckIns,
  insertErrorLogThrottled,
  markCheckInAsSynced,
  markCheckInAsSyncedError
} from '@/constants/Database';
import { useAuth } from '@/contexts/AuthContext';
import { useEnvironment } from '@/contexts/EnvironmentContext';
import { useProject } from '@/contexts/ProjectContext';
import {
  buildCheckInFields,
  classifyUploadError,
  classifyUploadResponse,
  describeUploadError,
} from '@/utils/checkInUpload';
import axios from 'axios';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { useRouter } from 'expo-router';
import BackgroundTimer from 'react-native-background-timer';

const SYNC_INTERVAL = 10000; // 10 วินาที ระหว่างรอบ sync
// ✅ หน่วงก่อน sync รอบแรกหลัง mount พอให้ DB/session พร้อม (เดิม 20 วิ ซึ่งนานเกินจำเป็น)
const INITIAL_SYNC_DELAY = 5000;
// ✅ กันคำขอค้างเมื่อสัญญาณอ่อน/ต่อ wifi ได้แต่ออกเน็ตไม่ได้ (axios default = ไม่จำกัด)
const UPLOAD_TIMEOUT = 30000;


const CheckInSyncManager = () => {
  const { activeProject } = useProject();
  const router = useRouter();
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

  // ✅ Ref for tracking the current unique session of the effect/timer
  const currentSyncSessionId = useRef(0);
  const timeoutIdRef = useRef(null); // ✅ Use a single ref for the timeout


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
      const session = await getActiveSession();
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
      let authExpired = false; // ✅ ตั้งเมื่อเจอ 401/403 เพื่อหยุดลูปแล้วบังคับ login ใหม่
      let networkDown = false; // ✅ ตั้งเมื่อยิงไม่ออกเลย — แถวที่เหลือก็จะพังเหมือนกัน ไม่ต้องลองต่อ
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

        // ✅ ต้องประกาศใหม่ทุกรอบ ไม่งั้นค่าเดิมจะค้างข้าม iteration (และข้ามรอบ sync)
        //    ทำให้รายการที่ไม่มีรูป/รูปหายจาก cache ถูกแนบรูปของคันก่อนหน้าไปแทน
        //    ประกาศนอก try เพื่อให้ finally ลบไฟล์ชั่วคราวได้
        let processedPhotoUri = null;
        // ไฟล์รูปต้นฉบับยังอยู่จริงไหม — ใช้ตัดสินว่าจะแนบตัวต้นฉบับแทนได้หรือเปล่า
        let photoExists = false;

        try {

          if (checkIn.photo_path) {
            const fileInfo = await FileSystem.getInfoAsync(checkIn.photo_path);
            if (fileInfo.exists) {
              photoExists = true;

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
              // ✅ photo_path ชี้ไป cache ของ ImagePicker ซึ่ง Android เก็บกวาดได้
              //    คิวที่ค้างนานจึงเสียรูปแบบเงียบๆ — ต้องเห็นใน error log ที่ export ไปตรวจ
              console.log(`Original photo file not found for check-in uid ${checkIn.uid}: ${checkIn.photo_path}`);
              insertErrorLogThrottled({
                comp_id: checkIn.comp_id || null,
                error_type: 'PHOTO_MISSING',
                error_message: `Photo file gone before upload: ${checkIn.photo_path}`,
                error_code: 'PHOTO_NOT_FOUND',
                page_name: 'CheckInSyncManager.js',
                action_name: 'syncCheckInsToServer - photo',
                user_id: user?.id || null
              }).catch(e => console.error('Failed to log error:', e));
            }
          }

          const formData = new FormData();

          // ฟิลด์ทั้งหมดมาจากแถว check_ins เอง (รายละเอียดใน utils/checkInUpload.js)
          for (const [name, value] of buildCheckInFields(checkIn)) {
            formData.append(name, value);
          }

          if (processedPhotoUri) { // ✅ ใช้ processedPhotoUri ที่ถูกลดขนาดแล้ว
            const filename = processedPhotoUri.split('/').pop();
            const fileType = 'image/jpeg'; // รูปภาพที่ถูกลดขนาดจะถูกแปลงเป็น JPEG
            formData.append('photo_file', {
              uri: processedPhotoUri,
              name: filename,
              type: fileType,
            });
            console.log(`Attached processed photo_file: ${filename}`);
          } else if (photoExists) {
            // กรณีลดขนาดไม่ได้ แต่ไฟล์เดิมยังอยู่ ก็ส่งตัวเดิมไป
            // ✅ ต้องเช็คว่าไฟล์ยังอยู่ — เดิมเช็คแค่ photo_path จึงแนบ path ของไฟล์ที่ถูกลบไปแล้วด้วย
            //    บนเครื่องจริงการแนบไฟล์ที่ไม่มีอยู่ล้มแบบ network error → ถูกมองว่าออฟไลน์ หยุดทั้ง batch
            //    แถวนี้จึงล้มซ้ำทุกรอบ และแถวที่ต่อคิวหลังมันไม่เคยถูกส่ง
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
            timeout: UPLOAD_TIMEOUT, // ✅ กันลูป sync ค้างยาวเมื่อเน็ตติดๆ ดับๆ
          });

          // axios โยน error เองเมื่อ status ไม่ใช่ 2xx บล็อกนี้จึงเข้าเฉพาะ 2xx ที่ไม่ใช่ 200 (เช่น 201/204)
          // เดิมเรียก response.text() ซึ่งเป็นเมธอดของ fetch ไม่ใช่ axios จึงได้ TypeError
          // แล้วถูกบันทึกเป็น error คนละสาเหตุกับที่เกิดจริง
          if (response.status !== 200) {
            const body = typeof response.data === 'string'
              ? response.data
              : JSON.stringify(response.data ?? '');
            const err = new Error(`Unexpected status ${response.status}: ${body}`);
            err.status = response.status;
            throw err;
          }
          // setIsOnline(true);
          const responseData = await response.data;
          console.log('responseData :>> ', responseData);
          // --- สิ้นสุดโค้ดจริง --- 

          const { outcome, message: errorMessage } = classifyUploadResponse(responseData);
          if (outcome === 'synced') {
            // success หรือ server บอกว่ามีแถวนี้แล้ว (uid ซ้ำ)
            console.log(`Check-in uid ${checkIn.uid} synced${errorMessage ? ` (${errorMessage})` : ''}.`);
            await markCheckInAsSynced(checkIn.id, 2);
            successfulUploads++;
            setUploadedCount(successfulUploads); // ✅ อัปเดตเคาน์เตอร์
          } else {
            console.log(`Server reported an error for check-in uid ${checkIn.uid}:`, errorMessage);
            setSyncError(`บางรายการมีปัญหา: ${errorMessage.substring(0, 50)}...`);
            await markCheckInAsSyncedError(checkIn.id, errorMessage, 4);
          }
        } catch (itemError) {
          // เก็บเหตุผลจาก server ด้วย ไม่ใช่แค่ข้อความสำเร็จรูปของ axios
          const errorMsg = describeUploadError(itemError);
          console.log(`Failed to upload check-in uid ${checkIn.uid}:`, errorMsg);
          console.log('itemError message :>> ', itemError);

          // ✅ Log error to database (throttled — ทุกแถวที่ล้มจะให้ error เดียวกันตอนออฟไลน์)
          try {
            await insertErrorLogThrottled({
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

          // ตัดสินด้วย classifyUploadError (utils/checkInUpload.js): 401/403 → หยุดทั้ง batch คงที่ 3
          //   4xx → 4 (ถอยเวลา) / 5xx, timeout, ออฟไลน์ → 3 (ส่งใหม่รอบหน้าทันที) / ซ้ำ → สำเร็จ
          const { authExpired: isAuthError, duplicate, syncStatus, networkFailure: isNetworkFailure } =
            classifyUploadError(itemError, errorMsg);

          if (isAuthError) {
            // ถ้า mark เป็น 4 ข้อมูลจะค้างถาวรแม้ login ใหม่สำเร็จ
            console.log(`🔐 Token invalid while uploading uid ${checkIn.uid}. Aborting batch.`);
            await markCheckInAsSyncedError(checkIn.id, errorMsg, 3);
            setSyncError('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
            authExpired = true;
            break;
          }

          if (duplicate) {
            console.log(`✅ UID ${checkIn.uid} already exists on server. Marking as synced.`);
            await markCheckInAsSynced(checkIn.id, 2);
            successfulUploads++;
            setUploadedCount(successfulUploads);
          } else {
            setSyncError(`บางรายการมีปัญหา: ${errorMsg.substring(0, 50)}...`);
            await markCheckInAsSyncedError(checkIn.id, errorMsg, syncStatus);
          }

          // ✅ ยิงไม่ถึง server แปลว่าแถวที่เหลือใน batch ก็จะพังเหมือนกัน — หยุดแล้วรอรอบหน้า
          //    ออฟไลน์คิว 50 แถวจึงเสีย request แค่ 1 ครั้งต่อรอบ แทนที่จะเป็น 50
          //    แถวที่เหลือคงสถานะเดิมไว้ จึงถูกหยิบมาส่งทันทีที่เน็ตกลับมา (ไม่มีการถอยเวลา)
          if (isNetworkFailure) {
            console.log('🌐 Network unreachable — aborting rest of batch, will retry next cycle.');
            networkDown = true;
            break;
          }
        } finally {
          // ✅ ลบไฟล์ย่อขนาดที่ ImageManipulator สร้างไว้ ไม่งั้น cache โตขึ้นเรื่อยๆ ทุกครั้งที่ retry
          //    ห้ามแตะ checkIn.photo_path (ต้นฉบับ) เพราะยังต้องใช้ตอนส่งรอบถัดไป
          //    finally ทำงานก่อน break ของเคส 401 ด้วย จึงไม่มีไฟล์ตกค้าง
          if (processedPhotoUri && processedPhotoUri !== checkIn.photo_path) {
            await FileSystem.deleteAsync(processedPhotoUri, { idempotent: true })
              .catch(e => console.log('Failed to delete temp photo:', e?.message));
          }
        }
      } // สิ้นสุด for-loop

      // ✅ Token ใช้ไม่ได้แล้ว — บังคับ login ใหม่แบบเดียวกับ loop registers ใน app/(tabs)/_layout.js
      //    ข้อมูลที่ค้างยังอยู่ที่ sync_status 0/3 จึงถูกส่งต่อได้ทันทีหลัง login สำเร็จ
      if (authExpired) {
        console.log('🔐 Forcing re-login after auth failure during check-in sync.');
        await clearSession();
      // ไม่ลบ saved_printer — เครื่องพิมพ์ผูกกับ "เครื่อง" ไม่ใช่ผู้ใช้หรือ environment
      // ลบทิ้งแล้วรอบหน้าจะ auto-connect ไม่ได้ ต้องให้คนมาเลือกใหม่ทุกครั้ง
        router.replace('/login');
        return;
      }

      if (networkDown) {
        // ไม่ใช่ "บางรายการมีปัญหา" — ข้อมูลไม่ได้ผิด แค่ยังส่งไม่ได้
        setSyncError('ออฟไลน์ — ค้างไว้ในเครื่อง จะส่งอัตโนมัติเมื่อกลับมาออนไลน์');
        setLastCheckInSyncTime(new Date());
        return;
      }

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

      // ✅ Log error to database (throttled — ลูปนี้วนทุก 10 วิ)
      try {
        await insertErrorLogThrottled({
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

  // ✅ เก็บ ref ไปยัง sync function ล่าสุด เพราะ effect ด้านล่างรันครั้งเดียวตอน mount
  //    จึงต้องให้ timer chain เรียก closure ปัจจุบันเสมอ (เช่นเมื่อผู้ใช้สลับ environment แล้ว API_URL เปลี่ยน)
  const syncFnRef = useRef(null);
  useEffect(() => {
    syncFnRef.current = syncCheckInsToServer;
  }, [syncCheckInsToServer]);

  const scheduleNextSync = (sessionId) => {
    // Only schedule if the session is still valid
    if (sessionId !== currentSyncSessionId.current) return;

    // ✅ เคลียร์ timer เดิมก่อนเสมอ กัน chain ซ้อนกันหลายเส้น
    if (timeoutIdRef.current) {
      BackgroundTimer.clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }

    console.log(`Scheduling next sync for session ${sessionId} in ${SYNC_INTERVAL}ms`);
    timeoutIdRef.current = BackgroundTimer.setTimeout(() => {
      syncFnRef.current?.(sessionId);
    }, SYNC_INTERVAL);
  };


  // ✅ เริ่ม timer chain ครั้งเดียวตอน mount แล้วปล่อยให้วนต่อไปเรื่อยๆ
  //    ห้ามผูก dependency กับ activeProject: getCurrentProject() คืน object ใหม่ทุกครั้ง และหน้า main
  //    เรียก refreshCurrentProject() ทุกครั้งที่ focus (ซึ่งเกิดหลังพิมพ์เสร็จทุกใบ) effect จึง re-run
  //    แล้วนับ delay เริ่มต้นใหม่ไม่รู้จบ — ถ้าสแกนถี่กว่า delay คิวจะไม่ถูกส่งเลยตลอดกะ
  //    syncCheckInsToServer อ่านโปรเจกต์ผ่าน activeProjectRef อยู่แล้ว และ schedule รอบถัดไปเองเมื่อยังไม่มีโปรเจกต์
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

    console.log("Setting up initial background timer...");
    timeoutIdRef.current = BackgroundTimer.setTimeout(() => {
      console.log("BackgroundTimer: Initial sync triggered.");
      syncFnRef.current?.(newSessionId);
    }, INITIAL_SYNC_DELAY);

    // ✅ 6. Cleanup function (สำคัญมาก!)
    return () => {
      console.log(`Session Cleaned: ${newSessionId} (Timer removed)`);
      currentSyncSessionId.current = 0; // run ที่ค้างอยู่จะไม่ schedule รอบถัดไป
      if (timeoutIdRef.current) {
        BackgroundTimer.clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
    };
  }, []);

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