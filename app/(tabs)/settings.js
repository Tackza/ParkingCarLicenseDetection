import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, ScrollView, SectionList, Text, TextInput, TouchableOpacity, View } from 'react-native';
// import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons'; // Import ไอคอน
import axios from 'axios';
import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Updates from 'expo-updates';
import { backfillCheckInCompId, clearProjectsTable, clearRegistersTable, clearSession, getActiveSession, getCheckInsCountForId, getCurrentProject, getNextUpcomingProject, getPendingSyncCheckInsCountForId, getRegistersCountForId, getScopeId, getSetting, getSuccessCheckInsCountForId, getSyncErrorCheckInsCountForId, getTotalUnsyncedCheckInsCount, getUnscannedRegisters, getUnsyncedCheckInsCountForId, insertErrorLog, saveProjects, saveSetting } from '../../constants/Database'; // <-- ปรับ path ให้ถูกต้อง
import { useAuth } from '../../contexts/AuthContext';
import { useEnvironment } from '../../contexts/EnvironmentContext';
import { useMode } from '../../contexts/ModeContext';
import { exportDatabaseFile } from '../../utils/exportUtils';


// ✅ registers ยังไม่มีคอลัมน์เบอร์โทร (ต้องให้ backend ส่งมาก่อน — ดูแผน 1b)
//    ระหว่างนี้ดึงเบอร์จาก note / alert_message ที่ admin กรอกไว้ ซึ่ง sync ลงเครื่อง
//    อยู่แล้วทุกรอบแต่ไม่เคยถูกแสดงที่ไหนเลยในแอพ
//    พอ backend ส่งฟิลด์จริงมา ให้ใส่ reg.driver_phone เป็นตัวแรกของ candidates
const extractPhone = (text) => {
  if (!text) return null;
  // เบอร์ไทย: ขึ้นต้น 0 หรือ +66 คั่นด้วย - เว้นวรรค หรือ . ได้
  const match = String(text).match(/(?:\+66|0)[\d\-\s.]{7,12}\d/);
  if (!match) return null;
  const cleaned = match[0].replace(/[^\d+]/g, '');
  return cleaned.length >= 9 ? cleaned : null;
};

const getContactInfo = (reg) => {
  const candidates = [reg?.driver_phone, reg?.note, reg?.alert_message];
  const phone = candidates.map(extractPhone).find(Boolean) || null;
  // เก็บข้อความเต็มไว้ด้วย เพราะ note อาจมีข้อมูลอื่นที่เจ้าหน้าที่ต้องเห็น
  const raw = candidates.find(v => v && String(v).trim());
  return { phone, raw: raw ? String(raw).trim() : null };
};

// Ionicons และ ActivityIndicator รับสีเป็นค่า ไม่ใช่ className — ค่าต้องตรงกับ token ใน tailwind.config.js
const ICON_TEXT = '#16181d';     // text
const ICON_MUTED = '#5f6672';    // text-muted
const ICON_SUBTLE = '#6e7580';   // text-subtle
const ICON_FAINT = '#8f959e';    // icon-faint
const ICON_ON_FILL = '#ffffff';
const TINT_PRIMARY = '#217cba';  // primary
const DANGER_INK = '#8f2020';    // danger-ink
const SUCCESS = '#1e874b';       // success

// เส้นซ้ายของการ์ดตัวเลข — ส่งเป็น style ไม่ใช่ className
// border-l-* กับ border-* ต่างก็ตั้งสีขอบ และลำดับที่ NativeWind รวมสองตัวนี้ไม่แน่นอน
const EDGE_NEUTRAL = '#d5d9de';  // border-strong
const EDGE_SUCCESS = '#1e874b';  // success
const EDGE_WARNING = '#b56015';  // warning
const EDGE_DANGER = '#a52020';   // danger

const modeLabel = (isModeOne) => (isModeOne ? 'งานบุญ' : 'ธรรมยาตรา');

// ตัวย่อบน avatar — ชื่อไทยที่ขึ้นต้นด้วยสระหน้า (เ แ โ ใ ไ) ให้ข้ามไปเอาพยัญชนะ
// ไม่งั้น "เอกชัย" จะได้ตัวย่อเป็น "เ"
const initialOf = (name) => {
  const s = (name || '').trim();
  if (!s) return '';
  return /^[เแโใไ]/.test(s) ? s.charAt(1) : s.charAt(0);
};
const initialsOf = (first, last, username) =>
  (initialOf(first) + initialOf(last)) || (username || '').trim().slice(0, 2).toUpperCase();

// ── ชิ้นส่วนหน้าตาที่ใช้ซ้ำในหน้านี้ ──
// อยู่นอก component หลัก — ถ้านิยามข้างใน React จะเห็นเป็นคนละชนิดทุกครั้งที่ render แล้ว mount ใหม่หมด

// กล่องยืนยันกลางจอ ใช้กับทุก modal ที่ถามรหัสอนุมัติ แทน style ชุด modalOverlay/modalContainer เดิม
const Dialog = ({ visible, onClose, title, subtitle, tone, children }) => (
  <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
    <View className="flex-1 items-center justify-center bg-black/50 px-5">
      <View className="w-full max-w-[340px] rounded-[14px] bg-surface p-5">
        <Text className={`text-[17px] font-bold ${tone === 'danger' ? 'text-danger-ink' : 'text-text'}`}>{title}</Text>
        {!!subtitle && <Text className="mt-1 text-[13px] leading-[19px] text-text-muted">{subtitle}</Text>}
        <View className="mt-4 gap-3">{children}</View>
      </View>
    </View>
  </Modal>
);

// ช่องกรอกพร้อมป้าย — เดิมมีแต่ placeholder ซึ่งหายไปทันทีที่เริ่มพิมพ์ ในกล่องที่มีสองช่องจะลืมว่าช่องไหนคืออะไร
const Field = ({ label, ...inputProps }) => (
  <View className="gap-[6px]">
    {!!label && <Text className="text-[13px] font-semibold text-text-muted">{label}</Text>}
    <TextInput
      placeholderTextColor={ICON_SUBTLE}
      className="h-11 rounded-[9px] border border-border-strong bg-surface px-3 py-0 text-[16px] text-text"
      {...inputProps}
    />
  </View>
);

const DialogActions = ({ onCancel, onConfirm, confirmLabel, cancelLabel = 'ยกเลิก', tone, disabled }) => (
  <View className="mt-1 flex-row gap-[9px]">
    <TouchableOpacity
      onPress={onCancel}
      disabled={disabled}
      activeOpacity={0.7}
      className="h-11 flex-1 items-center justify-center rounded-[9px] border border-border-strong bg-surface"
    >
      <Text className="text-[15px] font-semibold text-text">{cancelLabel}</Text>
    </TouchableOpacity>
    <TouchableOpacity
      onPress={onConfirm}
      disabled={disabled}
      activeOpacity={0.8}
      className={`h-11 flex-1 items-center justify-center rounded-[9px] ${disabled ? 'bg-primary-muted' : tone === 'danger' ? 'bg-danger' : 'bg-primary'}`}
    >
      <Text className="text-[15px] font-semibold text-white">{confirmLabel}</Text>
    </TouchableOpacity>
  </View>
);

const StatCard = ({ value, label, edge, ink, onPress }) => (
  <TouchableOpacity
    onPress={onPress}
    activeOpacity={0.7}
    style={{ borderLeftWidth: 4, borderLeftColor: edge }}
    className="flex-1 rounded-[10px] border border-border bg-surface px-[11px] py-[10px]"
  >
    <Text className={`text-[24px] font-bold leading-[28px] ${ink}`}>{value}</Text>
    <Text className="mt-[2px] text-[12px] text-text-muted">{label}</Text>
  </TouchableOpacity>
);

const MenuGroup = ({ title, children }) => (
  <View className="gap-[6px]">
    <Text className="text-[11px] font-bold tracking-[1px] text-text-subtle">{title}</Text>
    <View className="overflow-hidden rounded-[10px] border border-border">{children}</View>
  </View>
);

const MenuRow = ({ icon, label, value, valueClass = 'text-text-muted', onPress, onLongPress, last }) => (
  <TouchableOpacity
    onPress={onPress}
    onLongPress={onLongPress}
    activeOpacity={0.6}
    className={`min-h-[52px] flex-row items-center gap-[10px] bg-surface px-3 py-[11px] ${last ? '' : 'border-b border-fill'}`}
  >
    <View className="w-[22px] items-center">
      <Ionicons name={icon} size={19} color={ICON_MUTED} />
    </View>
    <Text numberOfLines={1} className="flex-1 text-[15px] text-text">{label}</Text>
    {!!value && (
      <Text numberOfLines={1} className={`max-w-[150px] text-[14px] font-semibold ${valueClass}`}>{value}</Text>
    )}
    <Ionicons name="chevron-forward" size={16} color={ICON_FAINT} />
  </TouchableOpacity>
);

const InfoLine = ({ label, value }) => (
  <View className="flex-row items-baseline gap-2">
    <Text className="w-[76px] text-[13px] text-text-subtle">{label}</Text>
    <Text className="flex-1 text-[14px] text-text">{value}</Text>
  </View>
);


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
  const [currentProject, setCurrentProject] = useState(null); // Store current project info

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

  // Remaining Vehicles ("รถที่เหลือ") States
  const [isRemainingModalVisible, setRemainingModalVisible] = useState(false);
  const [remainingList, setRemainingList] = useState([]);
  const [remainingCount, setRemainingCount] = useState(0);
  const [remainingLoading, setRemainingLoading] = useState(false);
  const appVersion = Constants.expoConfig?.version || '1.0.0';
  const runtimeVersion = Constants.expoConfig?.runtimeVersion || '-';
  const updateId = Updates.updateId || null;
  const updateChannel = Updates.channel || '-';
  const updateCreatedAt = Updates.createdAt || null;
  const { user } = useAuth();

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
        const projectData = await getCurrentProject();
        setCurrentProject(projectData); // Store project data for display
        // ใช้ getScopeId เพื่อให้ตรงกับคอลัมน์ที่ฟังก์ชันนับเลือกใช้ และถอยไป project_id
        // เองเมื่อกิจกรรมนั้นไม่มี activity_id
        const idForFilter = await getScopeId(projectData);
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
          await insertErrorLog({
            comp_id: null,
            error_type: 'DATABASE_ERROR',
            error_message: e.message || 'Failed to fetch data from database',
            error_code: e.code || 'FETCH_DATA_ERROR',
            page_name: 'settings.js',
            action_name: 'fetchDataFromDB',
            user_id: user?.id || null
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
  const refreshCounts = async (idForFilter = currentId, project = currentProject) => {
    try {
      const regCount = await getRegistersCountForId(idForFilter);
      setRegistersCount(regCount);
      // ✅ ยอด "รถที่เหลือ" ขึ้นบนเมนูเลย เจ้าหน้าที่จะได้เห็นโดยไม่ต้องกดเข้าไปดู
      const remaining = await getUnscannedRegisters(idForFilter, project?.seq_no);
      setRemainingCount(remaining.length);
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
        await insertErrorLog({
          comp_id: null,
          error_type: 'DATABASE_ERROR',
          error_message: e.message || 'Failed to refresh counts',
          error_code: e.code || 'REFRESH_COUNTS_ERROR',
          page_name: 'settings.js',
          action_name: 'refreshCounts',
          user_id: user?.id || null
        });
      } catch (logError) {
        console.error('Failed to log error:', logError);
      }
    }
  };

  // ✅ อ่านตัวเลขใหม่ทุกครั้งที่กลับเข้าหน้านี้
  //    เดิมโหลดแค่ตอน mount กับตอนสลับโหมด ไปสแกนมาแล้วกลับเข้ามาจึงเห็นตัวเลขค้างของเก่า
  //    ทั้งที่หน้านี้มีไว้ดูสถานะ sync โดยเฉพาะ
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const projectData = await getCurrentProject();
          if (cancelled) return;
          setCurrentProject(projectData);
          const idForFilter = await getScopeId(projectData);
          if (cancelled) return;
          setCurrentId(idForFilter);
          await refreshCounts(idForFilter, projectData);
        } catch (e) {
          console.error('Error refreshing settings on focus', e);
        }
      })();
      return () => { cancelled = true; };
    }, [])
  );

  // Refresh when mode changes
  useEffect(() => {
    (async () => {
      // recompute currentId based on current project and mode
      try {
        const projectData = await getCurrentProject();
        setCurrentProject(projectData); // Update project data
        const idForFilter = await getScopeId(projectData);
        setCurrentId(idForFilter);
        await refreshCounts(idForFilter, projectData);
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
              // ไม่ลบ saved_printer — เครื่องพิมพ์ผูกกับ "เครื่อง" ไม่ใช่ผู้ใช้
              // ลบทิ้งแล้วคนถัดไปที่ login ต้องมาเลือกเครื่องพิมพ์ใหม่ทุกครั้ง

              // ไม่ต้อง await router.replace ตรงนี้ เพราะมี call ไป API อีก
              // เราจะเปลี่ยนหน้าหลังจาก API call สำเร็จ
              router.replace('/login'); // ย้ายไปหน้า Login ทันที

              // lprToken มาจาก state ที่โหลดตอน mount จึงยังใช้ได้แม้ clearSession() ไปแล้ว
              // แต่ถ้าโหลดตอน mount ไม่สำเร็จก็ไม่ต้องยิง ไม่งั้นส่ง "Bearer undefined" ไปเปล่าๆ
              if (!lprToken) {
                console.log('No token in state; skipping server logout.');
                setLoading(false);
                return;
              }

              // ดักจับ error จาก fetch API call
              // ✅ axios.post(url, body, config) — เดิมส่ง { headers } เป็น argument ที่ 2
              //    จึงกลายเป็น request body และไม่มี Authorization header ติดไปเลย
              //    server ระบุ session ไม่ได้ → token เดิมไม่เคยถูกเพิกถอน (แถม token หลุดไปอยู่ใน body)
              const result = await axios.post(`${API_BASE_URL}/lpr/logout`, {}, {
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${lprToken}`,
                },
                timeout: 15000,
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
                await insertErrorLog({
                  comp_id: null,
                  error_type: 'API_ERROR',
                  error_message: e.message || 'Failed to perform full logout process',
                  error_code: e.response?.status || e.code || 'LOGOUT_ERROR',
                  page_name: 'settings.js',
                  action_name: 'handleLogout',
                  user_id: user?.id || null

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

  // จัดกลุ่มตามจุดออกรถ — รถที่มาจากสถานีเดียวกันมักมาเป็นขบวนและจอดใกล้กัน
  // ถ้าตามหาคันที่หายอยู่ ให้ดูว่าคันอื่นจากสถานีเดียวกันถูกสแกนแถวไหน
  //
  // ⚠️ ต้องอยู่ "เหนือ" early return ข้างล่างเสมอ — hook ที่อยู่ใต้ if (loading) จะถูกเรียก
  //    เฉพาะตอน loading = false ทำให้จำนวน hook ไม่เท่ากันระหว่าง render แล้ว React จะ throw
  //    "rendered more hooks than during the previous render" ทันทีที่โหลดข้อมูลเสร็จ
  //    hook อื่นทั้งหมดในไฟล์นี้ก็อยู่เหนือ early return ด้วยเหตุผลเดียวกัน
  const remainingSections = useMemo(() => {
    const groups = new Map();
    for (const reg of remainingList) {
      const key = (reg.station_name || '').trim() || 'ไม่ระบุจุดออกรถ';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(reg);
    }
    return Array.from(groups, ([title, data]) => ({ title, data }));
  }, [remainingList]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-surface">
        <ActivityIndicator size="large" color={TINT_PRIMARY} />
        <Text className="text-[15px] text-text-muted">กำลังโหลดข้อมูล...</Text>
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

    // ✅ การเรียก API ต้องอยู่ใน try ด้วย เดิมอยู่นอก try ทำให้ตอนออฟไลน์/401
    //    ฟังก์ชัน reject ก่อนถึง try → finally ไม่ทำงาน → setLoading(false) ไม่ถูกเรียก
    //    หน้านี้ return spinner เมื่อ loading = true ผู้ใช้จึงค้างจนต้องปิดแอปทิ้ง
    try {
      const result = await axios.get(`${API_BASE_URL}/lpr/projects`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${lprToken}`, // ถ้าต้องใช้ token
        },
        timeout: 30000,
      });

      if (result.status !== 200) {
        Alert.alert('ข้อผิดพลาด', 'ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่อีกครั้ง');
        return;
      }
      const data = await result.data;
      console.log('data :>> ', data);

      // ✅ แยกให้ออกระหว่าง "server ไม่ส่งอะไรมา" กับ "ส่งมาแล้วแต่ยังไม่ถึงเวลา"
      //    เดิมทั้งสองกรณี (รวมถึง response ผิดรูป) ขึ้น "สำเร็จ" เหมือนกันหมด
      //    เลยแยกไม่ออกว่าทำไมกดอัพเดทแล้วยังไม่มีข้อมูล
      const projects = Array.isArray(data?.result) ? data.result : null;

      if (!projects) {
        Alert.alert(
          'รูปแบบข้อมูลไม่ถูกต้อง',
          'เซิร์ฟเวอร์ตอบกลับมาในรูปแบบที่ไม่รู้จัก\nไม่ได้แก้ไขข้อมูลในเครื่อง'
        );
        return;
      }

      if (projects.length === 0) {
        Alert.alert(
          'ไม่พบกิจกรรม',
          'เซิร์ฟเวอร์ไม่ได้ส่งกิจกรรมใดกลับมา\nคงข้อมูลเดิมในเครื่องไว้ ไม่ได้ลบทิ้ง'
        );
        return;
      }

      const { saved } = await saveProjects(projects);

      // ✅ saveProjects ลบแล้วเขียนใหม่ทั้งตาราง โปรเจกต์ที่ active และตัวนับจึงต้องอ่านใหม่
      const projectData = await getCurrentProject();
      setCurrentProject(projectData);
      const idForFilter = await getScopeId(projectData);
      setCurrentId(idForFilter);
      await refreshCounts(idForFilter);

      if (projectData) {
        Alert.alert('สำเร็จ', `อัพเดท ${saved} กิจกรรมเรียบร้อย\nกิจกรรมปัจจุบัน: ${projectData.name}`);
      } else {
        // บันทึกสำเร็จ แต่ getCurrentProject() กรองด้วยช่วงเวลาแล้วไม่เหลืออะไร
        // บอกให้ชัดว่าปัญหาอยู่ที่ช่วงเวลาของกิจกรรม ไม่ใช่การดึงข้อมูลล้มเหลว
        const next = await getNextUpcomingProject();
        Alert.alert(
          'อัพเดทแล้ว แต่ยังใช้งานไม่ได้',
          `บันทึก ${saved} กิจกรรมลงเครื่องเรียบร้อย\n` +
          `แต่ยังไม่มีกิจกรรมใดที่ตรงกับเวลาปัจจุบัน จึงยังสแกนไม่ได้` +
          (next ? `\n\nกิจกรรมถัดไป: ${next.name}\nเริ่ม ${next.start_time}` : '')
        );
      }

    } catch (error) {
      // Log error to database
      try {
        await insertErrorLog({
          comp_id: null,
          error_type: 'API_ERROR',
          error_message: error.message || 'ไม่สามารถโหลดข้อมูลได้',
          error_code: error.response?.status || error.code || 'GET_PROJECT_ERROR',
          page_name: 'settings.js',
          action_name: 'getProject',
          user_id: user?.id || null
        });
      } catch (logError) {
        console.error('Failed to log error:', logError);
      }

      Alert.alert('ข้อผิดพลาด', 'ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่อีกครั้ง');
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
        await insertErrorLog({
          comp_id: null,
          error_type: 'DATABASE_ERROR',
          error_message: e.message || 'Failed to clear registers',
          error_code: e.code || 'CLEAR_REGISTERS_ERROR',
          page_name: 'settings.js',
          action_name: 'handleClearRegisters',
          user_id: user?.id || null
        });
      } catch (logError) {
        console.error('Failed to log error:', logError);
      }

      Alert.alert("ผิดพลาด", "ไม่สามารถลบข้อมูลได้.");
    }
  };

  const renderClearRegistersModal = () => (
    <Dialog
      visible={isClearRegistersModalVisible}
      onClose={() => setClearRegistersModalVisible(false)}
      title="ลบข้อมูล Registers"
      subtitle="การกระทำนี้จะลบข้อมูลทะเบียนรถทั้งหมดในเครื่อง กรุณากรอกรหัสเพื่อยืนยัน"
      tone="danger"
    >
      <Field
        label="รหัสอนุมัติ"
        placeholder="กรอกรหัสอนุมัติ"
        value={clearRegistersCodeInput}
        onChangeText={setClearRegistersCodeInput}
        secureTextEntry={true}
        keyboardType="number-pad"
      />
      <DialogActions
        onCancel={() => setClearRegistersModalVisible(false)}
        onConfirm={handleClearRegisters}
        confirmLabel="ลบข้อมูล"
        tone="danger"
      />
    </Dialog>
  );

  // ✅ โหลดรายการรถที่ยังไม่ถูกสแกน อ่านจาก registers ในเครื่องล้วนๆ ไม่ยิง API
  //    จึงใช้ได้ตอนออฟไลน์ (ข้อมูลเก่าสุดเท่ารอบ sync ล่าสุด)
  const loadRemainingVehicles = async () => {
    setRemainingLoading(true);
    try {
      const projectData = await getCurrentProject();
      setCurrentProject(projectData);
      const idForFilter = await getScopeId(projectData);
      const rows = await getUnscannedRegisters(idForFilter, projectData?.seq_no);
      setRemainingList(rows);
      setRemainingCount(rows.length);
    } catch (e) {
      console.error('Failed to load remaining vehicles', e);
      setRemainingList([]);
      try {
        await insertErrorLog({
          comp_id: null,
          error_type: 'DATABASE_ERROR',
          error_message: e.message || 'Failed to load remaining vehicles',
          error_code: e.code || 'REMAINING_VEHICLES_ERROR',
          page_name: 'settings.js',
          action_name: 'loadRemainingVehicles',
          user_id: user?.id || null
        });
      } catch (logError) {
        console.error('Failed to log error:', logError);
      }
    } finally {
      setRemainingLoading(false);
    }
  };

  // ✅ เครื่องอาจไม่มีซิม โทรออกไม่ได้ — ต้องโชว์เบอร์ให้อ่านได้เสมอ
  //    ไม่ใช่ให้ปุ่มโทรเป็นทางเดียวที่จะเห็นเบอร์
  const handleCallDriver = async (phone) => {
    const url = `tel:${phone}`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        Alert.alert('โทรออกจากเครื่องนี้ไม่ได้', `อาจไม่มีซิมในเครื่อง\n\nเบอร์: ${phone}`);
        return;
      }
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert('โทรออกจากเครื่องนี้ไม่ได้', `เบอร์: ${phone}`);
    }
  };

  // --- เปิด modal จากเมนู ---
  const openRemaining = () => {
    setRemainingModalVisible(true);
    loadRemainingVehicles();
  };
  const openMachineCode = () => {
    setMachineCodeInput(machineCode || '');
    setMasterCodeInput('');
    setModalVisible(true);
  };
  const openModeChange = () => {
    setModeMasterCodeInput(''); // เคลียร์รหัสเก่าทุกครั้งที่เปิด
    setModeModalVisible(true);
  };
  const openEnvChange = () => {
    setEnvMasterCodeInput('');
    setEnvModalVisible(true);
  };
  // ซ่อนไว้หลังการกดค้างที่แถวเวอร์ชันโดยตั้งใจ — ลบใบ C7 ทั้งหมดในเครื่อง (ดู CLAUDE.md)
  const openClearRegisters = () => {
    setClearRegistersCodeInput('');
    setClearRegistersModalVisible(true);
  };

  // ✅ สลับ environment ต้องล้างข้อมูลที่ผูกกับ server เดิมออกให้หมด
  //    เดิมแค่พลิกค่า prod/test ทำให้ token, projects และ registers ของอีก server ค้างอยู่
  //    register_id / project_id ของสอง server เป็นคนละชุด แต่ REPLACE INTO registers ใช้
  //    register_id เป็นคีย์ ข้อมูลสองฝั่งจึงปนกันในตารางเดียว
  const applyEnvChange = async (newEnv) => {
    try {
      setLoading(true);
      await updateEnvironment(newEnv);

      // ตัด session เดิม (token ใช้กับอีก server ไม่ได้) และ unpair เครื่องพิมพ์ตามการ logout ปกติ
      await clearSession();
      // เครื่องพิมพ์เป็นฮาร์ดแวร์ตัวเดิมไม่ว่าจะชี้ไป prod หรือ test จึงไม่ต้องลบ

      // ล้างข้อมูล master ที่ผูกกับ server เดิม รอบ sync ถัดไปหลัง login จะดึงใหม่ทั้งหมด
      await clearRegistersTable();
      await clearProjectsTable();

      router.replace('/login');
    } catch (e) {
      console.error("Failed to switch environment:", e);
      try {
        await insertErrorLog({
          comp_id: null,
          error_type: 'DATABASE_ERROR',
          error_message: e.message || 'Failed to switch environment',
          error_code: e.code || 'SWITCH_ENV_ERROR',
          page_name: 'settings.js',
          action_name: 'applyEnvChange',
          user_id: user?.id || null
        });
      } catch (logError) {
        console.error('Failed to log error:', logError);
      }
      Alert.alert("ผิดพลาด", "ไม่สามารถเปลี่ยน Environment ได้.");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmEnvChange = async () => {
    if (envMasterCodeInput !== '8989') {
      Alert.alert("ผิดพลาด", "รหัสอนุมัติไม่ถูกต้อง.");
      return;
    }

    // สลับค่า 'prod' -> 'test' หรือ 'test' -> 'prod'
    const newEnv = environment === 'prod' ? 'test' : 'prod';

    // ปิด Modal ก่อน ไม่งั้น Alert จะซ้อนอยู่หลัง Modal
    setEnvModalVisible(false);
    setEnvMasterCodeInput('');

    // ยอดค้างทั้งเครื่อง ไม่ใช่เฉพาะโปรเจกต์ที่ active
    const pendingTotal = await getTotalUnsyncedCheckInsCount();

    const warning =
      `จะออกจากระบบ และล้างข้อมูลกิจกรรม/ใบ C7 ในเครื่องทั้งหมด\n` +
      `ต้องเข้าสู่ระบบใหม่เพื่อดึงข้อมูลของ ${newEnv.toUpperCase()}` +
      (pendingTotal > 0
        ? `\n\n⚠️ มีรายการลงทะเบียนค้างส่งอยู่ ${pendingTotal} รายการ\nรายการเหล่านี้จะถูกส่งขึ้น ${newEnv.toUpperCase()} แทนที่จะเป็น ${environment.toUpperCase()}`
        : '');

    Alert.alert(
      `เปลี่ยน Environment เป็น ${newEnv.toUpperCase()}?`,
      warning,
      [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: 'ยืนยัน',
          style: 'destructive',
          onPress: () => applyEnvChange(newEnv),
        },
      ],
      { cancelable: false }
    );
  };



  // --- ฟังก์ชันสำหรับจัดการการบันทึกรหัสจาก Modal ---
  const handleSaveCode = async () => {
    if (masterCodeInput !== '8989') {
      Alert.alert("ผิดพลาด", "รหัสอนุมัติไม่ถูกต้อง.");
      return;
    }

    // ✅ รหัสเครื่องว่าง = check-in ทุกแถวจะถูก server ปฏิเสธด้วย 422 (comp id required)
    //    เดิมไม่มี validate เลย จึงตั้งเป็นค่าว่างได้ แล้วข้อมูลค้างส่งทั้งหมดโดยไม่มีใครรู้
    const trimmedCode = (machineCodeInput || '').trim();
    if (!trimmedCode) {
      Alert.alert("ผิดพลาด", "กรุณากรอกรหัสเครื่อง");
      return;
    }

    try {
      await saveSetting('machineCode', trimmedCode);
      setMachineCode(trimmedCode); // อัปเดต UI

      // ✅ เติมรหัสเครื่องให้แถวที่ค้างส่งเพราะไม่มี comp_id แล้วสั่งให้ลองใหม่ทันที
      //    payload อ่านจากแถวเสมอ การตั้งรหัสตอนนี้จึงไม่ช่วยของเก่าถ้าไม่เติมย้อนหลัง
      const filled = await backfillCheckInCompId(trimmedCode);

      Alert.alert(
        "สำเร็จ",
        filled > 0
          ? `รหัสเครื่องเปลี่ยนเรียบร้อยแล้ว!\n\nเติมรหัสเครื่องให้รายการที่ค้างส่ง ${filled} รายการ ระบบจะลองส่งใหม่ให้ทันที`
          : "รหัสเครื่องเปลี่ยนเรียบร้อยแล้ว!"
      );

      // ปิด Modal และเคลียร์ค่า input
      setModalVisible(false);
      setMasterCodeInput('');
      setMachineCodeInput('');

      await refreshCounts();
    } catch (e) {
      Alert.alert("ผิดพลาด", "ไม่สามารถบันทึกรหัสเครื่องได้.");
    }
  };

  // --- ฟังก์ชันสำหรับสร้าง Modal ---
  const renderMachineCodeModal = () => (
    <Dialog
      visible={isModalVisible}
      onClose={() => setModalVisible(false)}
      title="ตั้งรหัสเครื่อง"
      subtitle="ทุกรายการที่บันทึกจากเครื่องนี้จะติดรหัสนี้ไปด้วย"
    >
      <Field
        label="รหัสเครื่อง"
        placeholder="กรอกรหัสเครื่อง"
        value={machineCodeInput}
        onChangeText={setMachineCodeInput}
        keyboardType="number-pad"
      />
      <Field
        label="รหัสอนุมัติ"
        placeholder="กรอกรหัสอนุมัติ"
        value={masterCodeInput}
        secureTextEntry={true}
        onChangeText={setMasterCodeInput}
        keyboardType="number-pad"
      />
      <DialogActions onCancel={() => setModalVisible(false)} onConfirm={handleSaveCode} confirmLabel="บันทึก" />
    </Dialog>
  );

  const renderModeChangeModal = () => (
    <Dialog
      visible={isModeModalVisible}
      onClose={() => setModeModalVisible(false)}
      title="ยืนยันการเปลี่ยนโหมด"
      subtitle={`จาก ${modeLabel(isModeOne)} เป็น ${modeLabel(!isModeOne)}`}
    >
      <Field
        label="รหัสอนุมัติ"
        placeholder="กรอกรหัสอนุมัติ"
        value={modeMasterCodeInput}
        onChangeText={setModeMasterCodeInput}
        secureTextEntry={true}
        keyboardType="number-pad"
      />
      <DialogActions onCancel={() => setModeModalVisible(false)} onConfirm={handleConfirmModeChange} confirmLabel="ยืนยัน" />
    </Dialog>
  );

  const renderEnvironmentModal = () => (
    <Dialog
      visible={isEnvModalVisible}
      onClose={() => setEnvModalVisible(false)}
      title="ยืนยันการเปลี่ยน Environment"
      subtitle={`ตอนนี้: ${environment === 'prod' ? 'Prod' : 'Test'} → จะเปลี่ยนเป็น ${environment === 'prod' ? 'Test' : 'Prod'}`}
    >
      <Field
        label="รหัสอนุมัติ"
        placeholder="กรอกรหัสอนุมัติ"
        value={envMasterCodeInput}
        onChangeText={setEnvMasterCodeInput}
        secureTextEntry={true}
        keyboardType="number-pad"
      />
      <DialogActions onCancel={() => setEnvModalVisible(false)} onConfirm={handleConfirmEnvChange} confirmLabel="ยืนยัน" />
    </Dialog>
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

  // Modal ยืนยันการ Export
  const renderExportModal = () => (
    <Dialog
      visible={isExportModalVisible}
      onClose={() => setExportModalVisible(false)}
      title="Export ฐานข้อมูล"
      subtitle="ต้องการ Export ฐานข้อมูลทั้งหมดใช่หรือไม่?"
    >
      {isExporting && (
        <View className="flex-row items-center justify-center gap-2">
          <ActivityIndicator size="small" color={TINT_PRIMARY} />
          <Text className="text-[13px] text-text-muted">กำลัง Export...</Text>
        </View>
      )}
      <DialogActions
        onCancel={() => setExportModalVisible(false)}
        onConfirm={handleExport}
        confirmLabel="ยืนยัน Export"
        disabled={isExporting}
      />
    </Dialog>
  );

  // การ์ดรถหนึ่งคันในรายการ "รถที่เหลือ"
  const renderRemainingVehicleCard = ({ item }) => {
    const { phone, raw } = getContactInfo(item);
    return (
      <View className="mx-[14px] mb-2 gap-[6px] rounded-[11px] border border-border bg-surface px-3 py-[10px]">
        <View className="flex-row items-center gap-2">
          <Text numberOfLines={1} className="flex-1 text-[18px] font-bold text-text">
            {item.plate_no}{' '}
            <Text className="text-[14px] font-medium text-text-muted">{item.plate_province || ''}</Text>
          </Text>
          {!!item.short_code && (
            <View className="rounded-[7px] bg-chip px-[7px] py-[3px]">
              <Text className="text-[12px] font-semibold text-chip-ink">{item.short_code}</Text>
            </View>
          )}
        </View>

        <InfoLine label="ประเภทรถ" value={item.bus_type || '--'} />
        <InfoLine
          label="จุดออกรถ"
          value={`${item.station_name || '--'}${item.station_province ? ` (${item.station_province})` : ''}`}
        />

        <View className="flex-row items-center gap-2">
          <Text className="w-[76px] text-[13px] text-text-subtle">เบอร์คนขับ</Text>
          {phone ? (
            <TouchableOpacity
              onPress={() => handleCallDriver(phone)}
              className="flex-row items-center gap-[6px] rounded-lg bg-success px-[10px] py-[6px]"
            >
              <Ionicons name="call" size={14} color={ICON_ON_FILL} />
              {/* selectable เผื่อเครื่องโทรออกไม่ได้ จะได้กดค้างคัดลอกไปโทรจากมือถือ */}
              <Text className="text-[14px] font-semibold text-white" selectable>{phone}</Text>
            </TouchableOpacity>
          ) : (
            <Text className="flex-1 text-[13px] text-text-subtle">{raw || 'ไม่มีข้อมูลติดต่อ'}</Text>
          )}
        </View>

        {/* ถ้าข้อความต้นทางมีตัวอักษรนอกเหนือจากตัวเบอร์ (เช่นชื่อคนติดต่อ) ให้เห็นด้วย
            เทียบเฉพาะตัวเลขไม่ได้ เพราะ "โทร 081-xxx หัวหน้าสมชาย" จะได้ตัวเลขชุดเดียวกัน
            แล้วชื่อจะหายไปทั้งที่เป็นข้อมูลที่ต้องใช้ */}
        {!!phone && !!raw && /[^\d\s\-+.()]/.test(raw) && (
          <Text className="text-[12px] leading-[17px] text-text-muted" numberOfLines={2}>{raw}</Text>
        )}
      </View>
    );
  };

  // รายการยาวทั้งกิจกรรม — เปิดเต็มจอแบบเดียวกับหน้าค้นหาบนเซิร์ฟเวอร์ ไม่ใช่การ์ดกลางจอ
  const renderRemainingModal = () => (
    <Modal
      animationType="slide"
      visible={isRemainingModalVisible}
      onRequestClose={() => setRemainingModalVisible(false)}
    >
      <View className="flex-1 bg-surface">
        <View className="flex-row items-center gap-2 border-b border-border px-3 py-[10px]">
          <TouchableOpacity
            onPress={() => setRemainingModalVisible(false)}
            accessibilityLabel="ปิด"
            className="h-9 w-9 items-center justify-center rounded-lg"
          >
            <Ionicons name="chevron-back" size={22} color={ICON_TEXT} />
          </TouchableOpacity>
          <View className="flex-1">
            <Text className="text-[17px] font-bold text-text">รถที่เหลือ</Text>
            <Text numberOfLines={1} className="mt-[1px] text-[12px] text-text-subtle">
              {currentProject?.name
                ? `${currentProject.name} · ยังไม่สแกน ${remainingCount} คัน`
                : `ยังไม่สแกน ${remainingCount} คัน`}
            </Text>
          </View>
          <TouchableOpacity
            onPress={loadRemainingVehicles}
            disabled={remainingLoading}
            accessibilityLabel="รีเฟรช"
            className="h-10 w-10 items-center justify-center rounded-[9px] border border-border-strong bg-surface"
          >
            <Ionicons name="refresh" size={18} color={remainingLoading ? ICON_FAINT : ICON_TEXT} />
          </TouchableOpacity>
        </View>

        {/* ✅ ข้อมูลมาจาก registers ที่ sync มา ไม่ใช่ check_ins ของเครื่องนี้
            จึงเห็นการสแกนของเครื่องอื่นด้วย แต่ก็ค้างได้ถ้าเครื่องออฟไลน์ */}
        <Text className="px-[14px] pb-1 pt-[10px] text-[12px] text-text-subtle">
          อัปเดตตามรอบ sync ใบ C7 (ทุก 10 วินาที) · รวมการสแกนจากทุกเครื่อง
        </Text>

        {remainingLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color={TINT_PRIMARY} />
          </View>
        ) : (
          <SectionList
            sections={remainingSections}
            keyExtractor={(item) => String(item.register_id)}
            renderItem={renderRemainingVehicleCard}
            renderSectionHeader={({ section: { title, data } }) => (
              <Text className="bg-surface px-[14px] pb-[6px] pt-3 text-[12px] font-bold text-text-muted">
                {title} ({data.length})
              </Text>
            )}
            stickySectionHeadersEnabled={false}
            showsVerticalScrollIndicator={true}
            className="flex-1"
            contentContainerStyle={remainingSections.length === 0 ? { flexGrow: 1 } : { paddingBottom: 16 }}
            ListEmptyComponent={
              <View className="flex-1 items-center justify-center gap-[10px] px-6">
                <Ionicons name="checkmark-circle" size={44} color={SUCCESS} />
                <Text className="text-center text-[15px] text-text-muted">
                  {currentProject
                    ? 'สแกนครบทุกคันแล้ว'
                    : 'ไม่พบกิจกรรมที่กำลังดำเนินอยู่'}
                </Text>
              </View>
            }
          />
        )}
      </View>
    </Modal>
  );

  const renderVersionModal = () => {
    const rows = [
      otaVersion ? { label: 'OTA Version', value: otaVersion, highlight: true } : null,
      { label: 'App Version', value: appVersion },
      { label: 'Runtime Version', value: runtimeVersion },
      { label: 'Update Channel', value: updateChannel },
      { label: 'Update ID', value: updateId ? updateId.substring(0, 16) + '...' : 'ไม่มี OTA Update' },
    ].filter(Boolean);

    return (
      <Dialog
        visible={isVersionModalVisible}
        onClose={() => setVersionModalVisible(false)}
        title="ข้อมูลเวอร์ชัน"
      >
        <View className="overflow-hidden rounded-[10px] border border-border">
          {rows.map((r, i) => (
            <View
              key={r.label}
              className={`flex-row items-center justify-between gap-3 px-3 py-[10px] ${r.highlight ? 'bg-success-bg' : 'bg-surface'} ${i < rows.length - 1 ? 'border-b border-fill' : ''}`}
            >
              <Text className={`text-[13px] ${r.highlight ? 'font-semibold text-success-ink' : 'text-text-muted'}`}>{r.label}</Text>
              {/* selectable — ใช้เทียบ update ID กับ EAS ตอนตามหาว่าเครื่องได้ OTA หรือยัง */}
              <Text
                selectable
                numberOfLines={1}
                className={`flex-shrink text-right text-[13px] font-semibold ${r.highlight ? 'text-success-ink' : 'text-text'}`}
              >
                {r.value}
              </Text>
            </View>
          ))}
        </View>
        <TouchableOpacity
          onPress={() => setVersionModalVisible(false)}
          activeOpacity={0.7}
          className="mt-1 h-11 items-center justify-center rounded-[9px] border border-border-strong bg-surface"
        >
          <Text className="text-[15px] font-semibold text-text">ปิด</Text>
        </TouchableOpacity>
      </Dialog>
    );
  };

  // ⚠️ ค่าที่คำนวณตรงนี้เป็นตัวแปรธรรมดา ไม่ใช่ hook — อยู่ใต้ if (loading) ได้
  const hasMachineCode = machineCode != null && String(machineCode).trim() !== '';
  const displayName = `${first_name || ''} ${last_name || ''}`.trim() || username || 'ผู้ใช้';
  const initials = initialsOf(first_name, last_name, username);
  const refresh = () => refreshCounts();

  return (
    <View className="flex-1 bg-surface">
      {/* แถบดำคลุมพื้นที่ status bar — ทุกหน้าในแอพมี เพราะ status bar โปร่งใสและเนื้อหาวางทับ */}
      <View className="h-[25px] bg-black" />
      {renderMachineCodeModal()}
      {renderModeChangeModal()}
      {renderEnvironmentModal()}
      {renderExportModal()}
      {renderVersionModal()}
      {renderClearRegistersModal()}
      {renderRemainingModal()}

      {/* ── ผู้ใช้ · กิจกรรม · ออกจากระบบ ── */}
      <View className="flex-row items-center gap-[10px] border-b border-border px-[14px] pb-[10px] pt-3">
        <View className="h-10 w-10 items-center justify-center rounded-[10px] bg-chip">
          {initials ? (
            <Text className="text-[16px] font-bold text-chip-ink">{initials}</Text>
          ) : (
            <Ionicons name="person-outline" size={18} color={ICON_MUTED} />
          )}
        </View>
        <View className="flex-1">
          <Text numberOfLines={1} className="text-[16px] font-bold text-text">{displayName}</Text>
          <Text numberOfLines={1} className="text-[12px] text-text-subtle">
            {currentProject?.name || 'ไม่พบกิจกรรมที่กำลังดำเนินอยู่'}
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleLogout}
          accessibilityLabel="ออกจากระบบ"
          className="h-10 w-10 items-center justify-center rounded-[9px] border border-border-strong bg-surface"
        >
          <Ionicons name="log-out-outline" size={19} color={ICON_TEXT} />
        </TouchableOpacity>
      </View>

      {/* ✅ รหัสเครื่องที่ยังไม่ตั้งทำให้ทุกรายการถูกปฏิเสธ — ขึ้นเป็นแถบบนสุด ไม่ใช่ค่าเล็กๆ ในรายการ */}
      {!hasMachineCode && (
        <View className="px-[14px] pt-3">
          <View className="flex-row items-center gap-[9px] rounded-[10px] border border-danger-bg bg-danger-surface px-3 py-[10px]">
            <Ionicons name="alert-circle-outline" size={18} color={DANGER_INK} />
            <View className="flex-1">
              <Text className="text-[13px] font-bold text-danger-ink">ยังไม่ได้ตั้งรหัสเครื่อง</Text>
              <Text className="text-[12px] leading-[16px] text-danger-ink">ทุกรายการจะถูกปฏิเสธด้วย 422</Text>
            </View>
            <TouchableOpacity
              onPress={openMachineCode}
              activeOpacity={0.8}
              className="h-[34px] justify-center rounded-lg bg-danger px-3"
            >
              <Text className="text-[12px] font-bold text-white">ตั้งเลย</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 20 }}>

        {/* ── ตัวเลข — แตะเพื่ออ่านใหม่ ── */}
        <View className="gap-2 px-[14px] pt-3">
          <View className="flex-row gap-2">
            <StatCard value={registersCount} label="ใบ C7" edge={EDGE_NEUTRAL} ink="text-text" onPress={refresh} />
            <StatCard value={successCount} label="ส่งสำเร็จ" edge={EDGE_SUCCESS} ink="text-success-ink" onPress={refresh} />
          </View>
          <View className="flex-row gap-2">
            <StatCard value={pendingSyncCount} label="ยังไม่ได้ส่ง" edge={EDGE_WARNING} ink="text-warning-ink" onPress={refresh} />
            <StatCard value={syncErrorCount} label="พบปัญหา" edge={EDGE_DANGER} ink="text-danger-ink" onPress={refresh} />
          </View>
        </View>

        <View className="gap-[14px] px-[14px] pt-[14px]">
          <MenuGroup title="งานประจำวัน">
            <MenuRow
              icon="bus-outline"
              label="รถที่เหลือ"
              value={`${remainingCount} คัน`}
              valueClass={remainingCount > 0 ? 'text-warning-ink' : 'text-text-muted'}
              onPress={openRemaining}
            />
            <MenuRow icon="refresh-outline" label="อัพเดทข้อมูลกิจกรรม" onPress={getProject} />
            <MenuRow icon="download-outline" label="Export ฐานข้อมูล" onPress={() => setExportModalVisible(true)} last />
          </MenuGroup>

          <MenuGroup title="ตั้งค่าเครื่อง">
            <MenuRow
              icon="barcode-outline"
              label="รหัสเครื่อง"
              value={hasMachineCode ? String(machineCode) : 'ยังไม่ตั้ง'}
              valueClass={hasMachineCode ? 'text-text-muted' : 'text-danger-ink'}
              onPress={openMachineCode}
            />
            <MenuRow icon="swap-horizontal-outline" label="โหมด" value={modeLabel(isModeOne)} onPress={openModeChange} />
            {/* Test เป็นสีส้ม — ลงทะเบียนหน้างานบน test คือข้อมูลหายไปจากระบบจริง ต้องเห็นได้ทันที */}
            <MenuRow
              icon="server-outline"
              label="Environment"
              value={environment === 'prod' ? 'Prod' : 'Test'}
              valueClass={environment === 'prod' ? 'text-text-muted' : 'text-warning-ink'}
              onPress={openEnvChange}
            />
            <MenuRow
              icon="information-circle-outline"
              label="เวอร์ชัน"
              value={otaVersion || appVersion}
              onPress={() => setVersionModalVisible(true)}
              onLongPress={openClearRegisters}
              last
            />
          </MenuGroup>
        </View>
      </ScrollView>
    </View>
  );
}

