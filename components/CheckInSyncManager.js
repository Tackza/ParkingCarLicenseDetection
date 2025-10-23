// `components/CheckInSyncManager.js`
import React, { useEffect, useCallback, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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

const SYNC_INTERVAL = 60000; // 1 นาที

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


  const syncCheckInsToServer = useCallback(async () => {
    if (isCheckInSyncing) {
      console.log("Check-in Sync skipped: Already syncing check-ins.");
      return;
    }
    if (!activeProject) {
      console.log("Check-in Sync skipped: No active project.");
      return;
    }

    setIsCheckInSyncing(true);
    setSyncError(null); // เคลียร์ error เก่า
    setUploadedCount(0); // ✅ รีเซ็ตเคาน์เตอร์
    setTotalToUpload(0); // ✅ รีเซ็ตเคาน์เตอร์
    console.log("Starting check-ins sync for project:", activeProject?.project_id);

    try {
      const session = await getActiveSession();
      if (!session?.lpr_token) throw new Error("No LprToken found.");

      const unsyncedCheckIns = await getUnsyncedCheckIns();
      if (unsyncedCheckIns.length === 0) {
        console.log("No unsynced check-ins to upload.");
        setLastCheckInSyncTime(new Date()); // อัปเดตเวลาแม้จะไม่มีข้อมูลให้ Sync
        setIsCheckInSyncing(false); // ✅ ต้องปิดสถานะ Sync ตรงนี้
        return;
      }

      setTotalToUpload(unsyncedCheckIns.length); // ✅ ตั้งค่าจำนวนทั้งหมด
      console.log(`Preparing to upload ${unsyncedCheckIns.length} unsynced check-ins to server, one by one.`);

      const apiUrl = "https://mbus-test.dhammakaya.network/api/lpr/registers/checkin"; // <-- ✅ เปลี่ยน API Endpoint สำหรับส่งทีละรายการ

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
            console.warn(`Attached original photo_file (failed to process): ${filename}`);
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
            throw new Error(`Server response for uid ${checkIn.uid} not ok, status: ${response.status}, message: ${errorText}`);
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
            console.log(`Server reported an error for check-in uid ${checkIn.uid}:`, errorMessage);
            setSyncError(`บางรายการมีปัญหา: ${errorMessage.substring(0, 50)}...`); // แสดง error สั้นๆ
            // ไม่ต้อง throw error ออกไปทั้งหมด เพื่อให้รายการอื่นยังคง Sync ต่อไปได้
          }
        } catch (itemError) {
          console.log(`Failed to upload check-in uid ${checkIn.uid}:`, itemError.message);
          console.log('itemError message :>> ', itemError.message);
          setSyncError(`บางรายการมีปัญหา: ${itemError.message.substring(0, 50)}...`);
          markCheckInAsSyncedError(checkIn.id, itemError.message);
          setIsOnline(false); // ถ้ามี Error ก็ตั้งเป็น Offline
          // ไม่ต้อง throw error ออกไปทั้งหมด
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
      setIsCheckInSyncing(false);
    }
  }, [activeProject, isCheckInSyncing, setIsOnline]);


  useEffect(() => {
    const setupInterval = () => {
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
      }
      if (initialSyncTimeoutRef.current) {
        clearTimeout(initialSyncTimeoutRef.current);
      }

      initialSyncTimeoutRef.current = setTimeout(() => {
        syncCheckInsToServer();
        intervalIdRef.current = setInterval(syncCheckInsToServer, SYNC_INTERVAL);
      }, 30000);
    };

    if (activeProject) {
      setupInterval();
    } else {
      if (intervalIdRef.current) clearInterval(intervalIdRef.current);
      if (initialSyncTimeoutRef.current) clearTimeout(initialSyncTimeoutRef.current);
    }

    return () => {
      if (initialSyncTimeoutRef.current) {
        clearTimeout(initialSyncTimeoutRef.current);
      }
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
      }
    };
  }, [activeProject, syncCheckInsToServer]);


  // Component นี้จะแสดงสถานะการ Sync ของ Check-ins
  // คุณสามารถปรับปรุง UI ตรงนี้ได้ตามต้องการ
  return (
    <></>
    // <View style={styles.container}>
    //   {isCheckInSyncing ? (
    //     <View style={styles.syncStatus}>
    //       <ActivityIndicator size="small" color="#27ae60" />
    //       <Text style={styles.syncText}>
    //         กำลังอัปโหลด Check-ins ({uploadedCount}/{totalToUpload})...
    //       </Text>
    //     </View>
    //   ) : (
    //     <View style={styles.syncStatus}>
    //       <Ionicons name={syncError ? "warning" : "cloud-done"} size={16} color={syncError ? "#e74c3c" : "#27ae60"} />
    //       <Text style={[styles.syncText, syncError && { color: '#e74c3c' }]}>
    //         {syncError ? `${syncError.substring(0, 30)}...` :
    //           `Check-in Sync: ${lastCheckInSyncTime ? lastCheckInSyncTime.toLocaleTimeString('th-TH') : 'ไม่เคย Sync'}`}
    //       </Text>
    //     </View>
    //   )}
    // </View>
  );
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