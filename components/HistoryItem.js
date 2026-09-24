import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';
import { explainError, formatPassengerInfo, syncStateOf } from '../utils/checkInFormat';

// สีที่ต้องส่งเป็น prop ให้ Ionicons — component ตัวนี้รับ color เป็นค่า ไม่ใช่ className
// ค่าต้องตรงกับ token ใน tailwind.config.js
const ICON_SEARCH = '#1a6296';   // primary-ink
const ICON_DANGER = '#8f2020';   // danger-ink

const HistoryItem = ({ item, openImageModal, onQuickSearch, onOpenDetail }) => {
  if (!item) return null;

  const passengerText = formatPassengerInfo(item.passenger);
  const createdAtDate = item.created_at ? new Date(item.created_at) : null;
  const displayTime = createdAtDate && !isNaN(createdAtDate.getTime())
    ? createdAtDate.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.'
    : 'เวลาไม่ถูกต้อง';
  const sync = syncStateOf(item.sync_status);
  const errorText = explainError(item.error_msg);

  return (
    // ✅ แตะตรงไหนของการ์ดก็ได้ → หน้ารายละเอียด
    //    รูปกับปุ่มแว่นขยายข้างในยังทำงานของตัวเองเหมือนเดิม เพราะ touchable ชั้นในสุดได้สัมผัสก่อน
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => onOpenDetail && onOpenDetail(item)}
      accessibilityRole="button"
      accessibilityLabel={`ดูรายละเอียด ${item.plate_no || ''}`}
      className="mx-[14px] my-1 overflow-hidden rounded-[11px] border border-border bg-surface"
    >

      <View className="flex-row gap-[10px] p-[10px]">

        {/* ── ซ้าย: รูปทะเบียน + ป้ายไม่พบ C7 ── */}
        <View className="w-24 gap-[5px]">
          <TouchableOpacity
            onPress={() => openImageModal(item.photo_path)}
            accessibilityLabel="ดูรูปเต็มจอ"
          >
            {item.photo_path ? (
              // ✅ height ตายตัว + resizeMode — เดิมใช้ minHeight แล้วไม่ตั้ง resizeMode
              //    รูปที่อัตราส่วนต่างกันจึงทำให้การ์ดสูงไม่เท่ากันทั้งลิสต์
              <Image
                source={{ uri: item.photo_path }}
                resizeMode="cover"
                // ไม่เฟดรูปเข้า (ค่าเริ่มต้นบน Android 300 ms) — ตอนปัดเร็วการ์ดใหม่เข้าจอถี่ เฟดทุกใบเปลืองเปล่าๆ
                fadeDuration={0}
                className="h-[66px] w-24 rounded-[7px] border border-border bg-chip"
              />
            ) : (
              // รูปหายจากแคชของ ImagePicker — เกิดได้จริงกับแถวที่ค้างคิวนาน (ดู CLAUDE.md)
              // ทำให้เห็นชัดว่า "หาย" ไม่ใช่ปล่อยเป็นช่องว่างให้เดาเอง
              <View className="h-[66px] w-24 items-center justify-center rounded-[7px] border border-dashed border-warning bg-warning-bg">
                <Ionicons name="image-outline" size={20} color="#8c4a10" />
                <Text className="mt-[2px] text-[10px] font-bold text-warning-ink">รูปหาย</Text>
              </View>
            )}
          </TouchableOpacity>

          {!item.register_id && (
            <View className="flex-row items-center justify-center gap-1 rounded-md bg-danger px-[6px] py-1">
              <Ionicons name="alert-circle" size={11} color="#ffffff" />
              <Text className="text-[11px] font-bold text-white">ไม่พบ C7</Text>
            </View>
          )}
        </View>

        {/* ── ขวา: รายละเอียด (กว้างจริงราว 200dp) ── */}
        <View className="flex-1 gap-[6px]">

          <View className="flex-row items-start gap-[6px]">
            <View className="flex-1">
              <Text numberOfLines={1} className="text-[21px] font-bold leading-[24px] text-text">
                {item.plate_no || 'ไม่ระบุทะเบียน'}
              </Text>
              <Text numberOfLines={1} className="mt-[1px] text-[15px] font-medium text-text-muted">
                {(item.plate_province || 'ไม่ระบุจังหวัด')?.replace('กรุงเทพมหานคร', 'กทม.')}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => onQuickSearch && onQuickSearch(item.plate_no, item.plate_province)}
              accessibilityLabel="ค้นหาทะเบียนนี้บนเซิร์ฟเวอร์"
              className="h-[34px] w-[34px] items-center justify-center rounded-lg border border-border-strong bg-surface"
            >
              <Ionicons name="search" size={16} color={ICON_SEARCH} />
            </TouchableOpacity>
          </View>

          <View className="flex-row flex-wrap gap-[5px]">
            {!!item.bus_type && (
              <View className="rounded-[7px] bg-chip px-[7px] py-[3px]">
                <Text className="text-[12px] font-medium text-chip-ink">{item.bus_type}</Text>
              </View>
            )}
            {!!item.sticker_no && (
              <View className="rounded-[7px] bg-chip px-[7px] py-[3px]">
                <Text className="text-[12px] font-medium text-chip-ink">#{item.sticker_no}</Text>
              </View>
            )}
            {!!passengerText && (
              <View className="rounded-[7px] bg-chip px-[7px] py-[3px]">
                <Text className="text-[12px] font-medium text-chip-ink">{passengerText}</Text>
              </View>
            )}
          </View>

          <View className="flex-row items-center">
            <Text className="text-[12px] text-text-subtle">{displayTime}</Text>
            <View className="flex-1" />
            {/* ✅ เดิมเป็นไอคอนเปล่า (ติ๊กคู่ / เมฆ / สามเหลี่ยม) ซึ่งเดาความหมายไม่ออก
                ถ้าไม่มีคนบอก — เปลี่ยนเป็นจุดสีคู่กับคำ */}
            <View className={`flex-row items-center gap-1 rounded-[7px] px-2 py-[3px] ${sync.box}`}>
              <View className={`h-[6px] w-[6px] rounded-full ${sync.dot}`} />
              <Text className={`text-[12px] font-semibold ${sync.text}`}>{sync.label}</Text>
            </View>
          </View>

        </View>
      </View>

      {!!errorText && (
        <View className="flex-row gap-[7px] border-t border-danger-bg bg-danger-surface px-[10px] py-2">
          <Ionicons name="alert-circle" size={15} color={ICON_DANGER} style={{ marginTop: 1 }} />
          <Text className="flex-1 text-[12px] leading-[17px] text-danger-ink">{errorText}</Text>
        </View>
      )}

    </TouchableOpacity>
  );
};

export default React.memo(HistoryItem);
