import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Keyboard,
  RefreshControl,
  Text,
  TextInput,
  ToastAndroid,
  TouchableOpacity,
  View,
} from 'react-native';
// import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
// import CheckInSyncManager from '../../components/CheckInSyncManager';
import HistoryItem from '../../components/HistoryItem';
import ImageViewerModal from '../../components/ImageViewerModal';
import OnlineSearchModal from '../../components/OnlineSearchModal';
import { getScanHistory, getScopeId, getSetting, insertErrorLog } from '../../constants/Database';
import { useAuth } from '../../contexts/AuthContext';
import { useMode } from '../../contexts/ModeContext';
import { useProject } from '../../contexts/ProjectContext';
import { usePrinter } from '../../contexts/PrinterContext';
import { useSync } from '../../contexts/SyncContext';
import { fullProvince } from '../../utils/checkInFormat';

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


// ✅ โหลดทีละหน้า แล้วเพิ่มอีกหน้าเมื่อเลื่อนใกล้ท้ายลิสต์ (เดิมตัดไว้ 5 แถวตายตัว)
//    30 การ์ดยาวราว 6 จอบน V3 — พอให้ปัดดูต่อเนื่องโดยไม่ต้องรอโหลดบ่อย
const HISTORY_PAGE_SIZE = 30;

// ฟิลด์ที่การ์ดแสดง หรือที่เปลี่ยนได้หลังบันทึก (sync_status, printed, error_msg)
const rowSignature = (r) =>
  `${r.id}|${r.sync_status}|${r.printed}|${r.error_msg || ''}|${r.plate_no}|${r.plate_province}|` +
  `${r.bus_type}|${r.sticker_no || ''}|${r.passenger}|${r.photo_path || ''}|${r.register_id || ''}`;

// ✅ รวมผลรอบใหม่เข้ากับของเดิม — แถวที่ไม่เปลี่ยนคืน object ตัวเดิม
//    เดิมถ้ามีแถวไหนเปลี่ยนแม้แถวเดียว (sync เปลี่ยนสถานะทุก 10 วินาที) จะได้ array ใหม่ที่ทุกแถว
//    เป็น object ใหม่ React.memo ของการ์ดจึงข้ามไม่ได้สักใบ ทุกรอบรีเฟรชการ์ดทุกใบที่ mount อยู่ render ใหม่หมด
//    — นี่คือเหตุที่โหลดเยอะแล้วเครื่องช้า ไม่ใช่จำนวนแถวเอง
//    ถ้าไม่มีอะไรเปลี่ยนเลยคืน prev ตัวเดิม FlatList จะไม่ทำอะไรในรอบนั้น
const mergeHistory = (prev, next) => {
  const prevById = new Map(prev.map((r) => [r.id, r]));
  let changed = prev.length !== next.length;
  const merged = next.map((row, i) => {
    const old = prevById.get(row.id);
    const kept = old && rowSignature(old) === rowSignature(row) ? old : row;
    if (kept !== prev[i]) changed = true;
    return kept;
  });
  return changed ? merged : prev;
};

const keyExtractor = (item) => String(item.id);

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

  // ค้นหาบนเซิร์ฟเวอร์ — ตัว modal ถือ state การค้นหาและการพิมพ์ของมันเอง (components/OnlineSearchModal.js)
  // หน้านี้บอกแค่ว่าเปิดไหม และเปิดมาพร้อมทะเบียนอะไร
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [searchPrefill, setSearchPrefill] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [machineCode, setMachineCode] = useState(null);
  // ขนาดหน้าต่างของลิสต์ — มี ref คู่ไว้ให้ timer รีเฟรชอ่านค่าล่าสุดโดยไม่ต้องตั้ง timer ใหม่
  const [listLimit, setListLimit] = useState(HISTORY_PAGE_SIZE);
  const listLimitRef = useRef(HISTORY_PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const { user } = useAuth();

  // ✅ แว่นขยายบนการ์ด → เปิดค้นหาบนเซิร์ฟเวอร์พร้อมเติมทะเบียนและค้นหาให้เลย
  //    useCallback เพราะส่งเข้าการ์ดทุกใบ — ฟังก์ชันใหม่ทุก render ทำให้ React.memo ของการ์ดไม่มีผล
  const handleQuickSearch = useCallback((plateNo, province) => {
    if (!plateNo || !province) {
      Alert.alert('ข้อมูลไม่ครบ', 'กรุณาตรวจสอบข้อมูลทะเบียนและจังหวัด');
      return;
    }
    // check-in เก็บ กทม. แบบย่อ แต่ dropdown/THAI_PROVINCES ใช้ชื่อเต็ม จึงต้องแปลงให้ตรงกัน
    setSearchPrefill({ plate: plateNo, province: fullProvince(province) });
    setSearchModalVisible(true);
  }, []);

  // ✅ แตะการ์ด → หน้ารายละเอียด (app/checkin-detail.js)
  //    push ได้เพราะเป็นการซ้อนหน้าใหม่บน stack จริงๆ — ต่างจากการกลับไปแท็บ ซึ่งต้องใช้ navigate
  const handleOpenDetail = useCallback((item) => {
    if (!item?.id) return;
    router.push({ pathname: '/checkin-detail', params: { id: String(item.id) } });
  }, [router]);

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
      listLimitRef.current = HISTORY_PAGE_SIZE; // เริ่มจากหน้าแรกใหม่
      setListLimit(HISTORY_PAGE_SIZE);
      loadHistory('', HISTORY_PAGE_SIZE); // 👈 โหลดหน้าแรก (ล้าง searchQuery)
      setSearchQuery(''); // 👈 เคลียร์ช่องค้นหาด้วย
    }
  }, [activeProject]);

  // ✅ เก็บ ref ของ loadHistory และ searchQuery ล่าสุด
  //    timer ด้านล่างถูกตั้งครั้งเดียวตอน focus จึงต้องเรียกผ่าน ref ไม่งั้นจะติด closure เก่า
  //    (และถ้าใส่ searchQuery เป็น dependency ตรงๆ timer จะถูกตั้งใหม่ทุกครั้งที่พิมพ์)
  const loadHistoryRef = useRef(null);
  const searchQueryRef = useRef('');
  const historyLenRef = useRef(0);
  useEffect(() => {
    loadHistoryRef.current = loadHistory;
    searchQueryRef.current = searchQuery;
    historyLenRef.current = history.length;
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
        // อ่านใหม่เฉพาะหน้าต่างที่โหลดไว้ ไม่ใช่ทั้งตาราง
        loadHistoryRef.current?.(searchQueryRef.current || '', listLimitRef.current);
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

  const loadHistory = async (query, limit = listLimitRef.current) => {
    if (!activeProject) {
      setHistory([]);
      return;
    }
    try {
      // เลือก id ที่จะส่งเข้า getScanHistory ตามโหมด
      // ใช้ getScopeId เพื่อให้ "ค่า" ตรงกับ "คอลัมน์" ที่ getScanHistory เลือกเสมอ
      // และเพื่อให้ถอยไป project_id เองเมื่อกิจกรรมนั้นไม่มี activity_id
      const id = await getScopeId(activeProject);
      const data = await getScanHistory(id, query, limit);
      setHistory(prev => mergeHistory(prev, data));
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




  const openImageModal = useCallback((uri) => {
    setSelectedImage(uri);
    setModalVisible(true);
  }, []);

  // ✅ เลื่อนใกล้ท้ายลิสต์ → ขยายหน้าต่างอีกหนึ่งหน้า
  //    รอบล่าสุดได้แถวน้อยกว่าหน้าต่าง = ไม่มีเหลือแล้ว ต้องกันไว้ เพราะ onEndReached ยิงซ้ำได้
  //    (รวมถึงตอนลิสต์สั้นกว่าจอ) ไม่งั้นหน้าต่างขยายไปเรื่อยๆ โดยไม่มีข้อมูลเพิ่ม
  const handleLoadMore = useCallback(async () => {
    if (loadingMoreRef.current || historyLenRef.current < listLimitRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const next = listLimitRef.current + HISTORY_PAGE_SIZE;
    listLimitRef.current = next;
    setListLimit(next);
    try {
      await loadHistoryRef.current?.(searchQueryRef.current || '', next);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, []);


  // ค้นหาในเครื่อง — ช่องนี้ผูกกับ searchQuery ที่มีอยู่แล้วแต่ไม่มี UI มาก่อน
  //
  // หน่วง 250 มิลลิวินาทีก่อนยิง query จริง ไม่ให้ยิงทุกตัวอักษรที่พิมพ์
  // คำค้นใหม่เริ่มจากหน้าแรกเสมอ แล้วเลื่อนโหลดเพิ่มได้เหมือนลิสต์ปกติ
  const searchDebounceRef = useRef(null);
  const handleLocalSearch = (text) => {
    setSearchQuery(text);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      listLimitRef.current = HISTORY_PAGE_SIZE;
      setListLimit(HISTORY_PAGE_SIZE);
      loadHistoryRef.current?.(text, HISTORY_PAGE_SIZE);
    }, 250);
  };

  // กัน timer ค้างเมื่อออกจากหน้าไปกลางคัน
  useEffect(() => () => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
  }, []);

  // renderItem คงที่ + props คงที่ + object แถวเดิม = การ์ดที่ไม่เปลี่ยนไม่ render ใหม่
  const renderHistoryItem = useCallback(({ item }) => (
    <HistoryItem
      item={item}
      openImageModal={openImageModal}
      onQuickSearch={handleQuickSearch}
      onOpenDetail={handleOpenDetail}
    />
  ), [openImageModal, handleQuickSearch, handleOpenDetail]);

  // รอบล่าสุดได้เต็มหน้าต่าง = อาจยังมีเหลือ
  const hasMore = history.length >= listLimit;

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
            setSearchPrefill(null);
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
          keyExtractor={keyExtractor}
          renderItem={renderHistoryItem}
          // ✅ ค่าเริ่มต้นของ FlatList เก็บการ์ดไว้ราว 21 จอ (windowSize 21) — การ์ดละรูปหนึ่งใบ
          //    ลดเหลือ 7 จอ (3 จอบนและล่าง) ยังปัดลื่น แต่ mount การ์ดน้อยลงราวสามเท่า
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
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
            loadingMore ? (
              <View className="flex-row items-center justify-center gap-2 py-3">
                <ActivityIndicator size="small" color={TINT_PRIMARY} />
                <Text className="text-[12px] text-text-subtle">กำลังโหลดเพิ่ม…</Text>
              </View>
            ) : !hasMore && history.length > 0 ? (
              <Text className="px-[14px] pb-1 pt-2 text-center text-[12px] text-text-subtle">
                {searchQuery ? `พบ ${history.length} รายการ` : `ครบทั้งหมด ${history.length} รายการ`}
              </Text>
            ) : null
          }
        />
      </View>

      <ImageViewerModal uri={selectedImage} visible={modalVisible} onClose={() => setModalVisible(false)} />

      {/* ค้นหาบนเซิร์ฟเวอร์ + พิมพ์สลิป — สลิปที่จะพิมพ์ถูกวางนอกจอโดยตัว component เอง */}
      <OnlineSearchModal
        visible={searchModalVisible}
        prefill={searchPrefill}
        onClose={() => setSearchModalVisible(false)}
        onPrinted={() => loadHistory(searchQuery || '')}
      />
    </View>
  );
}
