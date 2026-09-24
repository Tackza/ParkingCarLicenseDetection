import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Dimensions,
  FlatList,
  Image,
  Keyboard, // เพิ่มเข้ามา
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  TouchableOpacity,
  View,
} from 'react-native';
// import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { BluetoothEscposPrinter } from 'react-native-bluetooth-escpos-printer';
import DropDownPicker from 'react-native-dropdown-picker';
import ImageZoom from 'react-native-image-pan-zoom';
import ViewShot, { captureRef } from 'react-native-view-shot';
import Receipt from '../../components/Receipt';
import { THAI_PROVINCES } from '../../constants/provinces';
import { useEnvironment } from '../../contexts/EnvironmentContext';
// import CheckInSyncManager from '../../components/CheckInSyncManager';
import HistoryItem from '../../components/HistoryItem';
import { getActiveSession, getScanHistory, getScopeId, getSetting, insertErrorLog } from '../../constants/Database';
import { useAuth } from '../../contexts/AuthContext';
import { useMode } from '../../contexts/ModeContext';
import { useProject } from '../../contexts/ProjectContext';
import { usePrinter } from '../../contexts/PrinterContext';
import { useSync } from '../../contexts/SyncContext';

const windowWidth = Dimensions.get('window').width;
const windowHeight = Dimensions.get('window').height;

// ✅ ระยะรีเฟรชรายการระหว่างที่เปิดหน้านี้อยู่
//    CheckInSyncManager เขียน sync_status ลง SQLite ทุก 10 วิ แต่หน้านี้อ่านใหม่เฉพาะตอน focus
//    เดิมจึงต้องสลับหน้าไปมาถึงจะเห็นสถานะเปลี่ยน
const HISTORY_REFRESH_INTERVAL = 5000;

// Ionicons และ RefreshControl รับสีเป็น prop ไม่ใช่ className
// ค่าต้องตรงกับ token ใน tailwind.config.js
const ICON_MUTED = '#6e7580';   // text-subtle
const ICON_FAINT = '#8f959e';   // icon-faint — ไอคอนประดับในสถานะว่าง
const ICON_ON_FILL = '#ffffff'; // บนพื้นสีทึบ
const TINT_PRIMARY = '#217cba'; // primary


// เทียบเฉพาะฟิลด์ที่เปลี่ยนได้จากการ sync เพื่อไม่ต้อง setState ทุกรอบ
const historySignature = (rows) =>
  Array.isArray(rows)
    ? rows.map(r => `${r.id}:${r.sync_status}:${r.printed}:${r.error_msg || ''}`).join('|')
    : '';

export default function HistoryScreen() {
  const [history, setHistory] = useState([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const router = useRouter();
  const { isConnected: isPrinterConnected, hasSavedPrinter } = usePrinter();
  const { isOnline } = useSync();
  const { activeProject, refreshCurrentProject } = useProject();
  // const debounceTimer = useRef(null);
  const { isModeOne } = useMode();

  // --- New Search Feature State ---
  const { environment } = useEnvironment();
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [searchPlateNo, setSearchPlateNo] = useState('');
  const [searchProvince, setSearchProvince] = useState('');
  const [provinceOpen, setProvinceOpen] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [printData, setPrintData] = useState(null);
  const [printLoading, setPrintLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [machineCode, setMachineCode] = useState(null);
  const [searchImageModalVisible, setSearchImageModalVisible] = useState(false);
  const [selectedSearchImage, setSelectedSearchImage] = useState(null);
  const receiptRef = useRef();
  const { user } = useAuth();

  // ✅ Function สำหรับค้นหาอย่างรวดเร็วจากการ์ด
  const handleQuickSearch = (plateNo, province) => {
    // Preset ค่า plate_no และ province จากการ์ด แล้วเปิด modal
    if (!plateNo || !province) {
      Alert.alert('ข้อมูลไม่ครบ', 'กรุณาตรวจสอบข้อมูลทะเบียนและจังหวัด');
      return;
    }
    // check-in เก็บ กทม. แบบย่อ แต่ dropdown/THAI_PROVINCES ใช้ชื่อเต็ม จึงต้องแปลงให้ตรงกัน
    const normalizedProvince = province === 'กทม.' ? 'กรุงเทพมหานคร' : province;
    setSearchPlateNo(plateNo);
    setSearchProvince(normalizedProvince);
    setSearchModalVisible(true);
    // ค้นหาอัตโนมัติหลังจาก modal เปิด
    setTimeout(() => {
      handleOnlineSearchInternal(plateNo, normalizedProvince);
    }, 300);
  };

  const handleOnlineSearch = async () => {
    // varidate inputs
    if (searchPlateNo.trim() === '' || searchProvince.trim() === '') {
      Alert.alert('แจ้งเตือน', 'กรุณากรอกทะเบียนรถและเลือกจังหวัด');
      return;
    }
    if (!activeProject) return;

    handleOnlineSearchInternal(searchPlateNo, searchProvince);
  };

  // ✅ Internal function สำหรับ API call
  const handleOnlineSearchInternal = async (plateNo, province) => {

    setIsSearching(true);
    setSearchResults([]);

    try {
      const API_URL = environment === 'prod' ?
        "https://mbus.dhammakaya.network/api" :
        "https://mbus-test.dhammakaya.network/api";

      const session = await getActiveSession();
      const token = session?.lpr_token;

      const params = {
        project_id: activeProject.project_id,
        activity_id: activeProject.activity_id || '',
        seq_no: activeProject.seq_no || '',
        plate_no: plateNo,
        plate_province: province
      };

      console.log('Searching with params:', params);

      const response = await axios.get(`${API_URL}/lpr/checkins/search`, {
        params,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        }
      });

      if (response.data && response.data.status === 'success') {
        console.log('Search Results Data:', response.data.result);

        if (response.data.result) {
          // ตรวจสอบว่าเป็น Array หรือไม่ ถ้าไม่ใช่ให้แปลงเป็น Array
          const results = Array.isArray(response.data.result) ? response.data.result : [response.data.result];
          setSearchResults(results);
          // ปิดคีย์บอร์ดเมื่อค้นหาเจอข้อมูล
          Keyboard.dismiss();
        } else {
          setSearchResults([]);
          Alert.alert('ไม่พบข้อมูล', 'ไม่พบข้อมูลทะเบียนรถที่ระบุ');
        }
      } else {
        setSearchResults([]);
        Alert.alert('ไม่พบข้อมูล', 'ไม่พบข้อมูลทะเบียนรถที่ระบุ');
      }
    } catch (error) {
      console.error('Search error:', error);

      // Log error to database
      await insertErrorLog({
        comp_id: null,
        error_type: 'API_ERROR',
        error_message: error.message || 'เกิดข้อผิดพลาดในการค้นหา',
        error_code: error.response?.status || error.code || 'SEARCH_ERROR',
        page_name: 'main.js',
        action_name: 'handleOnlineSearch',
        user_id: user?.id || null
      });

      Alert.alert('ข้อผิดพลาด', error.message || 'เกิดข้อผิดพลาดในการค้นหา');
    } finally {
      setIsSearching(false);
    }
  };

  const handlePrint = async (item) => {
    if (!item.register_id || item.printed !== false || printLoading) return;

    setPrintLoading(true);
    setPrintData(item);

    try {
      // 1) Call print-slip API first
      const API_URL = environment === 'prod' ?
        "https://mbus.dhammakaya.network/api" :
        "https://mbus-test.dhammakaya.network/api";

      const session = await getActiveSession();
      const token = session?.lpr_token;


      const body = {
        uid: item?.uid || '',
        project_id: activeProject?.project_id || '',
        activity_id: activeProject?.activity_id || '',
        seq_no: activeProject?.seq_no || '',
        register_id: item.register_id,
        comp_id: item.comp_id || ''
      };

      console.log('Calling print-slip with body:', body);

      const printResp = await axios.post(`${API_URL}/lpr/checkins/print-slip`, body, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        }
      });

      console.log('print-slip response:', printResp.data);

      // ✅ ตรวจสอบเฉพาะ status === 'success' เท่านั้น ไม่สนใจ result
      if (!printResp.data || printResp.data.status !== 'success') {
        Alert.alert('ข้อผิดพลาด', 'ไม่สามารถบันทึกการพิมพ์ได้');
        setPrintData(null);
        setPrintLoading(false);
        return;
      }

      // 2) Wait a short time to allow any back-end processing, then capture and print
      setTimeout(async () => {
        try {
          const uri = await captureRef(receiptRef, {
            format: 'png',
            quality: 1.0,
            result: 'base64',
          });
          await BluetoothEscposPrinter.printPic(uri, { width: 520, left: 0 });
          await BluetoothEscposPrinter.printerAlign(BluetoothEscposPrinter.ALIGN.CENTER);
          await BluetoothEscposPrinter.printText('\r\n\r\n', {});

          // ปิด modal หลังพิมพ์เสร็จ
          setSearchModalVisible(false);
          setSearchPlateNo('');
          setSearchProvince('');
          setSearchResults([]);
          // Update local searchResults to mark as printed
          try {
            setSearchResults(prev => prev.map(r => (r && r.register_id === item.register_id) ? { ...r, printed: true } : r));
            // Refresh history for the current query to reflect printed status
            if (typeof loadHistory === 'function') {
              loadHistory(searchQuery || '');
            }
          } catch (e) {
            console.warn('Could not update local printed state:', e);
          }
        } catch (error) {
          console.error('Print error after API success:', error);

          // Log error to database
          await insertErrorLog({
            comp_id: item?.comp_id || null,
            error_type: 'PRINT_ERROR',
            error_message: error.message || 'ไม่สามารถพิมพ์ได้',
            error_code: error.code || 'BLUETOOTH_PRINT_ERROR',
            page_name: 'main.js',
            action_name: 'handlePrint - Bluetooth print',
            user_id: user?.id || null
          });

          Alert.alert('ข้อผิดพลาด', 'ไม่สามารถพิมพ์ได้');
        } finally {
          setPrintData(null);
          setPrintLoading(false);
        }
      }, 500);

    } catch (error) {
      console.error('Print API error:', error);

      // Log error to database
      await insertErrorLog({
        comp_id: item?.comp_id || null,
        error_type: 'API_ERROR',
        error_message: error.message || 'Print API error',
        error_code: error.response?.status || error.code || 'PRINT_API_ERROR',
        page_name: 'main.js',
        action_name: 'handlePrint - API call',
        user_id: user?.id || null
      });

      // ✅ ไม่แสดง alert เมื่อมี error จาก API (ลอง handle gracefully)
      console.log('Continuing with print attempt despite API error');
      setPrintData(null);
      setPrintLoading(false);
    }
  };
  // --- End New Search Feature State ---


  // ✅ 3. ใช้ useFocusEffect เพื่อจัดการทุกอย่างเมื่อหน้าจอถูกเปิด
  useFocusEffect(
    useCallback(() => {
      console.log("History screen focused. Refreshing current project and loading history...");
      // สั่งให้ Context อัปเดตโปรเจกต์ปัจจุบันจากฐานข้อมูล
      refreshCurrentProject();
      // เมื่อ activeProject เปลี่ยน (ซึ่ง refreshCurrentProject จะทำ) loadHistory จะถูกเรียกโดยอัตโนมัติจาก dependency ของมันเอง
      // ไม่ต้องเรียก loadHistory() ตรงๆ ที่นี่อีกครั้ง เพื่อป้องกันการเรียกซ้ำ

      // เพิ่มโค้ดที่อาจจะต้องการเมื่อ Focus เช่น ตรวจสอบสถานะออนไลน์ (ถ้าต้องการ)
      // ถ้า CheckInSyncManager อัปเดต isOnline ด้วย, บางทีคุณอาจจะต้องดึงค่า isOnline ล่าสุดอีกครั้ง
      // แต่ปกติ useSync() จะดึงค่าล่าสุดให้เองเมื่อ context มีการเปลี่ยนแปลง
    }, [refreshCurrentProject]) // Dependency: refreshCurrentProject เท่านั้น
  );

  // ปุ่ม back ของ Android บนหน้า home: ไม่ให้ย้อนกลับไปหน้า bluetooth-setup / passenger_count
  // กดครั้งแรกเตือน กดอีกครั้งภายใน 2 วินาทีจึงปิดโปรแกรม
  const backPressedOnceRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      let backTimer = null;
      const onBackPress = () => {
        if (backPressedOnceRef.current) {
          BackHandler.exitApp();
          return true;
        }
        backPressedOnceRef.current = true;
        ToastAndroid.show('กดย้อนกลับอีกครั้งเพื่อปิดโปรแกรม', ToastAndroid.SHORT);
        backTimer = setTimeout(() => {
          backPressedOnceRef.current = false;
        }, 2000);
        return true; // บล็อกการย้อนกลับ default
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => {
        sub.remove();
        if (backTimer) clearTimeout(backTimer);
        backPressedOnceRef.current = false;
      };
    }, [])
  );


  useEffect(() => {
    if (activeProject) {
      console.log("Project changed, loading full history...");
      loadHistory(''); // 👈 โหลดทั้งหมด (ล้าง searchQuery)
      setSearchQuery(''); // 👈 เคลียร์ช่องค้นหาด้วย
    }
  }, [activeProject]);

  // ✅ เก็บ ref ของ loadHistory และ searchQuery ล่าสุด
  //    timer ด้านล่างถูกตั้งครั้งเดียวตอน focus จึงต้องเรียกผ่าน ref ไม่งั้นจะติด closure เก่า
  //    (และถ้าใส่ searchQuery เป็น dependency ตรงๆ timer จะถูกตั้งใหม่ทุกครั้งที่พิมพ์)
  const loadHistoryRef = useRef(null);
  const searchQueryRef = useRef('');
  useEffect(() => {
    loadHistoryRef.current = loadHistory;
    searchQueryRef.current = searchQuery;
  });

  // ✅ รหัสเครื่องตั้งได้จากหน้า Settings จึงอ่านใหม่ทุกครั้งที่กลับเข้าหน้านี้
  //    ไม่ได้มีไว้ประดับ — ถ้ายังไม่ตั้ง server จะปฏิเสธทุกรายการด้วย 422
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getSetting('machineCode').then(v => { if (alive) setMachineCode(v); });
      return () => { alive = false; };
    }, [])
  );

  // ✅ รีเฟรชอัตโนมัติเฉพาะตอนที่หน้านี้ถูกเปิดอยู่ แล้วหยุดทันทีที่ออกจากหน้า
  //    ใช้ setInterval ธรรมดา ไม่ใช่ BackgroundTimer เพราะเป็นการรีเฟรช UI
  //    ที่ไม่มีประโยชน์เลยเมื่อผู้ใช้มองไม่เห็นหน้าจอ
  useFocusEffect(
    useCallback(() => {
      const timer = setInterval(() => {
        loadHistoryRef.current?.(searchQueryRef.current || '');
      }, HISTORY_REFRESH_INTERVAL);
      return () => clearInterval(timer);
    }, [])
  );

  // ✅ ดึงลงเพื่อรีเฟรชเอง สำหรับตอนที่ไม่อยากรอครบรอบ
  const handlePullToRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // อ่านกิจกรรมใหม่เฉพาะตอนที่ยังไม่มี (เช่นเพิ่งถึงเวลาเริ่ม)
      // ถ้าเรียกทุกครั้ง refreshCurrentProject จะไปกระตุ้น useEffect([activeProject])
      // ซึ่งล้างช่องค้นหาทิ้ง — ไม่ควรเกิดระหว่างผู้ใช้กำลังค้นหาอยู่บนหน้านี้
      if (!activeProject) {
        await refreshCurrentProject();
      }
      await loadHistoryRef.current?.(searchQueryRef.current || '');
    } finally {
      setIsRefreshing(false);
    }
  }, [activeProject, refreshCurrentProject]);


  // ✅ 2. สร้างฟังก์ชัน loadHistory ที่ขึ้นอยู่กับ activeProject
  // const loadHistory = useCallback(async () => {
  //   if (!activeProject) {
  //     setHistory([]);
  //     return;
  //   }
  //   try {
  //     // 🔷 MODIFY: ส่ง searchQuery เข้าไปด้วย
  //     console.log(`Loading history for project ID: ${activeProject.project_id}, Query: "${searchQuery}"`);
  //     const data = await getScanHistory(activeProject.project_id, searchQuery);
  //     setHistory(data);
  //   } catch (error) {
  //     console.error('Error loading history:', error);
  //     Alert.alert('ข้อผิดพลาด', 'ไม่สามารถโหลดประวัติได้');
  //   }
  // }, [activeProject, searchQuery]);

  const loadHistory = async (query) => {
    if (!activeProject) {
      setHistory([]);
      return;
    }
    try {
      // เลือก id ที่จะส่งเข้า getScanHistory ตามโหมด
      // ใช้ getScopeId เพื่อให้ "ค่า" ตรงกับ "คอลัมน์" ที่ getScanHistory เลือกเสมอ
      // และเพื่อให้ถอยไป project_id เองเมื่อกิจกรรมนั้นไม่มี activity_id
      const id = await getScopeId(activeProject);
      const data = await getScanHistory(id, query);
      // ✅ คงอ้างอิง array เดิมไว้ถ้าข้อมูลไม่เปลี่ยน เพื่อให้ FlatList ไม่ re-render ทุกรอบรีเฟรช
      setHistory(prev => (historySignature(prev) === historySignature(data) ? prev : data));
    } catch (error) {
      console.error('Error loading history:', error);

      // Log error to database
      await insertErrorLog({
        comp_id: null,
        error_type: 'DATABASE_ERROR',
        error_message: error.message || 'ไม่สามารถโหลดประวัติได้',
        error_code: error.code || 'LOAD_HISTORY_ERROR',
        page_name: 'main.js',
        action_name: 'loadHistory',
        user_id: user?.id || null
      });

      setHistory([]); // รีเซ็ตให้เป็น array ว่างเพื่อแสดงข้อความ "ไม่มีข้อมูล"
      Alert.alert('ข้อผิดพลาด', 'ไม่สามารถโหลดประวัติได้');
    }
  };




  const openImageModal = (uri) => {
    setSelectedImage(uri);
    setModalVisible(true);
  };

  const numberPlate = (index) => {
    return (history.length - index)
  }


  // ค้นหาในเครื่อง — ช่องนี้ผูกกับ searchQuery ที่มีอยู่แล้วแต่ไม่มี UI มาก่อน
  //
  // หน่วง 250 มิลลิวินาทีก่อนยิง query จริง เพราะ getScanHistory ตัด LIMIT ทิ้ง
  // เมื่อมีคำค้น การพิมพ์ตัวแรก (เช่น "ก") จึงดึงได้ทั้งวันและ re-render ทั้งลิสต์
  // — ถ้ายิงทุกตัวอักษรบนเครื่อง V3 จะรู้สึกหน่วง
  const searchDebounceRef = useRef(null);
  const handleLocalSearch = (text) => {
    setSearchQuery(text);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => loadHistoryRef.current?.(text), 250);
  };

  // กัน timer ค้างเมื่อออกจากหน้าไปกลางคัน
  useEffect(() => () => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
  }, []);

  return (
    <View className="flex-1 bg-surface">
      {/* แถบดำคลุมพื้นที่ status bar — ของเดิม เก็บไว้เพราะเลย์เอาต์ทั้งหน้าวางทับพื้นที่นั้น */}
      <View className="h-[25px] bg-black" />

      {/* ── หัวเรื่อง: กิจกรรม · รหัสเครื่อง · สถานะเครือข่าย ── */}
      <View className="flex-row items-center gap-2 border-b border-border px-[14px] pb-2 pt-[10px]">
        <View className="flex-1">
          <Text numberOfLines={1} className="text-[15px] font-bold text-text">
            {activeProject?.name || 'ไม่พบข้อมูลกิจกรรม'}
          </Text>
          {/* ✅ รหัสเครื่องอยู่ตรงนี้เพราะเป็นสาเหตุอันดับหนึ่งที่รายการถูกปฏิเสธ
              เดิมต้องเข้าหน้า Settings ถึงจะรู้ว่าตั้งไว้หรือยัง */}
          <Text
            numberOfLines={1}
            className={`mt-[1px] text-[12px] ${machineCode ? 'text-text-subtle' : 'font-semibold text-danger-ink'}`}
          >
            {machineCode ? `เครื่อง ${machineCode}` : 'ยังไม่ได้ตั้งรหัสเครื่อง'}
          </Text>
        </View>

        {/* ✅ เดิมเป็นไอคอนเมฆเปล่าๆ ซึ่งไม่มีใครรู้ว่าแปลว่าอะไร — ใส่จุดสีคู่กับคำ */}
        <View className={`flex-row items-center gap-1 rounded-[7px] px-2 py-1 ${isOnline ? 'bg-success-bg' : 'bg-danger-bg'}`}>
          <View className={`h-[7px] w-[7px] rounded-full ${isOnline ? 'bg-success' : 'bg-danger'}`} />
          <Text className={`text-[12px] font-semibold ${isOnline ? 'text-success-ink' : 'text-danger-ink'}`}>
            {isOnline ? 'ออนไลน์' : 'ออฟไลน์'}
          </Text>
        </View>
      </View>

      {/* ✅ เตือนค้างไว้เมื่อยังเชื่อมเครื่องพิมพ์ไม่ได้ — ลงทะเบียนต่อได้ แต่จะพิมพ์ไม่ออก
          แตะเพื่อกลับไปเลือก/เชื่อมเครื่องพิมพ์ (manual=1 บอกให้หน้านั้นแสดงรายการแทนการ auto-connect) */}
      {!isPrinterConnected && (
        <TouchableOpacity
          className="mx-[14px] mt-[10px] flex-row items-center gap-2 rounded-[9px] bg-warning px-3 py-[9px]"
          onPress={() => router.push('/bluetooth-setup?manual=1')}
          activeOpacity={0.8}
        >
          <Ionicons name="print-outline" size={17} color={ICON_ON_FILL} />
          <Text className="flex-1 text-[13px] font-semibold text-white">
            {hasSavedPrinter
              ? 'ยังไม่ได้เชื่อมเครื่องพิมพ์ — แตะเพื่อเชื่อมใหม่'
              : 'ยังไม่ได้ตั้งเครื่องพิมพ์ — แตะเพื่อเลือก'}
          </Text>
          <Ionicons name="chevron-forward" size={17} color={ICON_ON_FILL} />
        </TouchableOpacity>
      )}

      {/* ── ค้นหา: ช่องซ้ายกรองในเครื่อง ปุ่มขวาถามเซิร์ฟเวอร์ ── */}
      <View className="flex-row gap-2 px-[14px] pt-[10px]">
        <View className="flex-1">
          <TextInput
            value={searchQuery}
            onChangeText={handleLocalSearch}
            placeholder="ค้นหาทะเบียน"
            placeholderTextColor={ICON_MUTED}
            returnKeyType="search"
            onSubmitEditing={() => Keyboard.dismiss()}
            className="h-[42px] rounded-[9px] border border-border-strong bg-surface py-0 pl-[34px] pr-3 text-[15px] text-text"
          />
          {/* วางไอคอนไว้หลัง TextInput เพื่อให้ทับด้านบนโดยไม่ต้องพึ่ง zIndex
              (บน Android zIndex ระหว่าง sibling เอาแน่ไม่ได้) และปิดการรับสัมผัสไว้ */}
          <View pointerEvents="none" className="absolute left-[11px] top-[12px]">
            <Ionicons name="search" size={17} color={ICON_MUTED} />
          </View>
        </View>

        {/* ปุ่มนี้ไม่ใช่การ submit ช่องซ้าย แต่เป็นการถามเซิร์ฟเวอร์ — ไอคอนเมฆบอกความต่าง */}
        <TouchableOpacity
          className={`h-[42px] flex-row items-center gap-[5px] rounded-[9px] px-[14px] ${isOnline ? 'bg-primary' : 'bg-primary-muted'}`}
          onPress={() => {
            if (!isOnline) {
              Alert.alert('ไม่มีอินเทอร์เน็ต', 'ต้องมีการเชื่อมต่ออินเทอร์เน็ตเพื่อใช้ฟีเจอร์ค้นหาออนไลน์');
              return;
            }
            setSearchModalVisible(true);
          }}
          activeOpacity={isOnline ? 0.7 : 1}
        >
          <Ionicons name="cloud-outline" size={16} color={ICON_ON_FILL} />
          <Text className="text-[14px] font-semibold text-white">ค้นหา</Text>
        </TouchableOpacity>
      </View>

      <View className="flex-1 pt-[10px]">
        {/* ✅ render FlatList เสมอ แล้วใช้ ListEmptyComponent แทนการสลับ View
            เพื่อให้ "ดึงลงเพื่อรีเฟรช" ใช้ได้ตอนลิสต์ว่างด้วย ซึ่งเป็นตอนที่อยากรีเฟรชที่สุด */}
        <FlatList
          data={history}
          keyExtractor={(item) => item.id ? item.id.toString() : Math.random().toString()}
          renderItem={({ item, index }) => (
            <HistoryItem
              item={item}
              index={index}
              numberPlate={numberPlate}
              openImageModal={openImageModal}
              onQuickSearch={handleQuickSearch}
            />
          )}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 12 }}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handlePullToRefresh}
              colors={[TINT_PRIMARY]}
              tintColor={TINT_PRIMARY}
            />
          }
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center px-6 py-10">
              <Ionicons name="documents-outline" size={38} color={ICON_FAINT} />
              <Text className="mt-[10px] text-[15px] text-text-muted">
                {!activeProject ? 'ไม่พบข้อมูลกิจกรรม' : (searchQuery.length > 0 ? 'ไม่พบข้อมูลที่ตรงกัน' : 'ยังไม่มีรายการลงทะเบียน')}
              </Text>
            </View>
          }
          ListFooterComponent={
            // ✅ getScanHistory ใส่ LIMIT 5 ไว้เมื่อไม่ได้ค้นหา — เดิมไม่มีอะไรบอก
            //    เจ้าหน้าที่จึงเข้าใจว่าวันนี้ลงทะเบียนไปแค่ 5 คัน
            !searchQuery && history.length >= 5 ? (
              <Text className="px-[14px] pb-1 pt-2 text-center text-[12px] text-text-subtle">
                แสดง 5 รายการล่าสุด · พิมพ์ทะเบียนเพื่อค้นหารายการก่อนหน้า
              </Text>
            ) : null
          }
        />
      </View>

      {/* Modal สำหรับแสดงรูปภาพเต็มจอ */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <ImageZoom
            cropWidth={windowWidth}
            cropHeight={windowHeight}
            imageWidth={windowWidth}
            imageHeight={windowHeight}
            minScale={0.8} // อาจจะเพิ่ม minScale เพื่อให้ซูมออกได้
            maxScale={2.5}
          >
            <Image
              source={{ uri: selectedImage }}
              style={styles.fullscreenImage}
              resizeMode="contain"
            />
          </ImageZoom>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => setModalVisible(false)}
          >
            <Text style={styles.closeButtonText}>✕</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Modal สำหรับแสดงรูปภาพจากการค้นหาเต็มจอ */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={searchImageModalVisible}
        onRequestClose={() => setSearchImageModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <ImageZoom
            cropWidth={windowWidth}
            cropHeight={windowHeight}
            imageWidth={windowWidth}
            imageHeight={windowHeight}
            minScale={0.8}
            maxScale={2.5}
          >
            <Image
              source={{ uri: selectedSearchImage }}
              style={styles.fullscreenImage}
              resizeMode="contain"
            />
          </ImageZoom>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => setSearchImageModalVisible(false)}
          >
            <Text style={styles.closeButtonText}>✕</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* ✅ ADD: Search Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={searchModalVisible}
        onRequestClose={() => setSearchModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.searchModalContent}>
            <Text style={styles.modalTitle}>ค้นหาข้อมูลทะเบียนรถ</Text>

            <TextInput
              style={styles.input}
              placeholder="กรอกทะเบียนรถ"
              value={searchPlateNo}
              onChangeText={setSearchPlateNo}
            />

            <View style={{ zIndex: 1000, marginBottom: 15, width: '100%' }}>
              <DropDownPicker
                open={provinceOpen}
                value={searchProvince}
                items={THAI_PROVINCES}
                setOpen={setProvinceOpen}
                setValue={setSearchProvince}
                searchable={true}
                placeholder="เลือกจังหวัด"
                listMode="MODAL"
                style={styles.dropdown}
                textStyle={{ fontSize: 20 }}
              />
            </View>

            <TouchableOpacity
              style={styles.searchButton}
              onPress={handleOnlineSearch}
              disabled={isSearching}
            >
              {isSearching ? <ActivityIndicator color="#fff" /> : <Text style={styles.searchButtonText}>ค้นหา</Text>}
            </TouchableOpacity>

            <FlatList
              data={searchResults}
              keyExtractor={(item, index) => index.toString()}
              style={styles.resultList}
              renderItem={({ item }) => {
                if (!item) return null;
                const reg = item.register || {};
                const hasC7Data = !!(reg.station && reg.province);
                return (
                  <View style={styles.resultItem}>
                    {/* Show image if photo_url exists */}
                    {item.photo_url ? (
                      <TouchableOpacity onPress={() => {
                        setSelectedSearchImage(item.photo_url);
                        setSearchImageModalVisible(true);
                      }}>
                        <Image
                          source={{ uri: item.photo_url }}
                          style={{ width: '100%', height: 100, borderRadius: 10, marginBottom: 10, alignSelf: 'center' }}
                          resizeMode="center"
                        />
                      </TouchableOpacity>
                    ) : null}
                    <View style={styles.resultRow}>
                      <Text style={styles.resultLabel}>จุดออกรถ:</Text>
                      <Text style={styles.resultValue}>{reg.station || '--'}</Text>
                    </View>
                    <View style={styles.resultRow}>
                      <Text style={styles.resultLabel}>จังหวัด:</Text>
                      <Text style={styles.resultValue}>{reg.province || '--'}</Text>
                    </View>
                    <View style={styles.resultRow}>
                      <Text style={styles.resultLabel}>ประเภทรถ:</Text>
                      <Text style={styles.resultValue}>{item.bus_type || reg.bus_type || '--'}</Text>
                    </View>

                    <View style={styles.resultRow}>
                      <Text style={styles.resultLabel}>เลขสติกเกอร์:</Text>
                      <Text style={styles.resultValue}>{item.sticker_no || '--'}</Text>
                    </View>
                    <View style={styles.resultRow}>
                      <Text style={styles.resultLabel}>เวลาลงทะเบียน:</Text>
                      <Text style={styles.resultValue}>
                        {item.check_in_at ? new Date(item.check_in_at).toLocaleDateString('th-TH-u-ca-buddhist', {
                          year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                        }) : '--'}
                      </Text>
                    </View>
                    <View style={styles.resultRow}>
                      <Text style={styles.resultLabel}>ผู้ลงทะเบียน:</Text>
                      <Text style={styles.resultValue}>{item.check_in_by || '--'}</Text>
                    </View>
                    {/* แจ้งเตือนถ้า printed เป็น true */}
                    {item.printed === true && (
                      <View style={{ marginTop: 8, marginBottom: 4 }}>
                        <Text style={{ color: 'red', fontWeight: 'bold', fontSize: 16, textAlign: 'center' }}>สลิปนี้ถูกพิมพ์ไปแล้ว</Text>
                      </View>
                    )}
                    {/* แจ้งเตือนถ้าไม่มี C7 ข้อมูล */}
                    {!hasC7Data && (
                      <View style={{ marginTop: 8, marginBottom: 8, backgroundColor: '#fff3cd', borderColor: '#ffc107', borderWidth: 1, borderRadius: 8, padding: 10 }}>
                        <Text style={{ color: 'red', fontWeight: 'bold', fontSize: 16, textAlign: 'center' }}>⚠️ ไม่มี C7 ไม่สามารถพิมพ์สลิปได้</Text>
                      </View>
                    )}
                    {item.can_print === true && hasC7Data && (
                      <TouchableOpacity
                        style={[styles.printButton, printLoading && { opacity: 0.6 }]}
                        onPress={() => handlePrint(item)}
                        disabled={printLoading}
                      >
                        {printLoading ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <Text style={styles.printButtonText}>พิมพ์สลิป</Text>
                        )}
                      </TouchableOpacity>
                    )}
                  </View>
                );
              }}
            />

            <TouchableOpacity
              style={styles.closeModalButton}
              onPress={() => {
                if (printLoading) return; // Prevent closing while printing
                setSearchModalVisible(false);
                setSearchPlateNo('');
                setSearchProvince('');
                setSearchResults([]);
              }}
              disabled={printLoading}
            >
              <Text style={styles.closeModalButtonText}>ปิด</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ✅ ADD: Hidden Receipt for printing */}
      {printData && (
        <View style={{ position: 'absolute', left: -10000 }}>
          <ViewShot ref={receiptRef} style={{ backgroundColor: '#fff' }}>
            <Receipt
              machineCode={printData.comp_id || ''}
              registerId={printData.register_id}
              projectName={activeProject?.name}
              showActivity2={printData.show_activity2 || 0}
              licensePlate={printData.plate_no}
              province={printData.plate_province}
              vehicleType={printData.bus_type}
              stationName={printData.register?.station || printData.station_name}
              stationProvince={printData.register?.province || printData.station_province}
              passenger={printData.register?.passenger || printData.passenger}
              date={new Date(printData.check_in_at || printData.created_at).toLocaleDateString('th-TH-u-ca-buddhist', {
                year: 'numeric', month: '2-digit', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
              register={printData.register}
            />
          </ViewShot>
        </View>
      )}
    </View >
  );
}

const styles = StyleSheet.create({

  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'flex-end',
    alignItems: 'center',
    padding: 0,
  },
  fullscreenImage: {
    width: '100%',
    height: '100%',
  },
  closeButton: {
    position: 'absolute',
    bottom: 50,
    right: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  chipText: {
    backgroundColor: '#3498db',
    color: '#fff',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontSize: 12,
    overflow: 'hidden',
    maxWidth: 50,
    textAlign: 'center',
    fontWeight: '500',
    marginLeft: 6,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 15,
    marginHorizontal: 10,
    marginTop: 10,
    marginBottom: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e9ecef',
    elevation: 1,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    height: 45, // เพิ่มความสูงเล็กน้อย
    fontSize: 16,
    color: '#333',
  },

  // --- New Styles ---
  searchModalContent: {
    width: '100%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    alignItems: 'center',
    maxHeight: '100%',
    minHeight: '80%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  input: {
    width: '100%',
    height: 50,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    paddingHorizontal: 15,
    marginBottom: 15,
    fontSize: 20,
  },
  dropdown: {
    borderColor: '#ccc',
    borderRadius: 10,
  },
  searchButton: {
    width: '100%',
    backgroundColor: '#2ecc71',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 0,
  },
  searchButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  resultList: {
    width: '100%',
    marginVertical: 10,
  },
  resultItem: {
    backgroundColor: '#f8f9fa',
    padding: 10,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#eee',
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  resultLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  resultValue: {
    fontSize: 16,
    color: '#555',
    textAlign: 'right',
    flex: 1,
    marginLeft: 10,
  },
  resultText: {
    fontSize: 16,
    marginBottom: 5,
  },
  printButton: {
    backgroundColor: '#e67e22',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  printButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  closeModalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    margin: 16,
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FFCDD2',
    width: '100%',
  },
  closeModalButtonText: {
    color: '#e74c3c',
    fontSize: 16,
    fontWeight: 'bold',
  },
  receiptContainer: {
    width: 576,
    backgroundColor: '#fff',
    padding: 20,
  },
  receiptTitle: {
    fontSize: 30,
    fontWeight: 'bold',
    textAlign: 'center',
    marginVertical: 10,
  },
  receiptSubtitle: {
    fontSize: 24,
    textAlign: 'center',
    marginBottom: 10,
  },
  divider: {
    borderBottomWidth: 2,
    borderBottomColor: '#000',
    marginVertical: 10,
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  receiptLabel: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  receiptValue: {
    fontSize: 24,
  },
  textCenter: {
    textAlign: 'center',
    fontSize: 24,
  },

});