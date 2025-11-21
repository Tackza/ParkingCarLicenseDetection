// `components/CheckInSyncManager.js`
import React, { useEffect, useCallback, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
// import { Ionicons } from '@expo/vector-icons';
import { useProject } from '@/contexts/ProjectContext';
import { useSync } from '@/contexts/SyncContext'; // ถ้าต้องการอัปเดตสถานะ Sync รวม
import {
  getActiveSession,
  getUnsyncedCheckIns,
  markCheckInAsSynced,
  markCheckInAsSyncedError
} from '@/constants/Database';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { useEnvironment } from '@/contexts/EnvironmentContext';
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
  const { setIsOnline } = useSync();

  const intervalIdRef = useRef(null);
  const initialSyncTimeoutRef = useRef(null);
  const isSyncInProgress = useRef(false);

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

    // ✅ เช็คด้วยทั้ง RegEx และ includes()
    const hasKeyword =
      errorText.includes('uid:') ||
      errorText.includes('ซ้ำ') ||
      errorText.includes('duplicate') ||
      errorText.includes('already exists') ||
      errorText.includes('already registered');

    return hasKeyword;
  };


  const syncCheckInsToServer = useCallback(async () => {
    console.log('syncCheckInsToServer called');
    if (isSyncInProgress.current) {
      console.log("Check-in Sync skipped: Ref lock is active.");
      return;
    }
    // if (isCheckInSyncing) {
    //   console.log("Check-in Sync skipped: Already syncing check-ins.");
    //   return;
    // }
    if (!activeProject) {
      console.log("Check-in Sync skipped: No active project.");
      return;
    }

    isSyncInProgress.current = true;
    setIsCheckInSyncing(true);
    setSyncError(null); // เคลียร์ error เก่า
    setUploadedCount(0); // ✅ รีเซ็ตเคาน์เตอร์
    setTotalToUpload(0); // ✅ รีเซ็ตเคาน์เตอร์
    console.log("Starting check-ins sync for project:", activeProject?.project_id);

    try {
      const session = await getActiveSession();
      if (!session?.lpr_token) throw new Error("No LprToken found.");

      const unsyncedCheckIns = await getUnsyncedCheckIns();
      console.log('unsyncedCheckIns :>> ', unsyncedCheckIns);
      if (unsyncedCheckIns.length === 0) {
        console.log("No unsynced check-ins to upload.");
        setLastCheckInSyncTime(new Date()); // อัปเดตเวลาแม้จะไม่มีข้อมูลให้ Sync
        setIsCheckInSyncing(false); // ✅ ต้องปิดสถานะ Sync ตรงนี้
        return;
      }

      setTotalToUpload(unsyncedCheckIns.length); // ✅ ตั้งค่าจำนวนทั้งหมด
      console.log(`Preparing to upload ${unsyncedCheckIns.length} unsynced check-ins to server, one by one.`);

      const apiUrl = `${API_URL}/lpr/registers/checkin`; // <-- ✅ เปลี่ยน API Endpoint สำหรับส่งทีละรายการ

      let successfulUploads = 0;
      for (const checkIn of unsyncedCheckIns) {
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

          const formData = new FormData();

          formData.append('uid', checkIn.uid);
          formData.append('project_id', checkIn.project_id);
          formData.append('activity_id', checkIn.activity_id || 0);
          formData.append('register_id', checkIn.register_id || ''); // ถ้า register_id เป็น null/undefined ส่งเป็น empty string
          formData.append('detect_plate_no', checkIn.detect_plate_no || checkIn.plate_no);
          formData.append('detect_plate_province', checkIn.detect_plate_province || checkIn.plate_province);
          formData.append('plate_no', checkIn.plate_no || '');
          formData.append('plate_province', checkIn.plate_province || '');
          formData.append('is_manual', checkIn.is_plate_manual ? '1' : '0'); // แปลง boolean/integer เป็น string '1'/'0'
          formData.append('bus_type', checkIn.bus_type || '');
          formData.append('passenger', checkIn.passenger || '');
          formData.append('sticker_no', checkIn.sticker_no || '');
          formData.append('note', checkIn.note || '');
          formData.append('comp_id', checkIn.comp_id || '');
          formData.append('lat', 0);
          formData.append('long', 0);
          formData.append('seq_no', session.seq_no || '');
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



          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${session.lpr_token}`,
            },
            body: formData, // ส่งทีละรายการ
          });

          if (!response.ok) {
            const errorText = await response.text();
            // throw new Error(`Server response for uid ${checkIn.uid} not ok, status: ${response.status}, message: ${errorText}`);
            throw new Error(errorText)
          }
          setIsOnline(true);
          const responseData = await response.json();
          console.log('responseData :>> ', responseData);
          // --- สิ้นสุดโค้ดจริง --- 

          if (responseData.status === "success") {
            console.log(`Check-in uid ${checkIn.uid} uploaded successfully. Marking as synced.`);
            await markCheckInAsSynced(checkIn.id);
            successfulUploads++;
            setUploadedCount(successfulUploads); // ✅ อัปเดตเคาน์เตอร์
          } else {
            const errorMessage = responseData.message || "Unknown error from server.";

            if (isDuplicateError(errorMessage)) {
              console.log(`✅ UID ${checkIn.uid} already exists (from response). Marking as synced.`);
              await markCheckInAsSynced(checkIn.id);
              successfulUploads++;
              setUploadedCount(successfulUploads);
            } else {
              console.log(`Server reported an error for check-in uid ${checkIn.uid}:`, errorMessage);
              setSyncError(`บางรายการมีปัญหา: ${errorMessage.substring(0, 50)}...`);
              await markCheckInAsSyncedError(checkIn.id, errorMessage);
            }
          }
        } catch (itemError) {
          const errorMsg = itemError.message || itemError.toString();
          console.log(`Failed to upload check-in uid ${checkIn.uid}:`, errorMsg);
          console.log('itemError message :>> ', itemError);
          console.log('isDuplicateError(errorMessage) :>> ', isDuplicateError(errorMsg));
          // ✅ ตรวจสอบว่าเป็น error ซ้ำหรือไม่
          if (isDuplicateError(errorMsg)) {
            console.log(`✅ UID ${checkIn.uid} already exists on server. Marking as synced.`);
            await markCheckInAsSynced(checkIn.id);
            successfulUploads++;
            setUploadedCount(successfulUploads);
          } else {
            setSyncError(`บางรายการมีปัญหา: ${errorMsg.substring(0, 50)}...`);
            await markCheckInAsSyncedError(checkIn.id, errorMsg);
            setIsOnline(false);
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

    } catch (fullSyncError) { // ข้อผิดพลาดที่เกิดขึ้นก่อนเริ่มวนลูป (เช่น ไม่ได้ token)
      setSyncError(fullSyncError.message);
      console.error("Check-ins full sync failed:", fullSyncError);
      setIsOnline(false);
    } finally {
      isSyncInProgress.current = false;
      setIsCheckInSyncing(false);
    }
  }, [activeProject, setIsOnline, API_URL]);


  useEffect(() => {
    const setupInterval = () => {
      // ✅ 2. เปลี่ยนมาใช้ BackgroundTimer.clearInterval
      if (intervalIdRef.current) {
        BackgroundTimer.clearInterval(intervalIdRef.current);
        intervalIdRef.current = null; // ✅ เคลียร์ ref ด้วย
      }
      // ✅ 3. เปลี่ยนมาใช้ BackgroundTimer.clearTimeout
      if (initialSyncTimeoutRef.current) {
        BackgroundTimer.clearTimeout(initialSyncTimeoutRef.current);
        initialSyncTimeoutRef.current = null; // ✅ เคลียร์ ref ด้วย
      }

      console.log("Setting up background timers...");

      // ✅ 4. เปลี่ยนมาใช้ BackgroundTimer.setTimeout
      initialSyncTimeoutRef.current = BackgroundTimer.setTimeout(() => {
        console.log("BackgroundTimer: Initial sync triggered.");
        syncCheckInsToServer(); // เรียก sync ครั้งแรก

        // ✅ 5. เปลี่ยนมาใช้ BackgroundTimer.setInterval
        //    (หลังจากที่ timeout ทำงานแล้ว)
        intervalIdRef.current = BackgroundTimer.setInterval(
          syncCheckInsToServer,
          SYNC_INTERVAL
        );
      }, 10000); // ดีเลย์ 10 วินาทีเหมือนเดิม
    };

    if (activeProject) {
      setupInterval();
    } else {
      // ถ้าไม่มี activeProject ก็เคลียร์ timer ทิ้ง
      if (intervalIdRef.current) BackgroundTimer.clearInterval(intervalIdRef.current);
      if (initialSyncTimeoutRef.current) BackgroundTimer.clearTimeout(initialSyncTimeoutRef.current);
    }

    // ✅ 6. Cleanup function (สำคัญมาก!)
    return () => {
      console.log("BackgroundTimer: Cleaning up timers on unmount.");
      if (initialSyncTimeoutRef.current) {
        BackgroundTimer.clearTimeout(initialSyncTimeoutRef.current);
      }
      if (intervalIdRef.current) {
        BackgroundTimer.clearInterval(intervalIdRef.current);
      }
    };
  }, [activeProject, syncCheckInsToServer]);

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