import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Keyboard,
  Modal,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { BluetoothEscposPrinter } from 'react-native-bluetooth-escpos-printer';
import DropDownPicker from 'react-native-dropdown-picker';
import ViewShot, { captureRef } from 'react-native-view-shot';
import { getActiveSession, insertErrorLog } from '../constants/Database';
import { THAI_PROVINCES } from '../constants/provinces';
import { useAuth } from '../contexts/AuthContext';
import { useEnvironment } from '../contexts/EnvironmentContext';
import { useProject } from '../contexts/ProjectContext';
import { shortProvince } from '../utils/checkInFormat';
import ImageViewerModal from './ImageViewerModal';
import Receipt from './Receipt';

// Ionicons, ActivityIndicator และ DropDownPicker รับสีเป็นค่า ไม่ใช่ className
// ค่าต้องตรงกับ token ใน tailwind.config.js
const ICON_TEXT = '#16181d';     // text
const ICON_MUTED = '#6e7580';    // text-subtle
const ICON_FAINT = '#8f959e';    // icon-faint
const ICON_ON_FILL = '#ffffff';
const TINT_PRIMARY = '#217cba';  // primary
const WARNING_INK = '#8c4a10';   // warning-ink
const DANGER_INK = '#8f2020';    // danger-ink

// DropDownPicker ไม่รับ className — ตกแต่งกล่องตอนปิดให้เหมือนช่องกรอกข้างบน
// ส่วนรายการจังหวัดที่เปิดเป็น Modal คงขนาดตัวอักษร 20 ไว้ตามเดิม (textStyle)
// เพราะเป็นรายการ 77 จังหวัดที่ต้องแตะเลือกให้ถูก ตัวใหญ่ดีกว่า
const DROPDOWN_BOX = {
  minHeight: 44,
  height: 44,
  borderColor: '#d5d9de',        // border-strong
  borderRadius: 9,
  paddingHorizontal: 12,
  backgroundColor: '#ffffff',
};
const DROPDOWN_LABEL = { fontSize: 15, color: ICON_TEXT };
const DROPDOWN_PLACEHOLDER = { fontSize: 15, color: ICON_MUTED };

/**
 * ค้นหาการลงทะเบียนบนเซิร์ฟเวอร์ (GET /lpr/checkins/search) และพิมพ์สลิปผ่าน print-slip
 *
 * เดิมอยู่ใน main.js ทั้งก้อน — ยกออกมาเพราะหน้ารายละเอียดต้องเปิดตัวเดียวกัน
 * ถ้าทำสำเนาการพิมพ์ชุดที่สอง กติกาว่าใครพิมพ์ได้เมื่อไหร่จะแยกเป็นสองที่
 *
 * @param {boolean}  visible
 * @param {{plate: string, province: string}|null} prefill - มีค่า = เติมให้และค้นหาทันที
 *                   (province ต้องเป็นชื่อเต็มตาม THAI_PROVINCES — ดู fullProvince)
 * @param {Function} onClose
 * @param {Function} onPrinted - เรียกหลังพิมพ์สำเร็จ ให้หน้าที่เปิดไว้อ่านข้อมูลใหม่
 */
const OnlineSearchModal = ({ visible, prefill, onClose, onPrinted }) => {
  const { environment } = useEnvironment();
  const { activeProject } = useProject();
  const { user } = useAuth();

  const [searchPlateNo, setSearchPlateNo] = useState('');
  const [searchProvince, setSearchProvince] = useState('');
  const [provinceOpen, setProvinceOpen] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  // ✅ แยก "ยังไม่ได้ค้น" ออกจาก "ค้นแล้วไม่เจอ" — เดิมกรณีหลังเด้ง Alert ทับ Modal อีกชั้น
  const [hasSearched, setHasSearched] = useState(false);
  const [printData, setPrintData] = useState(null);
  const [printLoading, setPrintLoading] = useState(false);
  const [viewerImage, setViewerImage] = useState(null);
  const receiptRef = useRef();

  const resetQuery = () => {
    setSearchPlateNo('');
    setSearchProvince('');
    setSearchResults([]);
    setHasSearched(false);
  };

  // ✅ ปุ่มย้อนกลับกับปุ่ม back ของเครื่องทำเหมือนกัน
  //    เดิมปุ่ม back ของเครื่องปิดได้แม้กำลังพิมพ์ และไม่ล้างคำค้น เปิดใหม่จึงเห็นผลเก่าค้างอยู่
  const handleClose = () => {
    if (printLoading) return;
    resetQuery();
    onClose && onClose();
  };

  // ✅ Internal function สำหรับ API call
  const handleOnlineSearchInternal = async (plateNo, province) => {

    setIsSearching(true);
    setSearchResults([]);
    setHasSearched(false);

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

      if (response.data && response.data.status === 'success' && response.data.result) {
        console.log('Search Results Data:', response.data.result);
        // ตรวจสอบว่าเป็น Array หรือไม่ ถ้าไม่ใช่ให้แปลงเป็น Array
        const results = Array.isArray(response.data.result) ? response.data.result : [response.data.result];
        setSearchResults(results);
        // ปิดคีย์บอร์ดเมื่อค้นหาเจอข้อมูล
        Keyboard.dismiss();
      } else {
        setSearchResults([]);
      }
      setHasSearched(true);
    } catch (error) {
      console.error('Search error:', error);

      // Log error to database
      await insertErrorLog({
        comp_id: null,
        error_type: 'API_ERROR',
        error_message: error.message || 'เกิดข้อผิดพลาดในการค้นหา',
        error_code: error.response?.status || error.code || 'SEARCH_ERROR',
        page_name: 'OnlineSearchModal.js',
        action_name: 'handleOnlineSearch',
        user_id: user?.id || null
      });

      Alert.alert('ข้อผิดพลาด', error.message || 'เกิดข้อผิดพลาดในการค้นหา');
    } finally {
      setIsSearching(false);
    }
  };

  const handleOnlineSearch = () => {
    // varidate inputs
    if (searchPlateNo.trim() === '' || searchProvince.trim() === '') {
      Alert.alert('แจ้งเตือน', 'กรุณากรอกทะเบียนรถและเลือกจังหวัด');
      return;
    }
    if (!activeProject) return;

    handleOnlineSearchInternal(searchPlateNo, searchProvince);
  };

  // เปิดมาพร้อมทะเบียน (จากแว่นขยายบนการ์ด หรือจากหน้ารายละเอียด) → เติมให้แล้วค้นหาเลย
  // หน่วง 300 มิลลิวินาทีเหมือนเดิม ให้ Modal เลื่อนขึ้นเสร็จก่อนยิง request
  useEffect(() => {
    if (!visible || !prefill?.plate || !prefill?.province) return;
    setSearchPlateNo(prefill.plate);
    setSearchProvince(prefill.province);
    const timer = setTimeout(() => {
      handleOnlineSearchInternal(prefill.plate, prefill.province);
    }, 300);
    return () => clearTimeout(timer);
  }, [visible, prefill]);

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

          // ปิดหน้าค้นหาหลังพิมพ์เสร็จ แล้วให้หน้าที่เปิดไว้อ่านสถานะใหม่
          resetQuery();
          onClose && onClose();
          onPrinted && onPrinted();
        } catch (error) {
          console.error('Print error after API success:', error);

          // Log error to database
          await insertErrorLog({
            comp_id: item?.comp_id || null,
            error_type: 'PRINT_ERROR',
            error_message: error.message || 'ไม่สามารถพิมพ์ได้',
            error_code: error.code || 'BLUETOOTH_PRINT_ERROR',
            page_name: 'OnlineSearchModal.js',
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
        page_name: 'OnlineSearchModal.js',
        action_name: 'handlePrint - API call',
        user_id: user?.id || null
      });

      // ✅ ไม่แสดง alert เมื่อมี error จาก API (ลอง handle gracefully)
      console.log('Continuing with print attempt despite API error');
      setPrintData(null);
      setPrintLoading(false);
    }
  };

  const renderResult = ({ item }) => {
    if (!item) return null;
    const reg = item.register || {};
    const hasC7Data = !!(reg.station && reg.province);
    const busType = item.bus_type || reg.bus_type;
    // ✅ ปุ่มพิมพ์ต้องตรงกับเงื่อนไขที่ handlePrint ยอมทำจริง
    //    เดิมขึ้นเมื่อ can_print อย่างเดียว แถวที่พิมพ์ไปแล้วจึงมีปุ่มที่กดแล้วเงียบ
    //    (handlePrint ตีกลับทันทีเมื่อ printed !== false) — แอพไม่ยอมให้พิมพ์ซ้ำโดยตั้งใจ
    const canPrint = item.can_print === true && hasC7Data && !!item.register_id && item.printed === false;
    const isPrintingThis = printLoading && printData === item;
    const fields = [
      { k: 'จุดออกรถ', v: reg.station || '--' },
      { k: 'จังหวัดต้นทาง', v: reg.province || '--' },
      {
        k: 'เวลาลงทะเบียน',
        v: item.check_in_at ? new Date(item.check_in_at).toLocaleDateString('th-TH-u-ca-buddhist', {
          year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        }) : '--',
      },
      { k: 'ผู้ลงทะเบียน', v: item.check_in_by || '--' },
    ];

    return (
      <View className="overflow-hidden rounded-[11px] border border-border bg-surface">
        {!!item.photo_url && (
          <TouchableOpacity onPress={() => setViewerImage(item.photo_url)} accessibilityLabel="ดูรูปเต็มจอ">
            <Image
              source={{ uri: item.photo_url }}
              resizeMode="cover"
              className="h-[132px] w-full border-b border-border bg-chip"
            />
          </TouchableOpacity>
        )}

        <View className="gap-[9px] px-3 py-[11px]">
          <View className="flex-row items-start gap-2">
            <View className="flex-1">
              <Text numberOfLines={1} className="text-[22px] font-bold leading-[26px] text-text">
                {item.plate_no || '--'}
              </Text>
              <Text numberOfLines={1} className="mt-[1px] text-[14px] font-medium text-text-muted">
                {shortProvince(item.plate_province) || '--'}
              </Text>
            </View>
            <View className="max-w-[150px] flex-row flex-wrap justify-end gap-1">
              {!!busType && (
                <View className="rounded-[7px] bg-chip px-[7px] py-[3px]">
                  <Text className="text-[12px] font-medium text-chip-ink">{busType}</Text>
                </View>
              )}
              {!!item.sticker_no && (
                <View className="rounded-[7px] bg-chip px-[7px] py-[3px]">
                  <Text className="text-[12px] font-medium text-chip-ink">#{item.sticker_no}</Text>
                </View>
              )}
            </View>
          </View>

          <View className="h-px bg-border" />

          <View className="gap-[6px]">
            {fields.map((f) => (
              <View key={f.k} className="flex-row items-baseline gap-2">
                <Text className="w-24 text-[13px] text-text-subtle">{f.k}</Text>
                <Text className="flex-1 text-right text-[14px] font-medium text-text">{f.v}</Text>
              </View>
            ))}
          </View>

          {item.printed === true && (
            <View className="flex-row items-start gap-[7px] rounded-[9px] border border-warning-bg bg-warning-bg px-[11px] py-[9px]">
              <Ionicons name="checkmark-circle-outline" size={15} color={WARNING_INK} style={{ marginTop: 1 }} />
              <Text className="flex-1 text-[12px] leading-[17px] text-warning-ink">
                สลิปใบนี้พิมพ์ไปแล้ว — พิมพ์ซ้ำจากหน้านี้ไม่ได้
              </Text>
            </View>
          )}

          {!hasC7Data && (
            <View className="flex-row items-start gap-[7px] rounded-[9px] border border-danger-bg bg-danger-bg px-[11px] py-[9px]">
              <Ionicons name="alert-circle-outline" size={15} color={DANGER_INK} style={{ marginTop: 1 }} />
              <Text className="flex-1 text-[12px] leading-[17px] text-danger-ink">
                ไม่มีใบ C7 จึงพิมพ์สลิปไม่ได้ — สลิปต้องใช้จุดออกรถกับจังหวัดต้นทางจากใบ C7
              </Text>
            </View>
          )}

          {canPrint && (
            <View className="gap-[6px]">
              <TouchableOpacity
                onPress={() => handlePrint(item)}
                disabled={printLoading}
                activeOpacity={0.8}
                className={`h-12 flex-row items-center justify-center gap-[7px] rounded-[9px] ${printLoading ? 'bg-primary-muted' : 'bg-primary'}`}
              >
                {isPrintingThis ? (
                  <ActivityIndicator color={ICON_ON_FILL} />
                ) : (
                  <Ionicons name="print-outline" size={18} color={ICON_ON_FILL} />
                )}
                <Text className="text-[16px] font-semibold text-white">
                  {isPrintingThis ? 'กำลังพิมพ์…' : 'พิมพ์สลิป'}
                </Text>
              </TouchableOpacity>
              {isPrintingThis && (
                <Text className="text-center text-[12px] text-text-subtle">ปิดหน้านี้ไม่ได้จนกว่าจะพิมพ์เสร็จ</Text>
              )}
            </View>
          )}
        </View>
      </View>
    );
  };

  const renderBody = () => {
    if (isSearching) {
      return (
        <View className="mx-[14px] mt-[10px] items-center gap-[9px] rounded-[11px] border border-border px-3 py-[22px]">
          <ActivityIndicator color={TINT_PRIMARY} />
          <Text className="text-[14px] text-text-muted">กำลังถามเซิร์ฟเวอร์…</Text>
        </View>
      );
    }

    if (hasSearched && searchResults.length === 0) {
      return (
        <View className="mx-[14px] mt-[10px] items-center gap-2 rounded-[11px] border border-border px-[14px] py-5">
          <Ionicons name="search-outline" size={30} color={ICON_FAINT} />
          <Text className="text-[15px] font-semibold text-text">ไม่พบทะเบียนนี้ในกิจกรรม</Text>
          <Text className="text-center text-[12px] leading-[18px] text-text-muted">
            ลองตรวจตัวอักษรกับจังหวัดอีกครั้ง — หรือยังไม่มีเครื่องไหนส่งรายการของรถคันนี้ขึ้นมา
          </Text>
        </View>
      );
    }

    return (
      <FlatList
        data={searchResults}
        keyExtractor={(item, index) => (item?.uid || index).toString()}
        renderItem={renderResult}
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={() => <View className="h-[10px]" />}
        ListHeaderComponent={
          searchResults.length > 0 ? (
            <Text className="pb-[6px] pt-[10px] text-[12px] text-text-subtle">
              พบ {searchResults.length} รายการ
            </Text>
          ) : null
        }
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 16 }}
      />
    );
  };

  return (
    <>
      <Modal animationType="slide" visible={visible} onRequestClose={handleClose}>
        <View className="flex-1 bg-surface">

          {/* ── หัวเรื่อง ── */}
          <View className="flex-row items-center gap-2 border-b border-border px-3 py-[10px]">
            <TouchableOpacity
              onPress={handleClose}
              disabled={printLoading}
              accessibilityLabel="ปิด"
              className="h-9 w-9 items-center justify-center rounded-lg"
            >
              <Ionicons name="chevron-back" size={22} color={printLoading ? ICON_FAINT : ICON_TEXT} />
            </TouchableOpacity>
            <View className="flex-1">
              <Text className="text-[17px] font-bold text-text">ค้นหาจากเซิร์ฟเวอร์</Text>
              {/* บอกความต่างจากช่องค้นหาในหน้าหลัก ซึ่งกรองเฉพาะรายการของเครื่องนี้ */}
              <Text className="mt-[1px] text-[12px] text-text-subtle">ข้อมูลจากทุกเครื่อง ไม่ใช่เฉพาะเครื่องนี้</Text>
            </View>
          </View>

          {/* ── คำค้น ── */}
          <View className="gap-2 px-[14px] pt-3">
            <View className="flex-row gap-2">
              <TextInput
                value={searchPlateNo}
                onChangeText={setSearchPlateNo}
                placeholder="กรอกทะเบียนรถ"
                placeholderTextColor={ICON_MUTED}
                returnKeyType="search"
                onSubmitEditing={handleOnlineSearch}
                className="h-11 flex-1 rounded-[9px] border border-border-strong bg-surface px-3 py-0 text-[17px] font-semibold text-text"
              />
              <TouchableOpacity
                onPress={handleOnlineSearch}
                disabled={isSearching || printLoading}
                accessibilityLabel="ค้นหา"
                className={`h-11 w-11 items-center justify-center rounded-[9px] ${isSearching || printLoading ? 'bg-primary-muted' : 'bg-primary'}`}
              >
                <Ionicons name="search" size={19} color={ICON_ON_FILL} />
              </TouchableOpacity>
            </View>

            <DropDownPicker
              open={provinceOpen}
              value={searchProvince}
              items={THAI_PROVINCES}
              setOpen={setProvinceOpen}
              setValue={setSearchProvince}
              searchable={true}
              placeholder="เลือกจังหวัด"
              listMode="MODAL"
              style={DROPDOWN_BOX}
              textStyle={{ fontSize: 20 }}
              labelStyle={DROPDOWN_LABEL}
              placeholderStyle={DROPDOWN_PLACEHOLDER}
              ArrowDownIconComponent={() => <Ionicons name="chevron-down" size={16} color={ICON_MUTED} />}
              ArrowUpIconComponent={() => <Ionicons name="chevron-up" size={16} color={ICON_MUTED} />}
            />
          </View>

          <View className="flex-1">{renderBody()}</View>
        </View>
      </Modal>

      {/* sibling ของ Modal ค้นหาเหมือนโครงเดิมใน main.js — ไม่ซ้อน Modal ไว้ใน Modal */}
      <ImageViewerModal uri={viewerImage} visible={!!viewerImage} onClose={() => setViewerImage(null)} />

      {/* สลิปที่จะพิมพ์ — วางไว้นอกจอ และต้องอยู่นอก Modal เหมือนเดิม
          captureRef จับภาพ view ในหน้าต้นทางมาตลอด ไม่ได้พิสูจน์ว่าจับใน Modal ได้ */}
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
    </>
  );
};

export default OnlineSearchModal;
