import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, SectionList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
// import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons'; // Import ไอคอน
import axios from 'axios';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import * as Updates from 'expo-updates';
import { clearRegistersTable, clearSession, deleteSetting, getActiveSession, getCheckInsCountForId, getCurrentProject, getPendingSyncCheckInsCountForId, getRegistersCountForId, getSetting, getSuccessCheckInsCountForId, getSyncErrorCheckInsCountForId, getUnsyncedCheckInsCountForId, insertErrorLog, saveProjects, saveSetting } from '../../constants/Database'; // <-- ปรับ path ให้ถูกต้อง
import { useEnvironment } from '../../contexts/EnvironmentContext';
import { useMode } from '../../contexts/ModeContext';
import { exportDatabaseFile } from '../../utils/exportUtils';


const sections = [
  {
    title: '',
    data: [
      { id: 'refresh', title: 'อัพเดทข้อมูลกิจกรรม', icon: 'refresh' },
      { id: 'export', title: 'Export Database', icon: 'share-social' },
      { id: 'machineCode', title: 'รหัสเครื่อง', icon: 'code' },
      { id: 'mode', title: 'โหมด', icon: 'invert-mode' },
      { id: 'environment', title: 'Environment', icon: 'server' },
    ],
  },
  {
    title: 'ข้อมูลแอป',
    data: [
      { id: 'version', title: 'เวอร์ชัน', icon: 'information-circle' },
    ],
  },
];


export default function SettingsScreen() {

  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(true);
  const [machineCode, setMachineCode] = useState(null);
  const router = useRouter();
  const [isModalVisible, setModalVisible] = useState(false);
  const [masterCodeInput, setMasterCodeInput] = useState('');
  const [machineCodeInput, setMachineCodeInput] = useState('');
  const [isModeModalVisible, setModeModalVisible] = useState(false);
  const [modeMasterCodeInput, setModeMasterCodeInput] = useState('');
  const { isModeOne, toggleMode } = useMode();
  const [lprToken, setLprToken] = useState('');
  const [first_name, setFirst_name] = useState('');
  const [last_name, setLast_name] = useState('');
  const [isEnvModalVisible, setEnvModalVisible] = useState(false);
  const [envMasterCodeInput, setEnvMasterCodeInput] = useState('');
  const [registersCount, setRegistersCount] = useState(0);
  const [checkInsCount, setCheckInsCount] = useState(0);
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [pendingSyncCount, setPendingSyncCount] = useState(0); // ยังไม่ได้ส่ง (sync_status 0,3)
  const [syncErrorCount, setSyncErrorCount] = useState(0); // พบปัญหา (sync_status 4)
  const [successCount, setSuccessCount] = useState(0); // สำเร็จ (sync_status 2)
  const [currentId, setCurrentId] = useState(null); // project_id or activity_id depending on mode

  // Clear Registers Modal States
  const [isClearRegistersModalVisible, setClearRegistersModalVisible] = useState(false);
  const [clearRegistersCodeInput, setClearRegistersCodeInput] = useState('');
  const { environment, updateEnvironment, isLoading: isEnvLoading } = useEnvironment();

  // Export Modal States
  const [isExportModalVisible, setExportModalVisible] = useState(false);
  const [exportStartDate, setExportStartDate] = useState('');
  const [exportEndDate, setExportEndDate] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  // Version Info States
  const [isVersionModalVisible, setVersionModalVisible] = useState(false);
  const appVersion = Constants.expoConfig?.version || '1.0.0';
  const runtimeVersion = Constants.expoConfig?.runtimeVersion || '-';
  const updateId = Updates.updateId || null;
  const updateChannel = Updates.channel || '-';
  const updateCreatedAt = Updates.createdAt || null;

  // สร้าง OTA Version จากวันที่ update (เช่น 2025.12.06.1713)
  const getOtaVersion = () => {
    if (updateCreatedAt) {
      const d = new Date(updateCreatedAt);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const mins = String(d.getMinutes()).padStart(2, '0');
      return `${year}.${month}.${day}.${hours}${mins}`;
    }
    return null;
  };
  const otaVersion = getOtaVersion();

  // useEffect จะทำงานแค่ครั้งเดียวตอนหน้านี้ถูกโหลดขึ้นมา
  useEffect(() => {
    const fetchDataFromDB = async () => {
      try {

        // ดึงข้อมูล session ผู้ใช้
        const session = await getActiveSession();
        if (session && session.username) {
          setUsername(session.username);
          setFirst_name(session.first_name);
          setLast_name(session.last_name);
        }
        if (session && session.lpr_token) {
          setLprToken(session.lpr_token);
        }

        // ดึงรหัสเครื่อง
        const storedMachineCode = await getSetting('machineCode');
        if (storedMachineCode !== null) {
          setMachineCode(storedMachineCode);
        }

        // ดึง current project (ใช้เพื่อหาค่า project_id/activity_id)
        const currentProject = await getCurrentProject();
        let idForFilter = null;
        if (currentProject) {
          // default use project_id
          idForFilter = currentProject.project_id;
          const appMode = await getSetting('appMode');

          // app mode is false to dharmmakaya mode
          // app mode is true to general mode
          if (appMode == "false") {
            idForFilter = currentProject.activity_id;
          }
        }
        setCurrentId(idForFilter);

        // ดึงจำนวน Registers (filtered) และ CheckIns (filtered)
        const regCount = await getRegistersCountForId(idForFilter);
        setRegistersCount(regCount);
        // For checkins we pass single id computed based on appMode
        const chkCount = await getCheckInsCountForId(idForFilter);
        setCheckInsCount(chkCount);
        const unsync = await getUnsyncedCheckInsCountForId(idForFilter);
        setUnsyncedCount(unsync);
        // ✅ เพิ่มการดึงข้อมูลใหม่
        const pending = await getPendingSyncCheckInsCountForId(idForFilter);
        setPendingSyncCount(pending);
        const errors = await getSyncErrorCheckInsCountForId(idForFilter);
        setSyncErrorCount(errors);
        const success = await getSuccessCheckInsCountForId(idForFilter);
        setSuccessCount(success);
      } catch (e) {
        console.error("Failed to fetch data from database", e);

        // Log error to database
        try {
          const session = await getActiveSession();
          await insertErrorLog({
            comp_id: null,
            error_type: 'DATABASE_ERROR',
            error_message: e.message || 'Failed to fetch data from database',
            error_code: e.code || 'FETCH_DATA_ERROR',
            page_name: 'settings.js',
            action_name: 'fetchDataFromDB',
            user_id: session?.user_id || null
          });
        } catch (logError) {
          console.error('Failed to log error:', logError);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchDataFromDB();
  }, []); // [] หมายถึงให้ทำงานแค่ครั้งเดียว

  // Refresh counts separately so we can call when mode changes
  const refreshCounts = async (idForFilter = currentId) => {
    try {
      const regCount = await getRegistersCountForId(idForFilter);
      setRegistersCount(regCount);
      const chkCount = await getCheckInsCountForId(idForFilter);
      setCheckInsCount(chkCount);
      const unsync = await getUnsyncedCheckInsCountForId(idForFilter);
      setUnsyncedCount(unsync);
      // ✅ เพิ่มการดึงข้อมูลใหม่
      const pending = await getPendingSyncCheckInsCountForId(idForFilter);
      setPendingSyncCount(pending);
      const errors = await getSyncErrorCheckInsCountForId(idForFilter);
      setSyncErrorCount(errors);
      const success = await getSuccessCheckInsCountForId(idForFilter);
      setSuccessCount(success);
    } catch (e) {
      console.error("Failed to refresh counts", e);

      // Log error to database
      try {
        const session = await getActiveSession();
        await insertErrorLog({
          comp_id: null,
          error_type: 'DATABASE_ERROR',
          error_message: e.message || 'Failed to refresh counts',
          error_code: e.code || 'REFRESH_COUNTS_ERROR',
          page_name: 'settings.js',
          action_name: 'refreshCounts',
          user_id: session?.user_id || null
        });
      } catch (logError) {
        console.error('Failed to log error:', logError);
      }
    }
  };

  // Refresh when mode changes
  useEffect(() => {
    (async () => {
      // recompute currentId based on current project and mode
      try {
        const currentProject = await getCurrentProject();
        let idForFilter = null;
        if (currentProject) {
          idForFilter = currentProject.project_id;
          const appMode = await getSetting('appMode');
          const isModeOneLocal = appMode === null ? true : appMode === 'true';
          if (!isModeOneLocal) {
            idForFilter = currentProject.activity_id;
          }
        }
        setCurrentId(idForFilter);
        await refreshCounts(idForFilter);
      } catch (e) {
        console.error('Error updating counts after mode change', e);
      }
    })();
  }, [isModeOne]);

  const API_BASE_URL = environment === 'prod'
    ? 'https://mbus.dhammakaya.network/api' // <-- ❗️ URL ของ Prod
    : 'https://mbus-test.dhammakaya.network/api'; // <-- URL ของ Test

  const handleLogout = async () => {
    Alert.alert(
      "ยืนยันการออกจากระบบ", // Title ของ Alert
      "คุณแน่ใจหรือไม่ว่าต้องการออกจากระบบ?", // Message ของ Alert
      [
        {
          text: "ยกเลิก", // ปุ่มยกเลิก
          onPress: () => console.log("Logout cancelled"),
          style: "cancel" // สไตล์ของปุ่มยกเลิก (มักจะเป็นสีเทา)
        },
        {
          text: "ออกจากระบบ", // ปุ่มยืนยัน
          onPress: async () => { // เมื่อกดปุ่มยืนยัน ให้รัน Logic การ Logout จริงๆ
            try {
              setLoading(true);
              console.log('lprToken :>> ', lprToken);

              await clearSession();
              await deleteSetting('saved_printer');

              // ไม่ต้อง await router.replace ตรงนี้ เพราะมี call ไป API อีก
              // เราจะเปลี่ยนหน้าหลังจาก API call สำเร็จ
              router.replace('/login'); // ย้ายไปหน้า Login ทันที

              // ดักจับ error จาก fetch API call
              const result = await axios.post(`${API_BASE_URL}/lpr/logout`, {
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${lprToken}`,
                },
              });
              const data = await result.data;

              // ตรวจสอบความสำเร็จจาก status หรือ result
              if (data.status !== 'success' && !data.result) {
                console.log('Server responded with an error during logout:', result.status);
                console.log('❌ Error details during logout:', data);
                // แสดง Alert เฉพาะถ้า API มีปัญหา แต่ผู้ใช้ได้ออกจากระบบ local แล้ว
                Alert.alert('ข้อผิดพลาด', 'ออกจากระบบในเครื่องแล้ว แต่มีปัญหาในการเชื่อมต่อเซิร์ฟเวอร์');
              } else {
                console.log("Logout from API successful.");
              }

              setLoading(false);
            } catch (e) {
              console.log("Failed to perform full logout process:", e);

              // Log error to database
              try {
                const session = await getActiveSession();
                await insertErrorLog({
                  comp_id: null,
                  error_type: 'API_ERROR',
                  error_message: e.message || 'Failed to perform full logout process',
                  error_code: e.response?.status || e.code || 'LOGOUT_ERROR',
                  page_name: 'settings.js',
                  action_name: 'handleLogout',
                  user_id: session?.user_id || null
                });
              } catch (logError) {
                console.error('Failed to log error:', logError);
              }

              // Alert.alert('ข้อผิดพลาด', 'เกิดข้อผิดพลาดในการออกจากระบบ');
              setLoading(false);
            }
          },
          style: "destructive" // สไตล์ของปุ่มยืนยัน (มักจะเป็นสีแดง)
        }
      ],
      { cancelable: false } // ป้องกันไม่ให้ผู้ใช้ปิด Alert โดยการแตะด้านนอก
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0000ff" />
        <Text style={styles.loadingText}>กำลังโหลดข้อมูล...</Text>
      </View>
    );
  }

  const handleConfirmModeChange = () => {
    if (modeMasterCodeInput !== '8989') {
      Alert.alert("ผิดพลาด", "รหัสอนุมัติไม่ถูกต้อง.");
      return;
    }
    // ถ้าถูกต้อง ให้สลับโหมด
    toggleMode();
    Alert.alert("สำเร็จ", "เปลี่ยนโหมดเรียบร้อยแล้ว!");
    // ปิด Modal และเคลียร์ค่า
    setModeModalVisible(false);
    setModeMasterCodeInput('');
  };

  const getProject = async () => {
    setLoading(true);
    const result = await axios.get(`${API_BASE_URL}/lpr/projects`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lprToken}`, // ถ้าต้องใช้ token
      },
    });

    try {
      if (result.status !== 200) {
        Alert.alert('ข้อผิดพลาด', 'ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่อีกครั้ง');
        setLoading(false);
        return;
      }
      const data = await result.data;
      console.log('data :>> ', data);
      await saveProjects(data.result);
      Alert.alert('สำเร็จ', 'อัพเดทข้อมูลเรียบร้อย');
      setLoading(false);

    } catch (error) {
      // Log error to database
      try {
        const session = await getActiveSession();
        await insertErrorLog({
          comp_id: null,
          error_type: 'API_ERROR',
          error_message: error.message || 'ไม่สามารถโหลดข้อมูลได้',
          error_code: error.response?.status || error.code || 'GET_PROJECT_ERROR',
          page_name: 'settings.js',
          action_name: 'getProject',
          user_id: session?.user_id || null
        });
      } catch (logError) {
        console.error('Failed to log error:', logError);
      }

      Alert.alert('ข้อผิดพลาด', 'ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่อีกครั้ง');
      setLoading(false);
    } finally {
      setLoading(false);
    }


  }





  const handleClearRegisters = async () => {
    if (clearRegistersCodeInput !== '8989') {
      Alert.alert("ผิดพลาด", "รหัสอนุมัติไม่ถูกต้อง.");
      return;
    }

    try {
      await clearRegistersTable();
      Alert.alert("สำเร็จ", "ลบข้อมูล Registers ทั้งหมดเรียบร้อยแล้ว!");
      setClearRegistersModalVisible(false);
      setClearRegistersCodeInput('');
    } catch (e) {
      console.error("Failed to clear registers:", e);

      // Log error to database
      try {
        const session = await getActiveSession();
        await insertErrorLog({
          comp_id: null,
          error_type: 'DATABASE_ERROR',
          error_message: e.message || 'Failed to clear registers',
          error_code: e.code || 'CLEAR_REGISTERS_ERROR',
          page_name: 'settings.js',
          action_name: 'handleClearRegisters',
          user_id: session?.user_id || null
        });
      } catch (logError) {
        console.error('Failed to log error:', logError);
      }

      Alert.alert("ผิดพลาด", "ไม่สามารถลบข้อมูลได้.");
    }
  };

  const renderClearRegistersModal = () => (
    <Modal
      animationType="fade"
      transparent={true}
      visible={isClearRegistersModalVisible}
      onRequestClose={() => setClearRegistersModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>⚠️ ลบข้อมูล Registers</Text>
          <Text style={styles.modalSubTitle}>
            การกระทำนี้จะลบข้อมูลทะเบียนรถทั้งหมดในเครื่อง
            กรุณากรอกรหัสเพื่อยืนยัน
          </Text>
          <TextInput
            style={styles.modalInput}
            placeholder="กรอกรหัสอนุมัติ"
            value={clearRegistersCodeInput}
            onChangeText={setClearRegistersCodeInput}
            secureTextEntry={true}
            keyboardType="number-pad"
          />
          <View style={styles.modalButtonContainer}>
            <TouchableOpacity
              style={[styles.modalButton, styles.cancelButton]}
              onPress={() => setClearRegistersModalVisible(false)}
            >
              <Text style={styles.modalButtonText}>ยกเลิก</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalButton, styles.saveButton, { backgroundColor: '#D32F2F' }]}
              onPress={handleClearRegisters}
            >
              <Text style={styles.modalButtonText}>ลบข้อมูล</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  // --- Render Functions สำหรับ SectionList ---
  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.itemContainer}
      onLongPress={() => {
        if (item.id === 'version') {
          setClearRegistersCodeInput('');
          setClearRegistersModalVisible(true);
        }
      }}
      // --- เปลี่ยน onPress ให้เปิด Modal ---
      onPress={() => {
        if (item.id === 'machineCode') {
          setMachineCodeInput(machineCode || '');
          setMasterCodeInput('');
          setModalVisible(true);
        } else if (item.id === 'mode') {
          // เมื่อกดที่เมนูโหมด ให้เปิด Modal เพื่อกรอกรหัส
          setModeMasterCodeInput(''); // เคลียร์รหัสเก่าทุกครั้งที่เปิด
          setModeModalVisible(true);
        } else if (item.id === 'environment') {
          setEnvMasterCodeInput(''); // เคลียร์รหัส
          setEnvModalVisible(true); // เปิด Modal ใหม่
        } else if (item.id === 'refresh') {
          getProject()
        } else if (item.id === 'export') {
          // เปิด Modal เลือกวันที่ก่อน Export
          setExportModalVisible(true);
        } else if (item.id === 'version') {
          setVersionModalVisible(true);
        }
        else {
          <Ionicons name={item.icon} size={20} color="#555" style={styles.itemIcon} />
          Alert.alert('Navigate', `Go to ${item.title} screen`);
        }
      }}
    >
      {/* ... ส่วนแสดง icon และ text เหมือนเดิม ... */}
      <Ionicons name={item.icon} size={20} color="#555" style={styles.itemIcon} />
      <Text style={styles.itemText}>{item.title}</Text>

      {item.id === 'machineCode' && (
        <Text style={styles.itemValueText}>
          {machineCode || 'Not Set'}
        </Text>
      )}
      {item.id == 'mode' && (
        <Text style={styles.itemValueText}>
          {isModeOne ? 'งานบุญ' : 'ธรรมยาตรา'}
        </Text>
      )}
      {item.id == 'environment' && (
        <Text style={[styles.itemValueText, environment === 'prod' ? styles.envProdText : styles.envTestText]}>
          {environment === 'prod' ? 'Prod' : 'Test'}
        </Text>
      )}
      {item.id === 'version' && (
        <Text style={styles.itemValueText}>
          {otaVersion || appVersion}
        </Text>
      )}

      <Ionicons name="chevron-forward" size={20} color="#aaa" />
    </TouchableOpacity>
  );

  const renderSectionHeader = ({ section: { title } }) => (
    <Text style={styles.sectionHeader}>{title.toUpperCase()}</Text>
  );

  const handleConfirmEnvChange = async () => {
    if (envMasterCodeInput !== '8989') {
      Alert.alert("ผิดพลาด", "รหัสอนุมัติไม่ถูกต้อง.");
      return;
    }

    try {
      // สลับค่า 'prod' -> 'test' หรือ 'test' -> 'prod'
      const newEnv = environment === 'prod' ? 'test' : 'prod';
      await updateEnvironment(newEnv);

      Alert.alert("สำเร็จ", `เปลี่ยน Environment เป็น ${newEnv.toUpperCase()} เรียบร้อยแล้ว!`);

      // ปิด Modal และเคลียร์ค่า
      setEnvModalVisible(false);
      setEnvMasterCodeInput('');
    } catch (e) {
      console.error("Failed to save environment setting:", e);
      Alert.alert("ผิดพลาด", "ไม่สามารถบันทึก Environment ได้.");
    }
  };



  // --- ฟังก์ชันสำหรับจัดการการบันทึกรหัสจาก Modal ---
  const handleSaveCode = async () => {
    if (masterCodeInput !== '8989') {
      Alert.alert("ผิดพลาด", "รหัสอนุมัติไม่ถูกต้อง.");
      return;
    }

    try {
      await saveSetting('machineCode', machineCodeInput);
      setMachineCode(machineCodeInput); // อัปเดต UI
      Alert.alert("สำเร็จ", "รหัสเครื่องเปลี่ยนเรียบร้อยแล้ว!");

      // ปิด Modal และเคลียร์ค่า input
      setModalVisible(false);
      setMasterCodeInput('');
      setMachineCodeInput('');
    } catch (e) {
      Alert.alert("ผิดพลาด", "ไม่สามารถบันทึกรหัสเครื่องได้.");
    }
  };

  // --- ฟังก์ชันสำหรับสร้าง Modal ---
  const renderMachineCodeModal = () => (
    <Modal
      animationType="fade"
      transparent={true}
      visible={isModalVisible}
      onRequestClose={() => setModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>ตั้งรหัสเครื่อง</Text>
          <TextInput
            style={styles.modalInput}
            placeholder="กรอกรหัสเครื่อง"
            value={machineCodeInput}
            onChangeText={setMachineCodeInput}

            keyboardType="number-pad"
          />
          <TextInput
            style={styles.modalInput}
            placeholder="กรอกรหัสอนุมัติ"
            value={masterCodeInput}
            secureTextEntry={true}
            onChangeText={setMasterCodeInput}
            keyboardType="number-pad"
          />



          <View style={styles.modalButtonContainer}>
            <TouchableOpacity
              style={[styles.modalButton, styles.cancelButton]}
              onPress={() => setModalVisible(false)}
            >
              <Text style={styles.modalButtonText}>ยกเลิก</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalButton, styles.saveButton]}
              onPress={handleSaveCode}
            >
              <Text style={styles.modalButtonText}>บันทึก</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  const renderModeChangeModal = () => (
    <Modal
      animationType="fade"
      transparent={true}
      visible={isModeModalVisible}
      onRequestClose={() => setModeModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>ยืนยันการเปลี่ยนโหมด</Text>
          <TextInput
            style={styles.modalInput}
            placeholder="กรอกรหัสอนุมัติ"
            value={modeMasterCodeInput}
            onChangeText={setModeMasterCodeInput}
            secureTextEntry={true}
            keyboardType="number-pad"
          />
          <View style={styles.modalButtonContainer}>
            <TouchableOpacity
              style={[styles.modalButton, styles.cancelButton]}
              onPress={() => setModeModalVisible(false)}
            >
              <Text style={styles.modalButtonText}>ยกเลิก</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalButton, styles.saveButton]}
              onPress={handleConfirmModeChange}
            >
              <Text style={styles.modalButtonText}>ยืนยัน</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  const renderEnvironmentModal = () => (
    <Modal
      animationType="fade"
      transparent={true}
      visible={isEnvModalVisible}
      onRequestClose={() => setEnvModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>ยืนยันการเปลี่ยน Environment</Text>
          <Text style={styles.modalSubTitle}>
            {/* แสดงสถานะปัจจุบัน */}
            Current: {environment === 'prod' ? 'Prod' : 'Test'}
          </Text>
          <TextInput
            style={styles.modalInput}
            placeholder="กรอกรหัสอนุมัติ"
            value={envMasterCodeInput}
            onChangeText={setEnvMasterCodeInput}
            secureTextEntry={true}
            keyboardType="number-pad"
          />
          <View style={styles.modalButtonContainer}>
            <TouchableOpacity
              style={[styles.modalButton, styles.cancelButton]}
              onPress={() => setEnvModalVisible(false)}
            >
              <Text style={styles.modalButtonText}>ยกเลิก</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalButton, styles.saveButton]}
              onPress={handleConfirmEnvChange} // เรียกใช้ฟังก์ชันที่สร้างใหม่
            >
              <Text style={styles.modalButtonText}>ยืนยัน</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  // ฟังก์ชันจัดการ Export
  const handleExport = async () => {
    setIsExporting(true);
    try {
      await exportDatabaseFile();
      setExportModalVisible(false);
    } catch (error) {
      console.error('Export error:', error);
      Alert.alert('ผิดพลาด', 'ไม่สามารถ Export ข้อมูลได้');
    } finally {
      setIsExporting(false);
    }
  };

  // Modal สำหรับเลือกวันที่ Export
  const renderExportModal = () => (
    <Modal
      animationType="fade"
      transparent={true}
      visible={isExportModalVisible}
      onRequestClose={() => setExportModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>📦 Export Database</Text>
          <Text style={styles.modalSubTitle}>ต้องการ Export ฐานข้อมูลทั้งหมดใช่หรือไม่?</Text>

          {/* ปุ่ม Export ทั้งหมด */}
          <TouchableOpacity
            style={[styles.exportOptionButton, styles.exportAllButton]}
            onPress={handleExport}
            disabled={isExporting}
          >
            <Ionicons name="cloud-download" size={20} color="#fff" />
            <Text style={styles.exportOptionText}>ยืนยัน Export</Text>
          </TouchableOpacity>

          {isExporting && (
            <View style={styles.exportingContainer}>
              <ActivityIndicator size="small" color="#007AFF" />
              <Text style={styles.exportingText}>กำลัง Export...</Text>
            </View>
          )}

          {/* ปุ่มยกเลิก */}
          <TouchableOpacity
            style={styles.exportCancelButton}
            onPress={() => setExportModalVisible(false)}
            disabled={isExporting}
          >
            <Text style={styles.exportCancelText}>ยกเลิก</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  // Modal สำหรับแสดง Version Info
  const renderVersionModal = () => (
    <Modal
      animationType="fade"
      transparent={true}
      visible={isVersionModalVisible}
      onRequestClose={() => setVersionModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>📱 ข้อมูลเวอร์ชัน</Text>

          <View style={styles.versionInfoContainer}>
            {otaVersion && (
              <View style={[styles.versionRow, { backgroundColor: '#e8f5e9' }]}>
                <Text style={[styles.versionLabel, { color: '#2e7d32' }]}>📦 OTA Version:</Text>
                <Text style={[styles.versionValue, { color: '#2e7d32' }]}>{otaVersion}</Text>
              </View>
            )}

            <View style={styles.versionRow}>
              <Text style={styles.versionLabel}>App Version:</Text>
              <Text style={styles.versionValue}>{appVersion}</Text>
            </View>

            <View style={styles.versionRow}>
              <Text style={styles.versionLabel}>Runtime Version:</Text>
              <Text style={styles.versionValue}>{runtimeVersion}</Text>
            </View>

            <View style={styles.versionRow}>
              <Text style={styles.versionLabel}>Update Channel:</Text>
              <Text style={styles.versionValue}>{updateChannel}</Text>
            </View>

            <View style={styles.versionRow}>
              <Text style={styles.versionLabel}>Update ID:</Text>
              <Text style={[styles.versionValue, styles.updateIdText]} numberOfLines={1}>
                {updateId ? updateId.substring(0, 16) + '...' : 'ไม่มี OTA Update'}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={[{ marginTop: 10 }]}
            onPress={() => setVersionModalVisible(false)}
          >
            <Text >ปิด</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  return (
    <View style={styles.container}>
      <View style={styles.tabMobile}>
      </View>
      {renderMachineCodeModal()}
      {renderModeChangeModal()}
      {renderEnvironmentModal()}
      {renderExportModal()}
      {renderVersionModal()}
      {renderClearRegistersModal()}
      <View style={styles.profileHeader}>
        <View style={styles.profileContent}>
          {/* Avatar */}
          <View style={[styles.avatarTextContainer, { backgroundColor: '#007AFF' }]}>
            <Text style={styles.avatarText}>{machineCode}</Text>
          </View>

          {/* Info */}
          <View style={styles.profileInfo}>
            <Text style={styles.username}>{first_name} {last_name}</Text>
            <View style={[styles.envBadge, environment === 'prod' ? styles.envProdBadge : styles.envTestBadge]}>
              <Text style={[styles.envText, environment === 'prod' ? styles.envProdText : styles.envTestText]}>
                Env: {environment === 'prod' ? 'Prod' : 'Test'}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Dashboard Section: two cards side-by-side to save vertical space */}
      <View style={styles.dashboardContainerRow}>
        <TouchableOpacity
          style={[styles.dashboardCardRow, styles.dashboardCardLeft]}
          onPress={() => refreshCounts()}
        >
          <View style={styles.dashboardIconContainerRow}>
            <Ionicons name="clipboard" size={20} color="#007AFF" />
          </View>
          <View style={styles.dashboardTextContainerRow}>
            <Text style={styles.dashboardLabel}>ใบ C7</Text>
            <Text style={styles.dashboardValue}>{registersCount}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.dashboardCardRow, styles.dashboardCardRight]}
          onPress={() => refreshCounts()}
        >
          <View style={styles.dashboardIconContainerRow}>
            <Ionicons name="checkmark-done" size={20} color="#4CAF50" />
          </View>
          <View style={styles.dashboardTextContainerRow}>
            <Text style={styles.dashboardLabel}>ส่งสำเร็จ</Text>
            <Text style={styles.dashboardValue}>{successCount}</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Dashboard Section: pending sync and errors - second row */}
      <View style={styles.dashboardContainerRow}>
        <TouchableOpacity
          style={[styles.dashboardCardRow, styles.dashboardCardLeft]}
          onPress={() => refreshCounts()}
        >
          <View style={styles.dashboardIconContainerRow}>
            <Ionicons name="cloud-upload" size={20} color="#FF9800" />
          </View>
          <View style={styles.dashboardTextContainerRow}>
            <Text style={styles.dashboardLabel}>ยังไม่ได้ส่ง</Text>
            <Text style={styles.dashboardValue}>{pendingSyncCount}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.dashboardCardRow, styles.dashboardCardRight]}
          onPress={() => refreshCounts()}
        >
          <View style={styles.dashboardIconContainerRow}>
            <Ionicons name="warning-outline" size={20} color="#F44336" />
          </View>
          <View style={styles.dashboardTextContainerRow}>
            <Text style={styles.dashboardLabel}>พบปัญหา</Text>
            <Text style={styles.dashboardValue}>{syncErrorCount}</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* --- ส่วน List การตั้งค่า --- */}
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
      />

      {/* --- ส่วนปุ่ม Logout --- */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Ionicons name="log-out" size={24} color="#D32F2F" />
        <Text style={styles.logoutButtonText}>ออกจากระบบ</Text>
      </TouchableOpacity>
    </View>
  );


}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  loadingContainer: { // ✅ เพิ่ม Style สำหรับ Loading
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
  },
  loadingText: { // ✅ เพิ่ม Style สำหรับ Loading Text
    marginTop: 10,
    fontSize: 16,
    color: '#555',
  },

  tabMobile: {
    height: 25,
    backgroundColor: 'black',
    borderBottomWidth: 1,
    // borderColor:'#e9ecef',
    justifyContent: 'center',
    alignItems: 'center'
  },
  profileHeader: {
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  profileContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  username: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },

  // SectionList
  listContent: {
    paddingTop: 0,
    paddingHorizontal: 16,

  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888',
    marginTop: 4,
    marginBottom: 8,

  },
  itemContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 2, // สร้างเส้นคั่นบางๆ
  },
  itemIcon: {
    marginRight: 16,
  },
  itemText: {
    flex: 1,
    fontSize: 16,
    color: '#333',
  },
  // Logout Button
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    margin: 16,
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FFCDD2'
  },
  logoutButtonText: {
    fontSize: 16,
    color: '#D32F2F',
    fontWeight: '600',
    marginLeft: 8,
  },
  avatarTextContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#007AFF',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  itemValueText: {
    fontSize: 16,
    color: '#888', // สีเทา
    marginRight: 8, // ระยะห่างจากลูกศร
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContainer: {
    width: '85%',
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  modalInput: {
    width: '100%',
    height: 45,
    borderColor: '#ddd',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    marginBottom: 15,
    fontSize: 16,
  },
  modalButtonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 10,
  },
  modalButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#A0A0A0',
    marginRight: 10,
  },
  saveButton: {
    backgroundColor: '#007AFF', // สีฟ้าแบบ iOS
    marginLeft: 10,
  },
  modalButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  envBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    backgroundColor: '#f0f0f0',
  },
  envProdBadge: {
    backgroundColor: '#E8F5E9',
  },
  envTestBadge: {
    backgroundColor: '#FFF3E0',
  },
  envText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#555',
  },
  envProdText: {
    color: '#2e7d32',
  },
  envTestText: {
    color: '#F57C00',
  },
  modalSubTitle: {
    fontSize: 16,
    color: '#555',
    marginBottom: 20,
    textAlign: 'center'
  },
  // Export Modal Styles
  exportOptionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 10,
    marginBottom: 10,
    width: '100%',
  },
  exportAllButton: {
    backgroundColor: '#34C759', // สีเขียว
  },
  exportTodayButton: {
    backgroundColor: '#007AFF', // สีฟ้า
  },
  exportCustomButton: {
    backgroundColor: '#5856D6', // สีม่วง
  },
  exportOptionText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
    marginLeft: 10,
  },
  dateInputContainer: {
    width: '100%',
    marginBottom: 10,
  },
  dateLabel: {
    fontSize: 14,
    color: '#555',
    marginBottom: 5,
  },
  dateInput: {
    width: '100%',
    height: 45,
    borderColor: '#ddd',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
    backgroundColor: '#f9f9f9',
  },
  exportingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  exportingText: {
    marginLeft: 10,
    color: '#007AFF',
    fontSize: 14,
  },
  exportCancelButton: {
    marginTop: 15,
    width: '100%',
    padding: 14,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#FF3B30',
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  exportCancelText: {
    color: '#FF3B30',
    fontWeight: 'bold',
    fontSize: 16,
  },
  // Version Modal Styles
  versionInfoContainer: {
    width: '100%',
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    padding: 15,
  },
  versionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  versionLabel: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  versionValue: {
    fontSize: 14,
    color: '#333',
    fontWeight: 'bold',
  },
  updateIdText: {
    fontSize: 12,
    maxWidth: 150,
  },
  // Dashboard Styles
  dashboardContainer: {
    padding: 16,
    paddingBottom: 0,
  },
  dashboardContainerRow: {
    paddingHorizontal: 16,
    paddingVertical: 5,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
  },
  dashboardCardRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  dashboardCardLeft: {
    marginRight: 8,
  },
  dashboardCardRight: {
    marginLeft: 8,
  },
  dashboardIconContainerRow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E3F2FD',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  dashboardTextContainerRow: {
    flex: 1,
  },
  dashboardCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  dashboardIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E3F2FD',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  dashboardTextContainer: {
    flex: 1,
  },
  dashboardLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  dashboardValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
});
