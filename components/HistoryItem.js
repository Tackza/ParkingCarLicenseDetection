import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';



const formatPassengerInfo = (passengerString) => {
  if (!passengerString || typeof passengerString !== 'string') {
    return ''; // คืนค่าว่างถ้าไม่มีข้อมูล
  }
  const parts = passengerString.split('|');
  if (parts.length < 4) {
    return ''; // รูปแบบไม่ถูกต้อง
  }


  let textCount = '';

  const people = parseInt(parts[0] || 0) + parseInt(parts[1] || 0); // รวมผู้ใหญ่กับเด็ก
  const monks = parseInt(parts[2] || 0);
  const novices = parseInt(parts[3] || 0);

  if (people > 0) {
    textCount += `${people}คน`;
  }
  if (monks > 0) {
    textCount += `/${monks}รูป`;
  }
  if (novices > 0) {
    textCount += `/สณ${novices}รูป`;
  }
  return textCount || '-- คน';
};



// 1. รับ props ทั้งหมดที่จำเป็นเข้ามา: item, index, และฟังก์ชัน 2 ตัว
const HistoryItem = ({ item, index, numberPlate, openImageModal }) => {
  if (!item) return null;
  const passengerText = formatPassengerInfo(item.passenger);
  const createdAtDate = item.created_at ? new Date(item.created_at) : null;
  const displayTime = createdAtDate && !isNaN(createdAtDate.getTime())
    ? createdAtDate.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.'
    : 'เวลาไม่ถูกต้อง'; // แสดงข้อความ fallback


  return (
    <View style={styles.card}>
      {/* <View style={styles.cornerNumber}>
        <Text style={styles.cornerNumberText}>
          {typeof numberPlate === 'function' ? numberPlate(index) : item.id}
        </Text>
      </View> */}

      {/* ส่วนรูปภาพ Thumbnail */}
      <View style={styles.leftContainer}>
        <TouchableOpacity onPress={() => openImageModal(item.photo_path)}>
          {item.photo_path ? (
            <Image source={{ uri: item.photo_path }} style={styles.thumbnail} />
          ) : (
            <View style={[styles.thumbnail, styles.noImagePlaceholder]}>
              <Ionicons name="camera-outline" size={32} color="#ccc" />
            </View>
          )}
        </TouchableOpacity>

        {!item.register_id && (
          <View style={styles.chipError}>
            <Ionicons name="alert-circle-outline" size={14} color="#fff" />
            <Text style={styles.chipErrorText}>ไม่พบC7</Text>
          </View>
        )}

      </View>

      {/* ส่วนรายละเอียด (เหมือนเดิม) */}
      <View style={styles.detailsContainer}>
        <View style={styles.topRow}>
          <View style={styles.plateInfo}>
            {/* ✅ ใช้ Logical OR operator เพื่อแสดงค่า fallback ถ้า item.plate_no เป็น null/undefined/empty string */}
            <Text style={styles.plateText} numberOfLines={1}>{item.plate_no || 'ไม่ระบุทะเบียน'}</Text>
            {/* ✅ ใช้ Logical OR operator และทำการ replace อย่างปลอดภัย */}
            <Text style={styles.provinceText}>{(item.plate_province || 'ไม่ระบุจังหวัด')?.replace("กรุงเทพมหานคร", "กทม.")}</Text>
          </View>
        </View>
        <View style={styles.infoRow}>
          <View style={styles.infoItem}>
            <Ionicons name="bus-outline" size={16} color="#555" />
            {/* ✅ ใช้ Logical OR operator เพื่อแสดงค่า fallback */}
            <Text style={styles.infoText}>{item.bus_type || 'ไม่ระบุประเภท'}</Text>
          </View>
          {item.sticker_no && (
            <View style={styles.infoItem}>
              <Ionicons name="pricetag-outline" size={16} color="#555" />
              <Text style={styles.infoText}>#{item.sticker_no}</Text>
            </View>
          )}

          {passengerText !== '0 คน' && passengerText !== '' && ( // ✅ ตรวจสอบค่าที่ส่งกลับจาก formatPassengerInfo
            <View style={styles.infoItem}>
              <Ionicons name="people-outline" size={16} color="#555" />
              <Text style={styles.infoText}>{passengerText}</Text>
            </View>
          )}


        </View>

        <View style={styles.metaRow}>
          {/* ✅ ใช้ displayTime ที่ถูกประมวลผลอย่างปลอดภัยแล้ว */}
          <Text style={styles.metaText}>{displayTime}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {/* <Text style={styles.metaText}>สถานะ: {item.sync_status} </Text> */}


            <Ionicons
              name={item.sync_status == 2 ? "checkmark-done" : item.sync_status == 4 ? "warning-outline" : "cloud-upload"}
              size={16}
              color={item.sync_status == 2 ? '#27ae60' : item.sync_status == 4 ? '#e74c3c' : '#f39c12'}
            />
          </View>
        </View>
        {
          item.error_msg ? (
            <View style={styles.metaRow}>
              <Text style={[styles.metaText, { color: '#e74c3c' }]}>
                {(() => {
                  try {
                    if (typeof item.error_msg === 'string') {
                      return JSON.parse(item.error_msg)?.message || item.error_msg;
                    }
                    return item.error_msg?.message || item.error_msg;
                  } catch (e) {
                    return item.error_msg;
                  }
                })()}
              </Text>
            </View>
          ) : null
        }

      </View>
    </View>
  );
};

// 3. ห่อหุ้ม Component ของคุณด้วย React.memo เพื่อ Performance สูงสุด
// มันจะป้องกันการ re-render ที่ไม่จำเป็น

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    marginVertical: 8,
    marginHorizontal: 16,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 4,
  },
  // ✅ สไตล์สำหรับ Container ด้านซ้าย
  leftContainer: {
    alignItems: '', // จัดให้อยู่กึ่งกลางแนวนอน
    marginRight: 12,
    width: 100,
  },
  // ✅ สไตล์สำหรับเลขลำดับ
  listNumber: {
    fontSize: 14,
    fontWeight: '600',
    color: '#aaa',
    marginRight: 8,
    width: 25, // กำหนดความกว้างให้ตัวเลขไม่เบียดกัน
    textAlign: 'right',
  },
  thumbnail: {
    width: 100,
    minHeight: 90,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#eee',
    marginVertical: 4,
  },
  cornerNumber: {
    position: 'absolute', // ทำให้ลอยออกจาก layout ปกติ
    top: -1,             // ชิดขอบบน
    left: -1,            // ชิดขอบซ้าย
    backgroundColor: 'rgba(52, 152, 219, 0.9)', // สีพื้นหลัง (สีน้ำเงินมี Alpha)
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderTopLeftRadius: 12,      // ทำให้มุมโค้งรับกับการ์ด
    borderBottomRightRadius: 8, // เพิ่มความสวยงามที่มุมตรงข้าม
    zIndex: 1, // ทำให้แสดงอยู่เหนือรูปภาพ
  },
  cornerNumberText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  noImagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  detailsContainer: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  plateInfo: {
    flex: 1,
  },
  imageContainer: {
    marginRight: 12,
  },
  plateText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A1A',
    letterSpacing: 0.5,
  },
  provinceText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#666',
    marginTop: 2,
  },
  chipError: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e74c3c',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginTop: 0,
  },
  chipErrorText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
    marginLeft: 4,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap-reverse', // ✅ จุดสำคัญ: ทำให้ข้อมูลตัดขึ้นบรรทัดใหม่ได้
    marginVertical: 6,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f2f5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginRight: 8,
    marginBottom: 4, // เพิ่มระยะห่างเผื่อกรณีขึ้นบรรทัดใหม่
  },
  infoText: {
    fontSize: 13,
    color: '#555',
    marginLeft: 6,
    fontWeight: '500',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 'auto',
  },
  metaText: {
    fontSize: 12,
    color: '#888',
  },
});


export default React.memo(HistoryItem);


