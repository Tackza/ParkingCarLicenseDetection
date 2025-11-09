
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
// import AsyncStorage from '@react-native-async-storage/async-storage';
import { BluetoothEscposPrinter } from 'react-native-bluetooth-escpos-printer';
import ViewShot, { captureRef } from 'react-native-view-shot';
import { insertCheckIn } from '../constants/Database';
import { useProject } from '../contexts/ProjectContext';

export default function PassengerCountScreen() {
  const router = useRouter();
  const params = useLocalSearchParams(); // ดึงข้อมูลที่ส่งมาจากหน้า ScanScreen
  const foundRegisterData = params.foundRegisterData
    ? JSON.parse(params.foundRegisterData)
    : null;
  const initialPassengers = (params.passenger || '0|0|0|0').split('|');
  const [passengerCount, setPassengerCount] = useState(initialPassengers[0] || '0');
  const [childCount, setChildCount] = useState(initialPassengers[1] || '0');
  const [monkCount, setMonkCount] = useState(initialPassengers[2] || '0');
  const [noviceCount, setNoviceCount] = useState(initialPassengers[3] || '0');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const receiptRef = useRef();
  const { activeProject } = useProject();

  // ฟังก์ชันสำหรับเพิ่ม/ลด 
  const handleCountChange = (setter, currentValue, change) => {
    const currentNum = parseInt(currentValue, 10) || 0;
    const newNum = Math.max(0, currentNum + change); // ไม่ให้ต่ำกว่า 0
    setter(newNum.toString());
  };

  const handleTextChange = (text, setter) => {
    // กรองให้รับเฉพาะตัวเลข 0-9 เท่านั้น
    const numericValue = text.replace(/[^0-9]/g, '');
    setter(numericValue);
  };
  console.log('params :>> ', params);

  const formatPassengerInfo = (passengerCount, childCount, monkCount, noviceCount) => {
    let textCount = '';

    const people = parseInt(passengerCount || 0) + parseInt(childCount || 0); // รวมผู้ใหญ่กับเด็ก
    const monks = parseInt(monkCount || 0);
    const novices = parseInt(noviceCount || 0);

    if (people > 0) {
      textCount += `${people} คน`;
    }
    if (monks > 0) {
      textCount += `/${monks} รูป`;
    }
    if (novices > 0) {
      textCount += `/สณ${novices} รูป`;
    }
    return textCount || '-- คน';

  };


  const resetForm = () => {
    setChildCount('0');
    setMonkCount('0');
    setNoviceCount('0');
    setPassengerCount('0');
    return router.push('/main');
  }


  // ฟังก์ชันสุดท้าย: ยืนยัน บันทึก และพิมพ์
  const handleConfirmAndPrint = async () => {
    if (isSubmitting) return;

    const finalPassengerCount = parseInt(passengerCount, 10) || 0;
    const finalChildCount = parseInt(childCount, 10) || 0;
    const finalMonkCount = parseInt(monkCount, 10) || 0;
    const finalNoviceCount = parseInt(noviceCount, 10) || 0;

    setIsSubmitting(true);
    Keyboard.dismiss();

    try {
      const plateProvinceBKK = params.plate_province == 'กรุงเทพมหานคร' ? 'กทม.' : params.plate_province;
      // ✅ 4. สร้าง Object ที่สมบูรณ์เพื่อบันทึกลง check_ins
      const finalCheckInData = {
        project_id: params.project_id,
        register_id: params.register_id,
        detect_plate_no: params.detect_plate_no,
        detect_plate_province: params.detect_plate_province,
        plate_no: params.plate_no,
        plate_province: plateProvinceBKK,
        is_plate_manual: params.is_plate_manual,
        photo_path: params.photo_path,
        bus_type: params.bus_type,
        // สร้าง string ผู้โดยสารจากค่าล่าสุดในหน้านี้
        passenger: `${finalPassengerCount}|${finalChildCount}|${finalMonkCount}|${finalNoviceCount}`,
        note: '',
        comp_id: params.comp_id,
        seq_no: params.seq_no,
        printed: 1, // หน้านี้คือการพิมพ์
        created_by: params.created_by,
      };



      // ✅ รับค่าผลลัพธ์จาก insertCheckIn
      const result = await insertCheckIn(finalCheckInData);

      // ✅ ตรวจสอบว่าบันทึกสำเร็จหรือไม่
      if (!result || !result.lastInsertRowId || result.changes === 0) {
        throw new Error('ไม่สามารถบันทึกข้อมูลลงฐานข้อมูลได้');
      }

      // ✅ 6. พิมพ์ใบเสร็จ
      setTimeout(async () => {
        const uri = await captureRef(receiptRef, {
          format: 'png', quality: 1.0, result: 'base64',
        });
        await BluetoothEscposPrinter.printPic(uri, { width: 520, left: 0 });
        await BluetoothEscposPrinter.printText('\r\n\r\n', {});
        router.push('/main'); // กลับไปหน้าหลักหลังพิมพ์เสร็จ
      }, 500);

    } catch (error) {
      Alert.alert('ข้อผิดพลาด', `ไม่สามารถบันทึกหรือพิมพ์ได้: ${error.message}`);
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.tabMobile}>
      </View>
      <ScrollView style={styles.container}
        contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled">

        <View style={styles.card}>

          <View style={styles.infoContainer}>
            {/* <Text >ทะเบียน: </Text> */}
            <Text style={styles.label}>{params.plate_no} {params.plate_province}</Text>
            <View style={styles.chipContainer}>
              <Text style={styles.chipText}>{params.bus_type}</Text>
            </View>
          </View>

          {/* Passenger Counter */}
          <View style={styles.counterSection}>
            <Text style={styles.labelTypePassager}>ผู้ใหญ่</Text>
            <View style={styles.counterContainer}>
              <TouchableOpacity style={styles.counterButton} onPress={() => handleCountChange(setPassengerCount, passengerCount, -1)}>
                <Text style={styles.counterButtonText}>-</Text>
              </TouchableOpacity>
              <TextInput
                style={styles.counterInput}
                value={passengerCount}
                onChangeText={(text) => handleTextChange(text, setPassengerCount)}
                keyboardType="number-pad"
                textAlign="center"
                selectTextOnFocus={true}
              />
              <TouchableOpacity style={styles.counterButton} onPress={() => handleCountChange(setPassengerCount, passengerCount, 1)}>
                <Text style={styles.counterButtonText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Child Counter */}
          <View style={styles.counterSection}>
            <Text style={styles.labelTypePassager}>เด็ก</Text>
            <View style={styles.counterContainer}>
              <TouchableOpacity style={styles.counterButton} onPress={() => handleCountChange(setChildCount, childCount, -1)}>
                <Text style={styles.counterButtonText}>-</Text>
              </TouchableOpacity>
              <TextInput
                style={styles.counterInput}
                value={childCount}
                onChangeText={(text) => handleTextChange(text, setChildCount)}
                keyboardType="number-pad"
                textAlign="center"
                selectTextOnFocus={true}
              />
              <TouchableOpacity style={styles.counterButton} onPress={() => handleCountChange(setChildCount, childCount, 1)}>
                <Text style={styles.counterButtonText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Monk Counter */}
          <View style={styles.counterSection}>
            <Text style={styles.labelTypePassager}>พระ</Text>
            <View style={styles.counterContainer}>
              <TouchableOpacity style={styles.counterButton} onPress={() => handleCountChange(setMonkCount, monkCount, -1)}>
                <Text style={styles.counterButtonText}>-</Text>
              </TouchableOpacity>
              <TextInput
                style={styles.counterInput}
                value={monkCount}
                onChangeText={(text) => handleTextChange(text, setMonkCount)}
                keyboardType="number-pad"
                textAlign="center"
                selectTextOnFocus={true}
              />
              <TouchableOpacity style={styles.counterButton} onPress={() => handleCountChange(setMonkCount, monkCount, 1)}>
                <Text style={styles.counterButtonText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Child Monk Counter */}
          <View style={styles.counterSection}>
            <Text style={styles.labelTypePassager}>สามเณร</Text>
            <View style={styles.counterContainer}>
              <TouchableOpacity style={styles.counterButton} onPress={() => handleCountChange(setNoviceCount, noviceCount, -1)}>
                <Text style={styles.counterButtonText}>-</Text>
              </TouchableOpacity>
              <TextInput
                style={styles.counterInput}
                value={noviceCount}
                onChangeText={(text) => handleTextChange(text, setNoviceCount)}
                keyboardType="number-pad"
                textAlign="center"
                selectTextOnFocus={true}
              />
              <TouchableOpacity style={styles.counterButton} onPress={() => handleCountChange(setNoviceCount, noviceCount, 1)}>
                <Text style={styles.counterButtonText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.buttonContainer}>
            <TouchableOpacity style={styles.cancelButton}
              onPress={resetForm}>
              <Text style={styles.buttonTextFooter}>ยกเลิก</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmButton, isSubmitting && styles.buttonDisabled]}
              onPress={handleConfirmAndPrint}
              disabled={isSubmitting}
            >
              {isSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonTextFooter}>บันทึกและพิมพ์</Text>}
            </TouchableOpacity>
          </View>
        </View>

        {/* Hidden Receipt for printing */}
        <View style={{ position: 'absolute', left: -10000 }}>
          {/* <View > */}
          <ViewShot ref={receiptRef} style={styles.receiptContainer}>
            <Text style={styles.textCenter}>! เอกสารสำคัญ ห้ามทำหาย !</Text>

            <View style={[styles.receiptRow, { marginTop: 1, marginBottom: 1 }]}>
              <Text style={styles.receiptMetaText}>#{params.comp_id || '--'}</Text>
              <Text style={styles.receiptMetaText}>{params.code || '--'}</Text>
            </View>

            <Text style={styles.receiptTitle}>ใบลงทะเบียนรถ</Text>
            <Text style={styles.receiptSubtitle}>{activeProject?.name || 'ไม่พบชื่อโปรเจกต์'}</Text>
            <View style={styles.divider} />
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>ทะเบียนรถ:</Text><Text style={styles.receiptValue}>{params.plate_no}</Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>จังหวัด:</Text><Text style={styles.receiptValue}>{params.plate_province}</Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>ประเภทรถ:</Text><Text style={styles.receiptValue}>{params.bus_type.replace("รถ", "")}</Text>
            </View>
            {foundRegisterData && (
              <>

                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>จุดออกรถ:</Text><Text style={styles.receiptValue}>{foundRegisterData.station_name}</Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>จังหวัด:</Text><Text style={styles.receiptValue}>{foundRegisterData.station_province}</Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>ผู้โดยสาร:</Text>
                  <Text style={styles.receiptValue}>{formatPassengerInfo(passengerCount, childCount, monkCount, noviceCount)}</Text>
                </View>
              </>
            )}
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>เวลาลงทะเบียน:</Text>
              <Text style={styles.receiptValue}>
                {new Date().toLocaleDateString('th-TH-u-ca-buddhist', {
                  year: 'numeric', month: '2-digit', day: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </Text>
            </View>

            <View style={styles.sectionDivider} />
            {/* --- ✅ 2. เพิ่มส่วนที่ 2 สำหรับเบิกอาหาร --- */}
            <View style={styles.sectionHeaderRow}>

              <View style={styles.sectionHeaderSide} />
              <Text style={[styles.receiptTitle, styles.sectionHeaderCenter]}>ใบลงทะเบียนส่วนที่ 2</Text>
              <Text style={[styles.sectionHeaderText, styles.sectionHeaderSide, { textAlign: 'right' }]}>
                {params.code || '--'}
              </Text>
            </View>

            <Text style={styles.receiptTitle}>สำหรับเบิกอาหารสาธุชน</Text>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>ทะเบียนรถ:</Text><Text style={styles.receiptValue}>{params.plate_no}</Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>ทะเบียนจังหวัด:</Text><Text style={styles.receiptValue}>{params.plate_province}</Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>ผู้โดยสารรวม:</Text>
              {/* แสดงยอดรวมตัวใหญ่ๆ */}
              <Text style={[styles.receiptValue, styles.totalPassengerValue]}>{formatPassengerInfo(passengerCount, childCount, monkCount, noviceCount)}</Text>
            </View>

            {/* ✅ 3. เพิ่มช่องเซ็นชื่อ */}
            <View style={styles.signatureOverallContainer}>
              <View style={styles.signatureSingleBox}>
                <Text style={styles.signatureLabel}>รับอาหารเช้า</Text>
                <View style={styles.signatureLongLine} />
              </View>
              <View style={{ height: 15 }} />

              <View style={styles.signatureSingleBox}>
                <Text style={styles.signatureLabel}>รับอาหารกลางวัน</Text>
                <View style={styles.signatureLongLine} />
              </View>
            </View>
          </ViewShot>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  contentContainer:
    { padding: 10, justifyContent: 'center', flexGrow: 1 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  title: { fontSize: 24, fontWeight: 'bold', color: '#2c3e50', textAlign: 'center', marginBottom: 20 },
  infoContainer: {
    marginBottom: 15,
    padding: 15,
    paddingVertical: 5,
    backgroundColor: '#f1f3f5',
    borderRadius: 10,
    width: '100%',           // ทำให้ container เต็มความกว้างจอ (หรือ parent)
    alignItems: 'center',    // << สำคัญ: จัดให้ลูกทุกตัวอยู่กึ่งกลางแนวนอน
    paddingVertical: 10,
    // borderLeftWidth: 5,
    // borderLeftColor: '#3498db',
  },
  // totalPassengerValue: { // สไตล์สำหรับยอดรวม
  //   fontSize: 20, // ใหญ่ขึ้น
  //   // fontWeight: 'bold', // เน้น
  //   color: '#1A1A1A', // สีเข้ม
  // },
  passengerDetailText: { // สไตล์สำหรับรายละเอียด (ถ้าใช้)
    fontSize: 14,
    color: '#555',
    fontFamily: 'Sarabun-Regular',
    marginTop: -2, // ลดช่องว่างเล็กน้อย
  },
  infoText: {
    fontSize: 16,
    color: '#34495e',
    marginBottom: 5,
    fontWeight: '600',
    textAlign: 'left',
    alignContents: 'center'
  },
  counterSection: { marginBottom: 10 },
  label: {
    fontSize: 17,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 10,
    textAlign: 'center'
  },
  labelTypePassager: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 2,
    textAlign: 'center'
  },

  counterContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  counterButton: {
    backgroundColor: '#3498db',
    width: 40, height: 40, borderRadius: 30,
    justifyContent: 'center', alignItems: 'center',
    marginHorizontal: 15,
  },
  counterButtonText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  counterInput: {
    borderWidth: 1, borderColor: '#ced4da',
    borderRadius: 15, width: 100, height: 60,
    fontSize: 28,
    fontWeight: 'bold',
    color: '#2c3e50',
    textAlign: 'center',
  },
  buttonContainer: {
    flexDirection: 'row',
    marginTop: 10,
    justifyContent: 'space-between',
    alignContents: 'center',
  },
  confirmButton: {
    backgroundColor: '#2ecc71',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#e74c3c',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  buttonTextFooter: { fontSize: 14, color: '#fff' },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  buttonDisabled: { backgroundColor: '#95a5a6' },
  receiptContainer: { backgroundColor: '#fff', padding: 0, marginTop: 0, width: 300 },
  textCenter: {
    textAlign: 'center',
    fontSize: 20,
    color: 'black',
    fontFamily: 'Sarabun-Regular',
  },
  receiptTitle: {
    fontSize: 18,
    // fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 5,
  },
  receiptSubtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 15,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: '#000', marginVertical: 10 },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 2
  },

  receiptLabel: {
    fontSize: 16,
    fontFamily: 'Sarabun-Regular',
    marginVertical: 0,
  },
  receiptValue: {
    fontSize: 16,
    // fontWeight: 'bold',
    fontFamily: 'Sarabun-Regular',
    // marginTop: 5,
  },
  tabMobile: {
    height: 25,
    backgroundColor: 'black',
    borderBottomWidth: 1,
    // borderColor:'#e9ecef',
    justifyContent: 'center',
    alignItems: 'center'
  },
  receiptMetaText: { // สไตล์สำหรับ User ID และ Reg ID
    fontSize: 20,
    color: '#555',
    // fontWeight: 'bold',
    fontFamily: 'Sarabun-Regular',
  },

  signatureOverallContainer: { // Container สำหรับจัดวางช่องเซ็นชื่อ
    flexDirection: 'column',
    alignItems: 'center',
    marginTop: 0,
    marginBottom: 10,
  },
  signatureSingleBox: { // กรอบของแต่ละช่องเซ็นชื่อ
    alignItems: 'start', // จัดเนื้อหาภายในกล่องให้อยู่กึ่งกลาง
    width: '100%',
    marginTop: 0       // กำหนดความกว้างให้เหมาะสม
  },
  signatureLabel: { // ข้อความกำกับ (รับอาหารเช้า/กลางวัน)
    fontSize: 14,
    color: '#333',
    marginBottom: 5, // ลดระยะห่างลงอีก
    fontFamily: 'Sarabun-Regular',
  },
  signatureLine: { // เส้นประสำหรับเซ็นชื่อ
    fontSize: 16,
    color: '#555',
    letterSpacing: 1,
  },
  signatureLongLine: {
    borderBottomWidth: 1,      // ความหนาของเส้น
    borderBottomColor: '#888', // สีของเส้น
    borderStyle: 'dashed',     // ทำให้เป็นเส้นประ
    marginTop: 40,              // ระยะห่างจาก Label ด้านบน
    
  },

  sectionDivider: { // Style for the new separator
    borderBottomWidth: 2,
    borderBottomColor: '#888',
    borderStyle: 'dashed', // Make it dashed
    marginVertical: 15, // Add more vertical space around it
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-around', // Distributes space

  },
  sectionHeaderText: {
    fontSize: 16,
    // fontWeight: 'bold',
    fontFamily: 'Sarabun-Regular',
    color: '#333',
  },
  sectionHeaderCenter: {
    textAlign: 'left',
  },
  sectionHeaderSide: {
    flex: 1, // Gives left and right equal flexible space
  },

  // Renamed from sectionTitle for clarity
  sectionTitle: {
    fontSize: 14, // Slightly smaller
    textAlign: 'center',
    marginBottom: 10,
    fontFamily: 'Sarabun-Regular',
    color: '#555',
  },
  chipText: {
    flexDirection: 'row',
    backgroundColor: '#3498db',
    color: '#fff',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontSize: 17,
    overflow: 'hidden',
    maxWidth: 150,
    alignItems: 'center',
    fontWeight: '500',
  },
  chipContainer: {
    backgroundColor: '#007AFF', // สีพื้นหลังของ Chip (สีฟ้าตัวอย่าง)
    borderRadius: 25,          // ทำให้ขอบโค้งมน (ค่าสูงๆ จะเป็นทรงแคปซูล)
    paddingVertical: 6,        // ระยะห่างภายใน Chip (บน-ล่าง)
    paddingHorizontal: 16,
  },
  chipText: {
    // นี่คือข้อความที่อยู่ใน Chip
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
  }
});

