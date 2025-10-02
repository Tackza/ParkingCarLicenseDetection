import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TextInput,
  Image, // เพิ่มเข้ามา
  Modal, // เพิ่มเข้ามา
  FlatList,
  ScrollView
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { BluetoothEscposPrinter } from 'react-native-bluetooth-escpos-printer';
import ViewShot, { captureRef } from 'react-native-view-shot';
import DropDownPicker from 'react-native-dropdown-picker';
import { THAI_PROVINCES } from '../../constants/provinces'
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';

const vehicleTypes = [
  { label: 'รถตู้', value: 'รถตู้' },
  { label: 'รถบัสพัดลม', value: 'รถบัสพัดลม' },
  { label: 'รถบัสแอร์ 1 ชั้น', value: 'รถบัสแอร์ 1 ชั้น' },
  { label: 'รถบัสแอร์ 2 ชั้น', value: 'รถบัสแอร์ 2 ชั้น' },
  { label: 'อื่น ๆ (โปรดระบุ)', value: 'Other' }, // <-- เพิ่มตัวเลือกนี้
];


export default function ScanScreen() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [imageUri, setImageUri] = useState(null); // State ใหม่สำหรับเก็บ URI ของรูป
  const [isImageModalVisible, setIsImageModalVisible] = useState(false);
  const [licensePlate, setLicensePlate] = useState('');
  const [province, setProvince] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [stickerNumber, setStickerNumber] = useState('');

  const [provinceOpen, setProvinceOpen] = useState(false);
  const [vehicleTypeOpen, setVehicleTypeOpen] = useState(false);

  const [showVehicleTypeInput, setShowVehicleTypeInput] = useState(false);
  const [customVehicleType, setCustomVehicleType] = useState('');
  const [showReceipt, setShowReceipt] = useState(false);
  const receiptRef = React.useRef();
  const router = useRouter();
  const [isVerified, setIsVerified] = useState(false);
  const [masterVehicles, setMasterVehicles] = useState([]);

  useFocusEffect(
    React.useCallback(() => {
      // โหลด Master List ทุกครั้งที่หน้านี้ถูก focus
      loadMasterList();
      // เมื่อกลับมาที่หน้านี้ ให้รีเซ็ตฟอร์ม (ถ้าจำเป็น)
      // resetForm(); 
    }, [])
  );

  const loadMasterList = async () => {
    try {
      const dataString = await AsyncStorage.getItem('master_vehicle_list');
      if (dataString) {
        setMasterVehicles(JSON.parse(dataString));
      } else {
        setMasterVehicles([]);
      }
    } catch (error) {
      console.error('Failed to load master vehicle list:', error);
      setMasterVehicles([]);
    }
  };


  const saveScanToHistory = async (scanData) => {
    try {
      const existingHistory = await AsyncStorage.getItem('scan_history');
      const history = existingHistory ? JSON.parse(existingHistory) : [];

      // เพิ่มข้อมูลใหม่เข้าไปด้านบนสุดของ Array
      history.unshift(scanData);

      await AsyncStorage.setItem('scan_history', JSON.stringify(history));
    } catch (error) {
      console.error('Failed to save scan to history', error);
      // อาจจะแสดง Alert แจ้งเตือนผู้ใช้ก็ได้ (ทางเลือก)
    }
  };

  const requestPermissions = async () => {
    const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
    if (cameraPermission.status !== 'granted') {
      Alert.alert('ขออนุญาต', 'กรุณาอนุญาตให้เข้าถึงกล้อง');
      return false;
    }
    return true;
  };

  const takePhoto = async () => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setImageUri(result.assets[0].uri);
        await processImage(result.assets[0].uri);
      }
    } catch (error) {
      Alert.alert('ข้อผิดพลาด', 'ไม่สามารถเปิดกล้องได้');
    }
  };

  const processImage = async (uri) => {
    setIsProcessing(true);
    setIsVerified(false); // <-- รีเซ็ตสถานะทุกครั้งที่สแกนใหม่
    try {
      const formData = new FormData();
      formData.append('image', {
        uri: uri,
        type: 'image/jpeg',
        name: `image_${Date.now()}.jpg`,
      });

      const response = await fetch(
        'https://mbus-detect-yolo-api-833646348122.asia-southeast1.run.app/detect',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'multipart/form-data',
          },
          body: formData,
        }
      );

      if (!response.ok) {
        throw new Error('ไม่สามารถตรวจจับทะเบียนรถได้');
      }

      const { data } = await response.json();
      if (!data.license_plate || !data.province) {
        throw new Error('ไม่สามารถตรวจจับทะเบียนรถได้');
      }

      if (data.license_plate) {
        setLicensePlate(data.license_plate);
        // --- ตรวจสอบกับ Master List ---
        await checkWithMasterList(data.license_plate);
      }
      if (data.province) {
        setProvince(data.province);
      }

      // แสดงหน้าเลือกประเภทรถ
      Alert.alert('สำเร็จ', 'ตรวจจับทะเบียนรถสำเร็จ กรุณาเลือกประเภทรถ');
    } catch (error) {
      setLicensePlate('');
      setIsVerified(false);
      Alert.alert('ข้อผิดพลาด', error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // ฟังก์ชันสำหรับตรวจสอบข้อมูล
  const checkWithMasterList = async (scannedPlate) => {
    try {
      const masterDataString = await AsyncStorage.getItem('master_vehicle_list');
      if (masterDataString) {
        const masterList = JSON.parse(masterDataString);
        // ตรวจสอบว่ามีทะเบียนรถที่สแกนได้ อยู่ใน Master List หรือไม่
        const found = masterList.find(vehicle => vehicle.plate === scannedPlate);

        if (found) {
          console.log('Vehicle found in master list:', found);
          setIsVerified(true); // <-- ตั้งสถานะเป็น "ตรวจสอบแล้ว"
        } else {
          console.log('Vehicle not found in master list.');
          setIsVerified(false);
        }
      }
    } catch (error) {
      console.error('Failed to check with master list', error);
    }
  };

  const handlePrintAndSave = async () => {
    // --- Validation ---
    if (!licensePlate.trim() || !province || !vehicleType) {
      Alert.alert('ข้อมูลไม่ครบ', 'กรุณากรอกข้อมูลทะเบียนรถ จังหวัด และประเภทรถให้ครบถ้วน');
      return;
    }

    // --- Validation เพิ่มเติมสำหรับประเภทรถ 'อื่นๆ' ---
    if (vehicleType === 'Other' && !customVehicleType.trim()) {
      Alert.alert('ข้อมูลไม่ครบ', 'กรุณาระบุประเภทรถในช่อง "โปรดระบุประเภทรถ"');
      return;
    }

    const finalVehicleType = vehicleType === 'Other' ? customVehicleType : vehicleType;

    const newScanData = {
      licensePlate: licensePlate,
      province: province,
      vehicleType: finalVehicleType,
      stickerNumber: stickerNumber,
      timestamp: new Date().toISOString(),
      imageUri: imageUri,
    };

    await saveScanToHistory(newScanData);


    setShowReceipt(true);
    // รอให้ Receipt component render ข้อมูลใหม่เสร็จก่อน
    setTimeout(async () => {
      await generateAndPrint();
    }, 500);
  };

  const selectVehicleType = async (type) => {
    setVehicleType(type);
    setShowReceipt(true);

    // รอให้ Receipt render เสร็จก่อน
    setTimeout(async () => {
      await generateAndPrint();
    }, 500);
  };

  const selectCustomVehicleType = async () => {
    if (!customVehicleType.trim()) {
      Alert.alert('แจ้งเตือน', 'กรุณากรอกประเภทรถ');
      return;
    }
    setVehicleType(customVehicleType);
    setShowReceipt(true);

    setTimeout(async () => {
      await generateAndPrint();
    }, 500);
  };

  const generateAndPrint = async () => {
    try {
      // Capture receipt as image
      const uri = await captureRef(receiptRef, {
        format: 'png',
        quality: 1.0,
        result: 'base64',
      });

      // Print via Bluetooth
      await BluetoothEscposPrinter.printPic(uri, {
        width: 520,
        left: 0,
      });
      await BluetoothEscposPrinter.printText('\r\n\r\n', {});

      // Alert.alert('สำเร็จ', 'พิมพ์ใบทะเบียนสำเร็จ', [
      //   {
      //     text: 'ตกลง',
      //     onPress: resetForm,
      //   },
      // ]);
      resetForm();
    } catch (error) {
      Alert.alert('ข้อผิดพลาด', 'ไม่สามารถพิมพ์ใบทะเบียนได้');
      console.error(error);
    }
  };

  const resetForm = () => {
    setIsProcessing(false);
    setImageUri(null);
    setLicensePlate('');
    setProvince(null);
    // setVehicleType(null);
    setCustomVehicleType(''); // <-- เพิ่มบรรทัดนี้
    // setStickerNumber('');
    setShowReceipt(false);
    setIsVerified(false);

    // --- Logic ใหม่สำหรับบวกเลขสติกเกอร์ ---
    setStickerNumber(currentSticker => {
      // แปลงค่าปัจจุบันเป็นตัวเลข
      const number = parseInt(currentSticker, 10);

      // ตรวจสอบว่าแปลงเป็นตัวเลขได้หรือไม่
      if (!isNaN(number)) {
        // ถ้าเป็นตัวเลข ให้บวก 1 แล้วแปลงกลับเป็นข้อความ
        return (number + 1).toString();
      }

      // ถ้าค่าเดิมไม่ใช่ตัวเลข (เช่น ว่างเปล่า หรือมีตัวอักษร)
      // ให้กลับไปเป็นค่าว่าง หรือจะกำหนดค่าเริ่มต้นเป็น '1' ก็ได้
      return '';
    });
  };

  const renderMasterItem = ({ item }) => (

    <View style={styles.masterItem}>
      <View style={styles.masterItemHeader}>
        <Text style={styles.masterItemPlate}>{item.plate}</Text>
        <Text style={styles.masterItemDetail}>{item.province}</Text>
      </View>
      {item.vehicleType && <Text style={styles.noMasterDataText}>{item.vehicleType}</Text>}
    </View>
  );

  // สร้าง Component สำหรับ Header ของ FlatList
  const renderListHeader = () => (
    <Text style={styles.initialTitle}>C7 ที่ลงทะเบียนแล้ว</Text>
  );

  // สร้าง Component สำหรับ Footer ของ FlatList
  const renderListFooter = () => (
    <TouchableOpacity
      style={[styles.scanButton, isProcessing && styles.scanButtonDisabled, { marginTop: 20 }]}
      onPress={takePhoto}
      disabled={isProcessing}
    >
      {isProcessing ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={styles.scanButtonText}>📸 ถ่ายภาพเพื่อสแกน</Text>
      )}
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {!imageUri ? (
          <View style={styles.content} >
            <FlatList
              data={masterVehicles}
              renderItem={renderMasterItem}
              keyExtractor={(item, index) => item.plate + index}
              style={styles.masterListContainer}
              contentContainerStyle={styles.masterListContent}
              ListHeaderComponent={renderListHeader}
              // ListFooterComponent={renderListFooter}
              ListEmptyComponent={() => (
                <Text style={styles.noMasterDataText}>
                  {masterVehicles.length === 0 ? "ไม่มีข้อมูล Master List" : ""}
                </Text>
              )}
            />
            <TouchableOpacity
              style={[styles.scanButton, isProcessing && styles.scanButtonDisabled]}
              onPress={takePhoto}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.scanButtonText}>📸 ถ่ายภาพเพื่อสแกน</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (

          <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 10 }}
            keyboardShouldPersistTaps="handled">

            {/* ========== ส่วนฟอร์มหลังถ่ายภาพ ========== */}
            <View style={styles.formContainer}>
              <TouchableOpacity onPress={() => setIsImageModalVisible(true)}>
                <Image source={{ uri: imageUri }} style={styles.previewImage} />
              </TouchableOpacity>

              <View style={styles.inputGroup}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={styles.label}>ทะเบียนรถ</Text>
                  {isVerified && (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Ionicons name="checkmark-circle" size={16} color="#2ecc71" />
                      <Text style={{ color: '#2ecc71', marginLeft: 4, fontWeight: '600' }}>ตรวจสอบแล้ว</Text>
                    </View>
                  )}
                  {!isVerified && licensePlate.trim() !== '' && ( // แสดงเมื่อกรอกแล้วแต่ไม่พบใน Master List
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Ionicons name="close-circle" size={16} color="#e74c3c" />
                      <Text style={{ color: '#e74c3c', marginLeft: 4, fontWeight: '600' }}>ไม่พบในระบบ</Text>
                    </View>
                  )}
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="กท-1234"
                  value={licensePlate}
                  onChangeText={setLicensePlate}
                />
              </View>

              {/* ... Dropdown จังหวัด, ประเภทรถ, ช่องกรอกประเภทรถ, เลขสติกเกอร์ เหมือนเดิม ... */}
              <View style={[styles.inputGroup, { zIndex: 3000 }]}>
                <Text style={styles.label}>จังหวัด</Text>
                <DropDownPicker
                  open={provinceOpen}
                  value={province}
                  items={THAI_PROVINCES}
                  setOpen={setProvinceOpen}
                  setValue={setProvince}
                  searchable={true}
                  placeholder="เลือกจังหวัด"
                  listMode="MODAL"
                  style={styles.dropdown}
                />
              </View>

              <View style={[styles.inputGroup, { zIndex: 2000 }]}>
                <Text style={styles.label}>ประเภทรถ</Text>
                <DropDownPicker
                  open={vehicleTypeOpen}
                  value={vehicleType}
                  items={vehicleTypes}
                  setOpen={setVehicleTypeOpen}
                  setValue={setVehicleType}
                  searchable={true}
                  placeholder="เลือกประเภทรถ"
                  listMode="MODAL"
                  style={styles.dropdown}
                />
              </View>

              {vehicleType === 'Other' && (
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>โปรดระบุประเภทรถ</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="เช่น รถเก๋ง, รถทัวร์สองแถว ฯลฯ"
                    value={customVehicleType}
                    onChangeText={setCustomVehicleType}
                  />
                </View>
              )}

              <View style={styles.inputGroup}>
                <Text style={styles.label}>เลขสติกเกอร์</Text>
                <TextInput
                  style={styles.input}
                  placeholder="เลขสติกเกอร์"
                  value={stickerNumber}
                  onChangeText={setStickerNumber}
                  keyboardType="numeric"
                />
              </View>

              <TouchableOpacity style={styles.confirmButton} onPress={handlePrintAndSave}>
                <Text style={styles.confirmButtonText}>ยืนยันและพิมพ์</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.cancelButton} onPress={resetForm}>
                <Text style={styles.cancelButtonText}>ถ่ายใหม่/ยกเลิก</Text>
              </TouchableOpacity>
            </View>

            {/* Hidden Receipt for printing */}
            {showReceipt && (
              <View style={{ position: 'absolute', left: -10000 }}>
                <ViewShot ref={receiptRef} style={styles.receiptContainer}>
                  <Text style={styles.textCenter}>*** เอกสารสำคัญ ห้ามทำหาย ***</Text>
                  <Text style={styles.receiptTitle}>ใบลงทะเบียนรถ</Text>
                  <Text style={styles.receiptSubtitle}>งานตักบาตร</Text>

                  <View style={styles.divider} />

                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>ทะเบียนรถ:</Text>
                    <Text style={styles.receiptValue}>{licensePlate}</Text>
                  </View>

                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>จังหวัด:</Text>
                    <Text style={styles.receiptValue}>{province}</Text>
                  </View>

                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>ประเภทรถ:</Text>
                    {/* ใช้ค่าจาก customVehicleType ถ้า vehicleType คือ 'Other' */}
                    <Text style={styles.receiptValue}>
                      {vehicleType === 'Other' ? customVehicleType : vehicleType}
                    </Text>
                  </View>
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>รหัสจุดออกรถ: </Text>
                    <Text style={styles.receiptValue}>1234</Text>
                  </View>
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>จุดออกรถ: </Text>
                    <Text style={styles.receiptValue}>เมืองสมุทรสาคร</Text>
                  </View>
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>เขตอำเภอ: </Text>
                    <Text style={styles.receiptValue}>เมืองสมุทรสาคร</Text>
                  </View>
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>จังหวัด: </Text>
                    <Text style={styles.receiptValue}>สมุทรสาคร</Text>
                  </View>
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>ผู้โดยสาร: </Text>
                    <Text style={styles.receiptValue}>12 คน/พระ 0 รูป</Text>
                  </View>
                  <View style={styles.divider} />

                  {/* เพิ่มส่วนของสติกเกอร์ ถ้ามีข้อมูล */}
                  {stickerNumber && (
                    <View style={styles.receiptRow}>
                      <Text style={styles.receiptLabel}>สติกเกอร์:</Text>
                      <Text style={styles.receiptValue}>{stickerNumber}</Text>
                    </View>
                  )}

                  <View style={styles.divider} />

                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>เวลาลงทะเบียน:</Text>
                    <Text style={styles.receiptValue}>
                      {new Date().toLocaleDateString('th-TH', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Text>
                  </View>
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>เวลาพิมพ์: </Text>
                    <Text style={styles.receiptValue}>{new Date().toLocaleDateString('th-TH', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}</Text>
                  </View>
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>รหัสยืนยัน: </Text>
                    <Text style={styles.receiptValue}> 1234</Text>
                  </View>

                  <View style={styles.divider} />
                </ViewShot>
              </View>
            )}
          </ScrollView>
        )}
      </View>

      {/* Modal สำหรับแสดงรูปภาพเต็มจอ */}
      <Modal
        visible={isImageModalVisible}
        transparent={true}
        onRequestClose={() => setIsImageModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <Image source={{ uri: imageUri }} style={styles.fullscreenImage} resizeMode="contain" />
          <TouchableOpacity style={styles.closeButton} onPress={() => setIsImageModalVisible(false)}>
            <Text style={styles.closeButtonText}>X</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    // flexDirection: 'row',
    // justifyContent: 'space-between',
    alignItems: 'center',
    padding: 0,
    paddingTop: 5,
    backgroundColor: '#fff',
    borderBottomLeftRadius: 60,
    borderBottomRightRadius: 60,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  masterListContainer: {
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingTop: 20, // ย้าย padding มาที่นี่
  },
  masterListContent: {
    paddingBottom: 20, // padding ด้านล่าง
  },
  textCenter: {
    textAlign: 'center',
    fontSize: 16,
    color: 'black',
    fontFamily: 'monospace',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#2c3e50',
    textAlign: 'center',
  },
  historyLink: {
    fontSize: 16,
    color: '#3498db',
    textAlign: 'center',
  },
  content: {
    flex: 1,
    padding: 10,
  },
  scanContainer: {
    flex: 1,
  },
  cameraPlaceholder: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 110,
    borderWidth: 2,
    borderColor: '#e9ecef',
    borderStyle: 'dashed',
  },
  cameraIcon: {
    fontSize: 80,
    marginBottom: 20,
  },
  cameraText: {
    fontSize: 16,
    color: '#7f8c8d',
    textAlign: 'center',
  },
  scanButton: {
    backgroundColor: '#3498db',
    borderRadius: 15,
    padding: 20,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  scanButtonDisabled: {
    backgroundColor: '#95a5a6',
  },
  scanButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 10,
  },
  vehicleTypeContainer: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 25,
  },
  platePreview: {
    backgroundColor: '#f8f9fa',
    borderRadius: 15,
    padding: 20,
    alignItems: 'center',
    marginBottom: 25,
    borderWidth: 2,
    borderColor: '#3498db',
  },
  plateText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  provinceText: {
    fontSize: 18,
    color: '#7f8c8d',
    marginTop: 5,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 15,
  },
  vehicleTypeButton: {
    backgroundColor: '#3498db',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    alignItems: 'center',
  },
  vehicleTypeText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  customTypeButton: {
    backgroundColor: '#ecf0f1',
    borderRadius: 12,
    padding: 16,
    marginTop: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#bdc3c7',
  },
  customTypeButtonText: {
    color: '#7f8c8d',
    fontSize: 16,
    fontWeight: '600',
  },
  customInputContainer: {
    marginTop: 15,
  },
  customInput: {
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 15,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e9ecef',
    marginBottom: 10,
  },
  confirmButton: {
    backgroundColor: '#2ecc71',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    backgroundColor: '#e74c3c',
    borderRadius: 12,
    padding: 16,
    marginTop: 20,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  receiptContainer: {
    backgroundColor: '#fff',
    padding: 0,
    width: 300,
  },
  receiptTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 5,
  },
  receiptSubtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 15,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    marginVertical: 10,
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 5,
  },
  receiptLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    marginVertical: 2,
  },
  receiptValue: {
    fontSize: 14,
    fontFamily: 'monospace',
    marginVertical: 2,
  },
  formContainer: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 0,
  },
  previewImage: {
    width: '100%',
    height: 200,
    borderRadius: 15,
    marginBottom: 20,
    backgroundColor: '#e9ecef',
  },
  inputGroup: {
    marginBottom: 15,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 15,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  dropdown: {
    backgroundColor: '#f8f9fa',
    borderColor: '#e9ecef',
  },
  confirmButton: {
    backgroundColor: '#2ecc71',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    backgroundColor: '#e74c3c',
    borderRadius: 12,
    padding: 16,
    marginTop: 10,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },

  // --- Modal Styles ---
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenImage: {
    width: '100%',
    height: '80%',
  },
  closeButton: {
    position: 'absolute',
    top: 50,
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
  initialContainer: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    // elevation: 5,
    alignItems: 'center', // จัดให้อยู่กึ่งกลาง
    marginBottom: 20,
    minHeight: 520, // กำหนดความสูงขั้นต่ำ
    justifyContent: 'space-between', // กระจายเนื้อหา
  },
  initialTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 15,
    textAlign: 'center',
  },
  masterList: {
    width: '100%',
    maxHeight: 340, // จำกัดความสูงของรายการ
    marginBottom: 20,
  },
  masterItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  masterItemPlate: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#34495e',
    flex: 2, // แบ่งพื้นที่
  },
  masterItemDetail: {
    fontSize: 14,
    color: '#7f8c8d',
    flex: 1, // แบ่งพื้นที่
    textAlign: 'left',
  },
  noMasterDataText: {
    fontSize: 14,
    color: '#95a5a6',
    textAlign: 'center',
    marginBottom: 20,
  },
  scanButton: {
    backgroundColor: '#3498db',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    alignItems: 'center',
  },
  scanButtonDisabled: {
    backgroundColor: '#95a5a6',
  },
  scanButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});