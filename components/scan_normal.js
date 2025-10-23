import { Ionicons } from '@expo/vector-icons';
// import * as ImagePicker from 'expo-image-picker';
import {
  useLocalSearchParams,
  // useFocusEffect, 
  useRouter
} from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions, // เพิ่มเข้ามา
  Image, // เพิ่มเข้ามา
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { BluetoothEscposPrinter } from 'react-native-bluetooth-escpos-printer';
import DropDownPicker from 'react-native-dropdown-picker';
import ImageZoom from 'react-native-image-pan-zoom';
import { captureRef } from 'react-native-view-shot';
import { findRegisterByPlate, getActiveSession, getSetting } from '../constants/Database';
import { THAI_PROVINCES } from '../constants/provinces';
import { useProject } from '../contexts/ProjectContext';
import LicensePlateDisplay from './LicensePlateDisplay';

const vehicleTypes = [
  { label: 'รถตู้', value: 'ตู้' },
  { label: 'รถบัสพัดลม', value: 'พัดลม' },
  { label: 'รถบัสแอร์ 1 ชั้น', value: 'แอร์ 1 ชั้น' },
  { label: 'รถบัสแอร์ 2 ชั้น', value: 'แอร์ 2 ชั้น' },
  { label: 'อื่น ๆ (โปรดระบุ)', value: 'Other' }, // <-- เพิ่มตัวเลือกนี้
];

const windowWidth = Dimensions.get('window').width;
const windowHeight = Dimensions.get('window').height;


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
  const [cameraLaunched, setCameraLaunched] = useState(false);
  const [showVehicleTypeInput, setShowVehicleTypeInput] = useState(false);
  const [customVehicleType, setCustomVehicleType] = useState('');
  const [showReceipt, setShowReceipt] = useState(false);
  const receiptRef = React.useRef();
  const router = useRouter();
  const [isVerified, setIsVerified] = useState(false);
  const [masterVehicles, setMasterVehicles] = useState([]);

  const { imageUri: passedImageUri } = useLocalSearchParams();
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [tempLicensePlate, setTempLicensePlate] = useState('');
  const [tempProvince, setTempProvince] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { activeProject } = useProject();
  const [originalDetectedPlate, setOriginalDetectedPlate] = useState(''); // เก็บค่าที่สแกนได้ครั้งแรก
  const [originalDetectedProvince, setOriginalDetectedProvince] = useState(''); // เก็บค่าที่สแกนได้ครั้งแรก
  const [isManualEdit, setIsManualEdit] = useState(false); // ติดตามว่ามีการแก้ไขด้วยมือหรือไม่
  const [foundRegisterData, setFoundRegisterData] = useState(null);
  const [machineCode, setMachineCode] = useState('');


  // --- เพิ่ม useEffect นี้: เพื่อจัดการกับ imageUri ที่ได้รับ ---
  useEffect(() => {
    // 1. สร้างฟังก์ชัน async ข้างใน useEffect
    const fetchDataAndProcessImage = async () => {
      try {
        // ดึงรหัสเครื่อง
        const storedMachineCode = await getSetting('machineCode');
        if (storedMachineCode !== null) {
          setMachineCode(storedMachineCode);
        }

        // ถ้ามี passedImageUri ส่งเข้ามา (จากการกดแท็บ)
        if (passedImageUri && typeof passedImageUri === 'string') {
          // ตั้งค่า state และสั่งประมวลผลรูปภาพทันที
          setImageUri(passedImageUri);
          await processImage(passedImageUri); // แนะนำให้ใส่ await ด้วย
        }
      } catch (error) {
        console.error("Error during initial data fetch:", error);
        // อาจจะแสดง Alert หรือจัดการข้อผิดพลาดอื่นๆ
      }
    };

    // 2. เรียกใช้ฟังก์ชัน async ที่สร้างขึ้น
    fetchDataAndProcessImage();

  }, [passedImageUri]);




  const processImage = async (uri) => {
    setIsProcessing(true);
    setIsVerified(false);
    setFoundRegisterData(null); // เคลียร์ข้อมูล C7 เก่าทุกครั้งที่สแกนใหม่
    setIsManualEdit(false); // รีเซ็ตสถานะการแก้ไข
    try {
      const formData = new FormData();
      formData.append('image', {
        uri: uri,
        type: 'image/jpeg',
        name: `image_${Date.now()}.jpg`,
      });

      const response = await fetch(
        "https://license-plate-service-833646348122.asia-southeast1.run.app/detect",
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

      // 1. ตั้งค่า state ตามข้อมูลที่ได้มาเสมอ (แม้จะไม่ครบ)
      // ใช้ || '' เพื่อป้องกันค่า null หรือ undefined ที่อาจทำให้แอปแครช
      const detectedPlate = data.license_plate || '';
      const detectedProvince = data.province || '';

      // เก็บค่าที่สแกนได้ครั้งแรก (สำคัญมาก!)
      setOriginalDetectedPlate(detectedPlate);
      setOriginalDetectedProvince(detectedProvince);

      setLicensePlate(detectedPlate);
      setProvince(detectedProvince);

      // ✅ ค้นหา C7 ในฐานข้อมูลทันที
      await checkWithRegisterList(detectedPlate, detectedProvince);

      // 3. ✨ จุดสำคัญ: ตรวจสอบว่าข้อมูลที่จำเป็นครบถ้วนหรือไม่
      if (!detectedPlate || !detectedProvince) {
        // ถ้าข้อมูลไม่ครบ ให้เรียก Modal แก้ไขขึ้นมาทันที
        // ฟังก์ชันนี้จะดึงค่าล่าสุดจาก state (ที่อาจจะไม่ครบ) ไปใส่ในฟอร์มให้เอง
        console.log('detectedPlate :>> ', detectedPlate);
        console.log('detectedProvince :>> ', detectedProvince);
        openEditModal(detectedPlate, detectedProvince);
      }

    } catch (error) {

      openEditModal(null, null)
      Alert.alert('ข้อผิดพลาด', error.message);
    } finally {
      setIsProcessing(false);

    }
  };


  const checkWithRegisterList = async (plate, prov) => {
    if (!plate || !prov || !activeProject) {
      setIsVerified(false);
      return;
    }

    try {
      console.log(`Searching for Plate: ${plate}, Province: ${prov}, ProjectID: ${activeProject.project_id}`);
      const foundRegister = await findRegisterByPlate(activeProject.project_id, plate, prov);

      if (foundRegister) {
        console.log('✅ C7 Record Found:', foundRegister);
        setIsVerified(true); // ตั้งสถานะเป็น "ตรวจสอบแล้ว"
        setFoundRegisterData(foundRegister); // เก็บข้อมูล C7 ทั้งหมดไว้ใน state

        // กรอกข้อมูลจาก C7 ลงในฟอร์มอัตโนมัติ
        setVehicleType(foundRegister.bus_type);
      } else {
        console.log('❌ C7 Record Not Found.');
        setIsVerified(false);
        setFoundRegisterData(null); // เคลียร์ข้อมูลเก่า
      }
    } catch (error) {
      console.error('Failed to check with register list', error);
      setIsVerified(false);
    }
  };


  const handlePrintAndSave = async () => {
    if (isSubmitting || !activeProject) return;

    // --- Validation ---
    if (!licensePlate.trim() || !province || !vehicleType) {
      Alert.alert('ข้อมูลไม่ครบ', 'กรุณากรอกข้อมูลทะเบียนรถ จังหวัด และประเภทรถให้ครบถ้วน');
      return;
    }

    if (vehicleType === 'Other' && !customVehicleType.trim()) {
      Alert.alert('ข้อมูลไม่ครบ', 'กรุณาระบุประเภทรถในช่อง "โปรดระบุประเภทรถ"');
      return;
    }

    setIsSubmitting(true);

    const session = await getActiveSession();
    if (!session || !session.userId) {
      throw new Error("ไม่พบข้อมูลผู้ใช้งาน, กรุณาเข้าสู่ระบบใหม่");
    }

    const finalVehicleType = vehicleType === 'Other' ? customVehicleType : vehicleType;

    // ✅ สร้าง Object newCheckInData ตามโครงสร้างที่ต้องการ
    const newCheckInData = {
      project_id: activeProject.project_id,
      register_id: foundRegisterData?.register_id || null,
      detect_plate_no: originalDetectedPlate,
      detect_plate_province: originalDetectedProvince,
      plate_no: licensePlate,
      plate_province: province,
      is_plate_manual: isManualEdit ? 1 : 0,
      photo_path: imageUri,
      bus_type: finalVehicleType,
      passenger: foundRegisterData?.passenger || '0|0|0|0',
      note: '',
      comp_id: machineCode,
      activity_seq_no: activeProject?.activity_id || null,
      printed: isVerified ? 1 : 0, // 🔄 แก้ไข: is_print -> printed, และใช้ 1 หรือ 0
      created_by: session.userId,
      foundRegisterData: JSON.stringify(foundRegisterData || null), // เพิ่มข้อมูล C7 ที่พบ (ถ้ามี)
    };

    // ส่งข้อมูลทั้งหมดไปที่หน้าใหม่
    router.push({
      pathname: '/passenger_count', // เราจะสร้างไฟล์นี้ในขั้นตอนถัดไป
      params: newCheckInData,
      // params: {
      //   licensePlate: licensePlate,
      //   province: province,
      //   vehicleType: finalVehicleType,
      //   stickerNumber: stickerNumber,
      //   imageUri: imageUri,
      // },
    });

    // ตั้งค่า isSubmitting กลับเป็น false เมื่อผู้ใช้กดกลับมาที่หน้านี้
    // หรือปล่อยให้ state หายไปเองตอน unmount ก็ได้
    setTimeout(() => setIsSubmitting(false), 1000);
  };

  // const selectVehicleType = async (type) => {
  //   setVehicleType(type);
  //   setShowReceipt(true);

  //   // รอให้ Receipt render เสร็จก่อน
  //   setTimeout(async () => {
  //     await generateAndPrint();
  //   }, 500);
  // };

  // const selectCustomVehicleType = async () => {
  //   if (!customVehicleType.trim()) {
  //     Alert.alert('แจ้งเตือน', 'กรุณากรอกประเภทรถ');
  //     return;
  //   }
  //   setVehicleType(customVehicleType);
  //   setShowReceipt(true);

  //   setTimeout(async () => {
  //     await generateAndPrint();
  //   }, 500);
  // };

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
      await BluetoothEscposPrinter.printText('\r\n', {});

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
      setIsSubmitting(false);
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
    // setShowReceipt(false);
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

    router.push('/main');
    setIsSubmitting(false);
  };

  const cancelProcess = () => {
    setIsProcessing(false);
    setImageUri(null);
    setLicensePlate('');
    setProvince(null);
    // setVehicleType(null);
    setCustomVehicleType(''); // <-- เพิ่มบรรทัดนี้
    setStickerNumber('');
    // setShowReceipt(false);
    setIsVerified(false);
    router.push('/main');
    setIsSubmitting(false);
  }

  // const renderMasterItem = ({ item }) => (

  //   <View style={styles.masterItem}>
  //     <View style={styles.masterItemHeader}>
  //       <Text style={styles.masterItemPlate}>{item.plate}</Text>
  //       <Text style={styles.masterItemDetail}>{item.province}</Text>
  //     </View>
  //     {item.vehicleType && <Text style={styles.noMasterDataText}>{item.vehicleType}</Text>}
  //   </View>
  // );

  // // สร้าง Component สำหรับ Header ของ FlatList
  // const renderListHeader = () => (
  //   <Text style={styles.initialTitle}>C7 ที่ลงทะเบียนแล้ว</Text>
  // );

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

  const openEditModal = (plateToEdit, provinceToEdit) => {
    // ใช้ค่าที่ส่งเข้ามาโดยตรง ไม่ต้องอ่านจาก state
    setTempLicensePlate(plateToEdit);
    setTempProvince(provinceToEdit);
    setIsEditModalVisible(true);
  };

  const handleSaveChanges = async () => {
    // 1. ตั้งค่า state ว่ามีการแก้ไขด้วยมือเกิดขึ้นแล้ว
    setIsManualEdit(true);

    // 2. อัปเดตทะเบียนและจังหวัดที่แสดงผลบนหน้าจอหลัก
    setLicensePlate(tempLicensePlate);
    setProvince(tempProvince);

    // 3. ✅ เรียกใช้ฟังก์ชันค้นหา C7 ใหม่อีกครั้งด้วยข้อมูลที่ผู้ใช้เพิ่งกรอก
    // เราใช้ค่าจาก temp state เพราะเป็นค่าล่าสุดที่ผู้ใช้ยืนยัน
    await checkWithRegisterList(tempLicensePlate, tempProvince);

    // 4. ปิด Modal แก้ไข
    setIsEditModalVisible(false);
  };

  return (
    <View style={styles.container}>
      <View style={styles.tabMobile}>
      </View>
      <View style={styles.content}>
        {!imageUri ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#3498db" />
            <Text style={styles.loadingText}>กำลังเตรียมข้อมูล...</Text>
          </View>
        ) : isProcessing ? (
          // ถ้ากำลังประมวลผลภาพ ก็แสดง loading
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#3498db" />
            <Text style={styles.loadingText}>กำลังประมวลผลภาพ...</Text>
          </View>
        ) : (

          <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 10 }}
            keyboardShouldPersistTaps="handled">

            {/* ========== ส่วนฟอร์มหลังถ่ายภาพ ========== */}

            <View style={styles.formContainer}>
              <TouchableOpacity onPress={() => setIsImageModalVisible(true)}>
                <Image source={{ uri: imageUri }} style={styles.previewImage} />
              </TouchableOpacity>

              <LicensePlateDisplay
                plate={licensePlate}
                province={province}
                onEditPress={() => openEditModal(licensePlate, province)}
              />

              {/* ✅ ย้ายมาไว้ตรงนี้ และใช้สไตล์ใหม่ */}
              {!isVerified && licensePlate.trim() !== '' && (
                <View style={styles.errorBanner}>
                  <Ionicons name="alert-circle-outline" size={20} color="#fff" />
                  <Text style={styles.errorBannerText}>ไม่พบC7</Text>
                </View>
              )}


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

              {/* <View style={styles.inputGroup}>
                <Text style={styles.label}>เลขสติกเกอร์</Text>
                <TextInput
                  style={styles.input}
                  placeholder="เลขสติกเกอร์"
                  value={stickerNumber}
                  onChangeText={setStickerNumber}
                  keyboardType="number-pad"
                />
              </View> */}

              <View style={styles.menuFooter} >

                <TouchableOpacity style={styles.cancelButton} onPress={cancelProcess}>
                  <Text style={styles.cancelButtonText}>ยกเลิก</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  // ✅ 1. เพิ่มเงื่อนไข !isVerified เข้าไปในการกำหนด style
                  style={[styles.confirmButton, (isSubmitting || !isVerified) && styles.buttonDisabled]}
                  onPress={handlePrintAndSave}
                  // ✅ 2. เพิ่มเงื่อนไข !isVerified เข้าไปในการปิดใช้งานปุ่ม
                  disabled={isSubmitting || !isVerified}
                >
                  {isSubmitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.confirmButtonText}>ต่อไป</Text>
                  )}
                </TouchableOpacity>




              </View>
            </View>

            {/* Hidden Receipt for printing */}

          </ScrollView>)
        }
      </View>

      {/* Modal สำหรับแสดงรูปภาพเต็มจอ */}
      <Modal
        visible={isImageModalVisible}
        transparent={true}
        onRequestClose={() => setIsImageModalVisible(false)}
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
            <Image source={{ uri: imageUri }} style={styles.fullscreenImage} />
          </ImageZoom>
          <TouchableOpacity style={styles.closeButton} onPress={() => setIsImageModalVisible(false)}>
            <Text style={styles.closeButtonText}>X</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* เพิ่ม Modal นี้เข้าไปในส่วนท้ายของ return */}
      <Modal
        visible={isEditModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsEditModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainerModel}>
            <Text style={styles.modalTitleModel}>แก้ไขข้อมูลทะเบียน</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>ทะเบียนรถ</Text>
              <TextInput
                style={styles.input}
                value={tempLicensePlate}
                onChangeText={setTempLicensePlate}
                placeholder="กรอกทะเบียนรถ"
              />
            </View>

            <View style={[styles.inputGroup, { zIndex: 5000 }]}>
              <Text style={styles.label}>จังหวัด</Text>
              <DropDownPicker
                open={provinceOpen}
                value={tempProvince}
                items={THAI_PROVINCES}
                setOpen={setProvinceOpen}
                setValue={setTempProvince}
                searchable={true}
                placeholder="เลือกจังหวัด"
                listMode="MODAL" // MODAL mode is better for modals
                style={styles.dropdown}
              />
            </View>

            <View style={styles.modalButtonContainerModel}>
              <TouchableOpacity
                style={[styles.modalButtonModel, styles.cancelButtonModal]}
                onPress={() => setIsEditModalVisible(false)}
              >
                <Text style={styles.modalButtonText}>ยกเลิก</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButtonModel, styles.saveButtonModal]}
                onPress={handleSaveChanges}
              >
                <Text style={styles.modalButtonText}>บันทึก</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View >
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
    fontSize: 20,
    color: 'black',
    fontFamily: 'Sarabun-Regular',
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
    padding: 5,
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
    marginTop: 0,
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
    marginVertical: 2,
  },
  receiptLabel: {
    fontSize: 18,
    fontWeight: 'bold',
    fontFamily: 'Sarabun-Regular',
    marginVertical: 0,
  },
  receiptValue: {
    fontSize: 18,
    fontFamily: 'Sarabun-Regular',
    marginVertical: 0,
  },
  formContainer: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    marginHorizontal: 1,
    marginTop: 5,
    shadowRadius: 8,
    elevation: 3,
  },
  previewImage: {
    width: '100%',
    height: 180,
    borderRadius: 15,
    marginBottom: 20,
    backgroundColor: '#e9ecef',
  },
  inputGroup: {
    marginBottom: 5,
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
  // confirmButton: {
  //   backgroundColor: '#2ecc71',
  //   borderRadius: 12,
  //   padding: 16,
  //   alignItems: 'center',
  //   marginTop: 20,
  // },
  // confirmButtonText: {
  //   color: '#fff',
  //   fontSize: 16,
  //   fontWeight: '600',
  // },
  // cancelButton: {
  //   backgroundColor: '#e74c3c',
  //   borderRadius: 12,
  //   padding: 16,
  //   marginTop: 10,
  //   alignItems: 'center',
  // },
  // cancelButtonText: {
  //   color: '#fff',
  //   fontSize: 16,
  //   fontWeight: '600',
  // },

  // --- Modal Styles ---
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    borderRadius: 20,
  },
  loadingText: {
    marginTop: 15,
    fontSize: 16,
    color: '#34495e',
    fontWeight: '600',
  },
  tabMobile: {
    height: 25,
    backgroundColor: 'black',
    borderBottomWidth: 1,
    // borderColor:'#e9ecef',
    justifyContent: 'center',
    alignItems: 'center'
  },
  menuFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignContents: 'center',
    marginTop: 10,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainerModel: {
    width: '90%',
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 20,
  },
  modalTitleModel: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  modalButtonContainerModel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 30,
    zIndex: -1, // แก้ปัญหา Dropdown ทับปุ่ม
  },
  modalButtonModel: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  cancelButtonModal: {
    backgroundColor: '#bdc3c7',
    marginRight: 10,
  },
  saveButtonModal: {
    backgroundColor: '#2ecc71',
    marginLeft: 10,
  },
  modalButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
  },
  buttonDisabled: {
    backgroundColor: '#95a5a6', // สีเทาเมื่อปิดใช้งาน
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e74c3c', // สีแดงสำหรับ Error
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 8, // ระยะห่างจากด้านบน
    marginBottom: 16, // ระยะห่างจากฟอร์มด้านล่าง
  },
  errorBannerText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    marginLeft: 10,
  },
});