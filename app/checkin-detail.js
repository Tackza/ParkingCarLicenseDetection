import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  Text,
  ToastAndroid,
  TouchableOpacity,
  View,
} from 'react-native';
import ImageViewerModal from '../components/ImageViewerModal';
import OnlineSearchModal from '../components/OnlineSearchModal';
import { getCheckInById, insertErrorLog, insertErrorLogThrottled, retryCheckInNow } from '../constants/Database';
import { useAuth } from '../contexts/AuthContext';
import {
  formatPassengerInfo,
  formatTime,
  fullProvince,
  isCompIdError,
  parseErrorMessage,
  parseLocalDateTime,
  shortProvince,
  syncStateOf,
} from '../utils/checkInFormat';

// รายละเอียดของ check-in หนึ่งแถว — เข้าจากการแตะการ์ดในหน้าหลัก
// อ่านจาก SQLite ในเครื่องเท่านั้น (ข้อมูลฝั่งเซิร์ฟเวอร์ดูผ่านปุ่ม "ค้นหาบนเซิร์ฟเวอร์")

// CheckInSyncManager เขียน sync_status ทุก 10 วินาที — อ่านใหม่ถี่กว่านั้นเล็กน้อยระหว่างเปิดหน้านี้
// ให้กด "ลองส่งใหม่" แล้วเห็นสถานะเปลี่ยนเองโดยไม่ต้องออกแล้วเข้าใหม่
const REFRESH_INTERVAL = 5000;

// Ionicons และ ActivityIndicator รับสีเป็นค่า ไม่ใช่ className — ค่าต้องตรงกับ token ใน tailwind.config.js
const ICON_TEXT = '#16181d';     // text
const ICON_SEARCH = '#1a6296';   // primary-ink
const ICON_ON_FILL = '#ffffff';
const TINT_PRIMARY = '#217cba';  // primary
const WARNING_INK = '#8c4a10';   // warning-ink
const DANGER_INK = '#8f2020';    // danger-ink

const TABS = [
  { key: 'info', label: 'ข้อมูล' },
  { key: 'sync', label: 'การส่ง' },
];

const TONE_DOT = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  idle: 'bg-icon-faint',
};

// เวลาที่เหลือก่อนรอบลองใหม่ของแถวที่ถูกถอยเวลา — ดู SYNC_RETRY_BACKOFF_MINUTES
const retryCountdown = (nextRetryAt, now) => {
  const at = parseLocalDateTime(nextRetryAt);
  if (!at) return 'รอบถัดไป';
  const minutes = Math.ceil((at.getTime() - now) / 60000);
  if (minutes <= 0) return 'รอบถัดไป';
  if (minutes < 60) return `อีก ${minutes} นาที`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `อีก ${hours} ชม. ${rest} นาที` : `อีก ${hours} ชม.`;
};

// ประวัติการส่งสร้างจากคอลัมน์ในแถวเท่านั้น — ไม่มีตารางเก็บประวัติจริง
// จึงมีเวลากำกับเฉพาะขั้นที่มีคอลัมน์เวลา (created_at, sync_at, next_retry_at)
// การพิมพ์และการส่งที่ล้มเหลวไม่มีเวลาเก็บไว้ ไม่เดาให้
const buildTimeline = (row, message, compIdProblem, now) => {
  const steps = [
    { title: 'บันทึกลงเครื่อง', time: formatTime(row.created_at), note: 'ข้อมูลอยู่ในเครื่อง ไม่หายแม้ปิดแอพ', tone: 'success' },
    row.printed == 1
      ? { title: 'พิมพ์สลิป', note: 'พิมพ์สำเร็จ', tone: 'success' }
      : { title: 'ยังไม่ได้พิมพ์สลิป', note: 'พิมพ์ไม่สำเร็จตอนบันทึก — พิมพ์ได้จากการค้นหาบนเซิร์ฟเวอร์ หลังรายการขึ้นระบบแล้ว', tone: 'warning' },
  ];

  switch (Number(row.sync_status)) {
    case 2:
      steps.push({ title: 'ส่งขึ้นเซิร์ฟเวอร์แล้ว', time: formatTime(row.sync_at), note: 'รายการนี้อยู่ในระบบแล้ว', tone: 'success' });
      break;
    case 3:
      // 3 = ปัญหาเครือข่าย/token — ไม่ถอยเวลา ส่งใหม่ทุกรอบ (ดู CLAUDE.md § sync_status)
      steps.push({ title: 'ส่งไม่สำเร็จ', note: message || 'เครือข่ายหรือเซิร์ฟเวอร์ขัดข้อง', tone: 'warning' });
      steps.push({ title: 'จะลองใหม่รอบถัดไป', note: 'ระบบลองเองทุก 10 วินาที ขณะที่จอยังเปิดอยู่', tone: 'idle' });
      break;
    case 4:
      steps.push({
        title: 'เซิร์ฟเวอร์ปฏิเสธ',
        note: [message, row.retry_count ? `ลองแล้ว ${row.retry_count} ครั้ง` : null].filter(Boolean).join(' · '),
        tone: 'danger',
      });
      steps.push({
        title: 'ถอยเวลาลองใหม่',
        time: retryCountdown(row.next_retry_at, now),
        note: compIdProblem ? 'ตั้งรหัสเครื่องแล้วระบบจะส่งทันที' : 'ระบบจะลองเองเรื่อยๆ ไม่ทิ้งรายการนี้',
        tone: 'idle',
      });
      break;
    default:
      steps.push({ title: 'รอส่งขึ้นเซิร์ฟเวอร์', note: 'ยังไม่ได้ลองส่ง — ระบบส่งเองในรอบถัดไป', tone: 'idle' });
  }
  return steps;
};

// อยู่นอก component — ถ้านิยามข้างใน React จะเห็นเป็นคนละชนิดทุกครั้งที่ render
// แล้ว mount หัวใหม่ทุก 5 วินาทีตามรอบอ่านซ้ำ ปุ่มย้อนกลับจะหลุดกลางการกด
const DetailHeader = ({ onBack, children }) => (
  <View className="flex-row items-center gap-2 border-b border-border px-3 py-[10px]">
    <TouchableOpacity
      onPress={onBack}
      accessibilityLabel="ย้อนกลับ"
      className="h-[38px] w-[38px] items-center justify-center rounded-lg"
    >
      <Ionicons name="chevron-back" size={22} color={ICON_TEXT} />
    </TouchableOpacity>
    {children}
  </View>
);

export default function CheckInDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { user } = useAuth();

  const [row, setRow] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [tab, setTab] = useState('info');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchPrefill, setSearchPrefill] = useState(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    try {
      setRow(await getCheckInById(Number(id)));
    } catch (error) {
      console.error('Error loading check-in detail:', error);
      // อยู่ในรอบอ่านซ้ำทุก 5 วินาที — ใช้ตัว throttled ตาม CLAUDE.md ไม่งั้นฐานพังทีเดียวได้ log หลายร้อยแถว
      await insertErrorLogThrottled({
        comp_id: null,
        error_type: 'DATABASE_ERROR',
        error_message: error.message || 'ไม่สามารถอ่านรายละเอียดได้',
        error_code: error.code || 'LOAD_CHECKIN_DETAIL_ERROR',
        page_name: 'checkin-detail.js',
        action_name: 'load',
        user_id: user?.id || null,
      });
    } finally {
      setNow(Date.now());
      setLoaded(true);
    }
  }, [id, user?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
      const timer = setInterval(load, REFRESH_INTERVAL);
      return () => clearInterval(timer);
    }, [load])
  );

  const handleRetry = async () => {
    if (!row || retrying) return;
    setRetrying(true);
    try {
      const changed = await retryCheckInNow(row.id);
      ToastAndroid.show(changed ? 'จะส่งใหม่ในรอบถัดไป' : 'รายการนี้ส่งสำเร็จแล้ว', ToastAndroid.SHORT);
      await load();
    } catch (error) {
      console.error('Error requesting retry:', error);
      await insertErrorLog({
        comp_id: row?.comp_id || null,
        error_type: 'DATABASE_ERROR',
        error_message: error.message || 'สั่งส่งใหม่ไม่สำเร็จ',
        error_code: error.code || 'RETRY_CHECKIN_ERROR',
        page_name: 'checkin-detail.js',
        action_name: 'handleRetry',
        user_id: user?.id || null,
      });
      Alert.alert('ข้อผิดพลาด', 'สั่งส่งใหม่ไม่สำเร็จ');
    } finally {
      setRetrying(false);
    }
  };

  // ไม่เช็ก isOnline ก่อนเปิด เหมือนที่หน้าหลักทำ — หน้านี้อยู่นอก (tabs) จึงอ่าน SyncProvider ชั้นนอก
  // ซึ่ง isOnline เป็น true ตลอด (ดู CLAUDE.md § SyncProvider is mounted twice)
  // ถ้าออฟไลน์ request จะล้มแล้ว OnlineSearchModal แจ้งเอง
  const openServerSearch = () => {
    if (!row) return;
    setSearchPrefill({ plate: row.plate_no, province: fullProvince(row.plate_province) });
    setSearchVisible(true);
  };

  if (!row) {
    return (
      <View className="flex-1 bg-surface">
        <View className="h-[25px] bg-black" />
        <DetailHeader onBack={() => router.back()}>
          <Text className="flex-1 text-[17px] font-bold text-text">รายละเอียด</Text>
        </DetailHeader>
        <View className="flex-1 items-center justify-center gap-[10px] px-6">
          {loaded ? (
            <Text className="text-center text-[15px] text-text-muted">ไม่พบรายการนี้ในเครื่อง</Text>
          ) : (
            <ActivityIndicator color={TINT_PRIMARY} />
          )}
        </View>
      </View>
    );
  }

  const sync = syncStateOf(row.sync_status);
  const message = parseErrorMessage(row.error_msg);
  const compIdProblem = isCompIdError(message);
  const compId = row.comp_id == null ? '' : String(row.comp_id).trim();
  // ลองส่งใหม่มีความหมายเฉพาะแถวที่ถูกปฏิเสธ (4) — แถว 0/3 ส่งเองทุกรอบอยู่แล้ว
  // และไม่มีประโยชน์ถ้ายังไม่มีรหัสเครื่อง เพราะจะถูกปฏิเสธด้วยเหตุเดิมทันที
  const canRetry = row.sync_status == 4 && compId !== '';
  const passengerText = formatPassengerInfo(row.passenger);
  const readMethod = row.ocr_connected == 0
    ? 'กรอกเอง (OCR ใช้ไม่ได้)'
    : row.is_plate_manual == 1 ? 'OCR แล้วแก้ด้วยมือ' : 'OCR';

  const spec = [
    { k: 'ประเภทรถ', v: row.bus_type || '—' },
    { k: 'เลขสติกเกอร์', v: row.sticker_no ? `#${row.sticker_no}` : '—' },
    { k: 'ผู้โดยสาร', v: passengerText || '— ไม่ได้บันทึก' },
    row.mileage ? { k: 'เลขไมล์', v: String(row.mileage) } : null,
    { k: 'อ่านทะเบียนด้วย', v: readMethod },
    // เก็บค่าที่ OCR อ่านได้ไว้คู่กับค่าที่แก้ — ดู CLAUDE.md § OCR
    row.ocr_connected != 0 && row.is_plate_manual == 1 && row.detect_plate_no
      ? { k: 'OCR อ่านได้', v: `${row.detect_plate_no} ${shortProvince(row.detect_plate_province)}`.trim() }
      : null,
    row.note ? { k: 'หมายเหตุ', v: row.note } : null,
    { k: 'รหัสเครื่อง', v: compId || '— ยังไม่ได้ตั้ง', danger: !compId },
  ].filter(Boolean);

  const timeline = buildTimeline(row, message, compIdProblem, now);

  return (
    <View className="flex-1 bg-surface">
      {/* แถบดำคลุมพื้นที่ status bar — ทุกหน้าในแอพมี เพราะ status bar โปร่งใสและเนื้อหาวางทับ */}
      <View className="h-[25px] bg-black" />

      <DetailHeader onBack={() => router.back()}>
        <Text numberOfLines={1} className="flex-1 text-[17px] font-bold text-text">{row.plate_no}</Text>
        <View className={`flex-row items-center gap-1 rounded-[7px] px-[9px] py-1 ${sync.box}`}>
          <View className={`h-[6px] w-[6px] rounded-full ${sync.dot}`} />
          <Text className={`text-[12px] font-semibold ${sync.text}`}>{sync.label}</Text>
        </View>
      </DetailHeader>

      {/* ── สรุป: รูป + ทะเบียน ── */}
      <View className="px-[14px] pt-3">
        <View className="flex-row items-center gap-3 rounded-[11px] border border-border p-3">
          {row.photo_path ? (
            <TouchableOpacity onPress={() => setViewerOpen(true)} accessibilityLabel="ดูรูปเต็มจอ">
              <Image
                source={{ uri: row.photo_path }}
                resizeMode="cover"
                className="h-[72px] w-[104px] rounded-lg border border-border bg-chip"
              />
            </TouchableOpacity>
          ) : (
            <View className="h-[72px] w-[104px] items-center justify-center rounded-lg border border-dashed border-warning bg-warning-bg">
              <Ionicons name="image-outline" size={20} color={WARNING_INK} />
              <Text className="mt-[2px] text-[10px] font-bold text-warning-ink">รูปหาย</Text>
            </View>
          )}
          <View className="flex-1">
            <Text numberOfLines={1} className="text-[22px] font-bold leading-[26px] text-text">{row.plate_no}</Text>
            <Text numberOfLines={1} className="mt-[1px] text-[15px] text-text-muted">{shortProvince(row.plate_province)}</Text>
            {!row.register_id && (
              <View className="mt-[6px] flex-row items-center gap-1 self-start rounded-md bg-danger px-[7px] py-[3px]">
                <Ionicons name="alert-circle" size={11} color={ICON_ON_FILL} />
                <Text className="text-[11px] font-bold text-white">ไม่พบ C7</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* ── แท็บ ── */}
      <View className="px-[14px] pt-3">
        <View className="flex-row gap-[3px] rounded-[9px] bg-fill p-[3px]">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <TouchableOpacity
                key={t.key}
                onPress={() => setTab(t.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                className={`flex-1 items-center rounded-md py-[7px] ${active ? 'bg-surface' : ''}`}
              >
                <Text className={`text-[13px] ${active ? 'font-semibold text-text' : 'text-text-muted'}`}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, gap: 11 }}>

        {/* แถบปัญหาอยู่เหนือแท็บทั้งสอง — เป็นสิ่งที่คนเปิดหน้านี้อยากรู้ก่อนอย่างอื่น */}
        {!!message && (
          <View className="flex-row items-start gap-[7px] rounded-[10px] border border-danger-bg bg-danger-surface px-[11px] py-[9px]">
            <Ionicons name="alert-circle-outline" size={16} color={DANGER_INK} style={{ marginTop: 1 }} />
            <View className="flex-1">
              <Text className="text-[13px] font-semibold leading-[18px] text-danger-ink">
                {compIdProblem
                  ? 'ยังไม่ได้ตั้งรหัสเครื่อง'
                  : row.sync_status == 4 ? 'เซิร์ฟเวอร์ปฏิเสธรายการนี้' : 'ส่งไม่สำเร็จ — จะลองใหม่เอง'}
              </Text>
              <Text className="mt-[2px] text-[12px] leading-[17px] text-danger-ink">
                {compIdProblem ? 'เซิร์ฟเวอร์ตอบ 422 — รายการนี้ยังไม่ขึ้นระบบ' : message}
              </Text>
            </View>
            {compIdProblem && (
              // navigate ไม่ใช่ push — push จากหน้าที่อยู่บน stack จะซ้อน (tabs) ชุดใหม่ขึ้นมาอีกชั้น
              <TouchableOpacity
                onPress={() => router.navigate('/settings')}
                className="h-[34px] self-center justify-center rounded-lg border border-danger/40 bg-surface px-[11px]"
              >
                <Text className="text-[12px] font-semibold text-danger-ink">ตั้งค่า</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {tab === 'info' ? (
          <View className="overflow-hidden rounded-[10px] border border-border">
            <Text className="border-b border-border px-3 py-[9px] text-[11px] font-bold tracking-[1px] text-text-subtle">รายละเอียด</Text>
            <View className="gap-2 px-3 py-[11px]">
              {spec.map((s) => (
                <View key={s.k} className="flex-row items-baseline gap-2">
                  <Text className="w-[108px] text-[14px] text-text-subtle">{s.k}</Text>
                  <Text className={`flex-1 text-right text-[14px] font-medium ${s.danger ? 'text-danger-ink' : 'text-text'}`}>{s.v}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : (
          <View className="overflow-hidden rounded-[10px] border border-border">
            <Text className="border-b border-border px-3 py-[9px] text-[11px] font-bold tracking-[1px] text-text-subtle">ประวัติการส่ง</Text>
            <View className="p-3">
              {timeline.map((s, i) => {
                const last = i === timeline.length - 1;
                return (
                  <View key={s.title} className="flex-row gap-[10px]">
                    <View className="w-[11px] items-center">
                      <View className={`mt-1 h-[9px] w-[9px] rounded-full ${TONE_DOT[s.tone]}`} />
                      {!last && <View className="my-[3px] w-[2px] flex-1 bg-border" />}
                    </View>
                    <View className={`flex-1 ${last ? '' : 'pb-3'}`}>
                      <View className="flex-row flex-wrap items-baseline gap-x-[7px]">
                        <Text className="text-[14px] font-semibold text-text">{s.title}</Text>
                        {!!s.time && <Text className="text-[12px] text-text-subtle">{s.time}</Text>}
                      </View>
                      {!!s.note && <Text className="mt-[1px] text-[13px] leading-[18px] text-text-muted">{s.note}</Text>}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>

      {/* ── ปุ่มล่าง ── */}
      <View className="flex-row gap-[9px] border-t border-border px-[14px] py-3">
        {/* ✅ แบบเขียนว่า "พิมพ์ซ้ำ" แต่แอพไม่ยอมให้พิมพ์สลิปที่พิมพ์แล้วซ้ำ (ดู handlePrint ใน OnlineSearchModal)
            และเซิร์ฟเวอร์เป็นคนนับจำนวนสลิป — ปุ่มนี้จึงเปิดการค้นหาบนเซิร์ฟเวอร์แทน
            ซึ่งจะมีปุ่มพิมพ์ให้เองเมื่อเซิร์ฟเวอร์บอกว่ายังพิมพ์ได้ */}
        <TouchableOpacity
          onPress={openServerSearch}
          activeOpacity={0.7}
          className="h-[50px] flex-1 flex-row items-center justify-center gap-[6px] rounded-[9px] border border-border-strong bg-surface"
        >
          <Ionicons name="search" size={17} color={ICON_SEARCH} />
          <Text className="text-[15px] font-semibold text-text">ค้นหาบนเซิร์ฟเวอร์</Text>
        </TouchableOpacity>

        {canRetry && (
          <TouchableOpacity
            onPress={handleRetry}
            disabled={retrying}
            activeOpacity={0.8}
            className={`h-[50px] flex-1 flex-row items-center justify-center gap-[6px] rounded-[9px] ${retrying ? 'bg-primary-muted' : 'bg-primary'}`}
          >
            {retrying ? (
              <ActivityIndicator color={ICON_ON_FILL} />
            ) : (
              <Ionicons name="refresh" size={17} color={ICON_ON_FILL} />
            )}
            <Text className="text-[15px] font-semibold text-white">ลองส่งใหม่</Text>
          </TouchableOpacity>
        )}
      </View>

      <ImageViewerModal uri={row.photo_path} visible={viewerOpen} onClose={() => setViewerOpen(false)} />
      <OnlineSearchModal
        visible={searchVisible}
        prefill={searchPrefill}
        onClose={() => setSearchVisible(false)}
        onPrinted={load}
      />
    </View>
  );
}
