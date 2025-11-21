import { Ionicons } from '@expo/vector-icons';
// import * as ImagePicker from 'expo-image-picker';
import { useMode } from "@/contexts/ModeContext";
import axios from 'axios';
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
import ViewShot, { captureRef } from 'react-native-view-shot';
import LicensePlateDisplay from '../../components/LicensePlateDisplay';
import { findRegisterByPlate, getActiveSession, getSetting, insertCheckIn } from '../../constants/Database';
import { THAI_PROVINCES } from '../../constants/provinces';
import { useProject } from '../../contexts/ProjectContext';
import { useEnvironment } from '../../contexts/EnvironmentContext';
import * as Speech from 'expo-speech';
import { createSpokenPlate } from '@/utils/speechUtils';

const IMAGE_PROCESSING_TIMEOUT = 15000;

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
  const [customVehicleType, setCustomVehicleType] = useState('');
  const [showReceipt, setShowReceipt] = useState(false);
  const receiptRef = React.useRef();
  const router = useRouter();
  const [isVerified, setIsVerified] = useState(false);

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
  const [sessionData, setSessionData] = useState(null);
  const { isModeOne } = useMode();
  const { environment } = useEnvironment();

  const API_URL = environment === 'prod' ?
    "https://mbus.dhammakaya.network/api" :
    "https://mbus-test.dhammakaya.network/api";


  // --- เพิ่ม useEffect นี้: เพื่อจัดการกับ imageUri ที่ได้รับ และดึง session + machineCode ---
  useEffect(() => {
    const fetchDataAndProcessImage = async () => {
      console.log('isModeOne :>> ', isModeOne ? 'โหมดทั่วไป' : 'โหมดธุดงค์');
      try {
        // ดึง session และเก็บเข้า state
        const session = await getActiveSession();
        console.log('session :>> ', session);
        setSessionData(session); // ✅ เก็บ session ไว้ใน state

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

  }, [passedImageUri]); // Dependency: passedImageUri (จะทำงานเมื่อมีการส่งรูปเข้ามา)

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

      // ✅ ใช้ axios.post แทน fetch
      const response = await axios.post(
        "https://license-plate-service-833646348122.asia-southeast1.run.app/detect",
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
            // 'Content-Type' ไม่จำเป็นต้องเซ็ตเองสำหรับ FormData ใน Axios
          },
          timeout: IMAGE_PROCESSING_TIMEOUT, // ✅ กำหนด timeout ตรงนี้
        }
      );

      // Axios จะโยน error ให้เองถ้า response.status ไม่อยู่ในช่วง 2xx
      // ไม่ต้องเช็ค if (!response.ok) แล้ว
      const { data } = response.data; // ✅ ข้อมูลจะอยู่ใน response.data.data

      const detectedPlate = data.license_plate || '';
      const detectedProvince = data.province || '';

      setOriginalDetectedPlate(detectedPlate);
      setOriginalDetectedProvince(detectedProvince);
      console.log('detectedPlate :>> ', detectedPlate);
      console.log('detectedProvince :>> ', detectedProvince);

      setLicensePlate(detectedPlate);
      // ตรวจสอบว่ามีจังหวัดในรายการหรือไม่
      const provinceExists = checkProvinceExists(detectedProvince)
      setProvince(provinceExists);

      // "แปล" ทะเบียนรถ โดยเรียกใช้ฟังก์ชันจาก utils
      const spokenPlate = createSpokenPlate(detectedPlate); // 👈 ใช้งานได้เลย

      // สร้างประโยคเต็มๆ
      const finalSpokenText = `ทะเบียน,  
      ${spokenPlate || 'ไม่พบทะเบียน'}, ${provinceExists || 'ไม่พบจังหวัด'}`;

      // สั่งให้พูด!
      Speech.stop();
      Speech.speak(finalSpokenText, {
        language: 'th-TH',
        rate: 0.9
      });

      await checkWithRegisterList(detectedPlate, provinceExists);

      if (!detectedPlate || !provinceExists) {

        openEditModal(detectedPlate, provinceExists);
      }

    } catch (error) {
      // ✅ การจัดการ Error ของ Axios
      if (axios.isCancel(error)) { // ไม่น่าจะเกิดขึ้นในกรณี timeout, แต่เผื่อไว้
        console.log('Request cancelled:', error.message);
        openEditModal(null, null);
        Alert.alert(
          'การเชื่อมต่อถูกยกเลิก',
          'การประมวลผลถูกยกเลิก กรุณาลองใหม่อีกครั้ง'
        );
      } else if (error.code === 'ECONNABORTED' && error.message.includes('timeout')) {
        // ✅ Error สำหรับ Timeout
        console.log('Image processing request timed out after 15 seconds.');
        openEditModal(null, null); // เปิด Modal ให้กรอกเอง
        Alert.alert(
          'การเชื่อมต่อหมดเวลา',
          'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ตรวจจับทะเบียนรถได้ภายใน 15 วินาที กรุณาลองใหม่อีกครั้ง หรือกรอกข้อมูลเอง'
        );
      } else if (error.response) {
        // Server ตอบกลับมา แต่เป็นสถานะ Error (เช่น 4xx, 5xx)
        console.log('Server error response:', error.response.status, error.response.data);
        openEditModal(null, null);
        Alert.alert('ข้อผิดพลาดจากเซิร์ฟเวอร์', error.response.data.message || 'ไม่สามารถตรวจจับทะเบียนรถได้');
      } else if (error.request) {
        // Request ถูกส่งไปแล้ว แต่ไม่มี response กลับมา (เช่น ไม่มีเน็ต, Server ไม่ตอบ)
        console.log('No response received:', error.request);
        // Alert.alert(
        //   'ไม่มีการเชื่อมต่ออินเทอร์เน็ต',
        //   'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ตรวจจับทะเบียนรถได้ กรุณาตรวจสอบการเชื่อมต่อ หรือกรอกข้อมูลเอง'
        // );
        openEditModal(null, null);
      } else {
        // Error อื่นๆ
        console.log('Axios Error:', error.message);
        Alert.alert('ข้อผิดพลาด', error.message || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ');
        openEditModal(null, null);
      }
    } finally {
      setIsProcessing(false);
    }
  };


  const convertBusTypeToLabel = (value) => {
    const found = vehicleTypes.find(item => item.value === value);
    return found ? found.label : value;
  }



  const handlePrintAndSave = async () => {
    if (isSubmitting || !activeProject) return;
    // --- Validation ---
    if (!licensePlate.trim() || !province || !vehicleType) {
      Alert.alert('ข้อมูลไม่ครบ', 'กรุณากรอกข้อมูลให้ครบถ้วน');
      return;
    }


    // --- Validation เพิ่มเติมสำหรับประเภทรถ 'อื่นๆ' ---
    if (vehicleType === 'Other' && !customVehicleType.trim()) {
      Alert.alert('ข้อมูลไม่ครบ', 'กรุณาระบุประเภทรถในช่อง "โปรดระบุประเภทรถ"');
      return;
    }


    if (!stickerNumber.trim() && !isModeOne) {
      Alert.alert('ข้อมูลไม่ครบ', 'กรุณากรอกหมายเลขสติกเกอร์');
      return;
    }

    setIsSubmitting(true);

    try {
      if (!sessionData || !sessionData.userId) { // ✅ ใช้ sessionData จาก state
        throw new Error("ไม่พบข้อมูลผู้ใช้งาน, กรุณาเข้าสู่ระบบใหม่");
      }

      // กำหนดค่าประเภทรถสุดท้าย หากเลือก 'Other'
      const finalVehicleType = vehicleType === 'Other' ? customVehicleType : convertBusTypeToLabel(vehicleType);

      console.log('activeProject :>> ', activeProject);
      console.log('foundRegisterData :>> ', foundRegisterData);


      // ✅ สร้าง Object newCheckInData ตามโครงสร้างที่ต้องการ
      let newCheckInData = {
        uid: foundRegisterData.uid,
        project_id: activeProject.project_id,
        activity_id: activeProject.activity_id,
        register_id: foundRegisterData?.register_id || null,
        detect_plate_no: originalDetectedPlate,
        detect_plate_province: originalDetectedProvince,
        plate_no: licensePlate,
        plate_province: province,
        is_plate_manual: isManualEdit ? 1 : 0,
        code: foundRegisterData?.short_code || '',
        photo_path: imageUri,
        bus_type: finalVehicleType,
        passenger: foundRegisterData?.passenger || '0|0|0|0', // ✅ passenger มาจาก foundRegisterData
        note: '', // ✅ ตรวจสอบว่ามี source สำหรับ note หรือไม่
        sticker_no: isModeOne ? "" : stickerNumber, // ✅ เพิ่ม sticker_no จาก state
        comp_id: machineCode, // ✅ comp_id ควรมาจาก machineCode ที่คุณดึงมา
        seq_no: activeProject?.seq_no || null, // ✅ seq_no มาจาก activeProject
        printed: isVerified ? 1 : 0, // ✅ `printed` ตอนนี้เปลี่ยนเป็น 1 ถ้า verified, 0 ถ้ายังไม่ verified
        error_msg: '',
        created_by: sessionData.userId,
        // synced และ sync_at ไม่ต้องใส่ตรงนี้ เพราะมี DEFAULT values และจะถูก update ตอน sync
      };
      console.log('newCheckInData :>> ', newCheckInData);


      // isModeOne ? 'ธรรมดา' : 'ธุดงค์'
      if (isModeOne) {
        newCheckInData = {
          ...newCheckInData,
          sticker_no: "", // เว้นว่างในโหมด 1
          foundRegisterData: JSON.stringify(foundRegisterData || null)
        }
        // ส่งข้อมูลทั้งหมดไปที่หน้าใหม่
        router.push({
          pathname: '/passenger_count',
          params: newCheckInData,
        });
        setIsSubmitting(false);
        return
      }

      // ✅ เรียกใช้ฟังก์ชัน insertCheckIn เพื่อบันทึกลง SQLite
      const newId = await insertCheckIn(newCheckInData);
      console.log(`✅ Check-in record saved with local ID: ${newId}`);


      setShowReceipt(true);
      // รอให้ Receipt component render ข้อมูลใหม่เสร็จก่อน

      const uid = newCheckInData.uid || 0;
      const seqNumber = newCheckInData.seq_no;
      const urlFromResponse = `${API_URL}/lpr?q=${uid}${seqNumber}`;
      console.log('urlFromResponse :>> ', urlFromResponse);

      if (isVerified) {
        setTimeout(async () => {
          await generateAndPrint(urlFromResponse);
        }, 500);
        return;
      }
      resetForm();
    }

    catch (error) {
      console.error('Failed to save check-in data:', error);
      Alert.alert('ข้อผิดพลาด', error.message || 'ไม่สามารถบันทึกข้อมูลได้');
      setIsSubmitting(false);
    }
  };



  const generateAndPrint = async (urlFromResponse) => {
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
      await BluetoothEscposPrinter.printerAlign(BluetoothEscposPrinter.ALIGN.CENTER);
      await BluetoothEscposPrinter.printQRCode(
        urlFromResponse, 200,
        BluetoothEscposPrinter.ERROR_CORRECTION.L,
      );
      await BluetoothEscposPrinter.printText('\r\n\r\n', {});


      resetForm();
    } catch (error) {
      Alert.alert('ข้อผิดพลาด', 'ไม่สามารถพิมพ์ใบทะเบียนได้');
      console.error(error);
      setIsSubmitting(false);
    }
  };

  const clearScanState = () => {
    setIsProcessing(false);
    setImageUri(null);
    setLicensePlate('');
    setProvince(null);
    // setVehicleType(null); // Make sure to reset this too
    setCustomVehicleType('');
    // Don't reset stickerNumber here, handle it separately
    setShowReceipt(false);
    setIsVerified(false);
    setIsManualEdit(false);
    setFoundRegisterData(null);
    setOriginalDetectedPlate('');
    setOriginalDetectedProvince('');
    setIsSubmitting(false); // Reset submitting state too
    router.push('/main'); // Navigate back

  };

  const resetForm = () => {
    clearScanState(); // Call the common reset function
    // Handle sticker number increment separately
    setStickerNumber(currentSticker => {
      const number = parseInt(currentSticker, 10);
      return (!isNaN(number) && number > 0) ? (number + 1).toString() : '';
    });
    // No router.push here; let the calling function handle navigation after reset

  };

  const cancelProcess = () => {
    clearScanState(); // Call the common reset function
    // Reset sticker number without incrementing
  };

  const openEditModal = (plateToEdit, provinceToEdit) => {
    // ใช้ค่าที่ส่งเข้ามาโดยตรง ไม่ต้องอ่านจาก state
    setTempLicensePlate(plateToEdit);
    setTempProvince(provinceToEdit);
    setIsEditModalVisible(true);
  };

  const checkProvinceExists = (provinceName) => {
    provinceName = provinceName.trim();
    const foundInList = THAI_PROVINCES.some(item => item.label === provinceName);
    return foundInList ? provinceName : '';
  };

  const handleSaveChanges = async () => { // ทำให้เป็น async
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

  const checkWithRegisterList = async (plate, prov) => {
    if (!plate || !prov || !activeProject) {
      setIsVerified(false);
      return;
    }

    try {

      const provinceNew = prov.replace('กรุงเทพมหานคร', 'กทม.').trim();
      console.log(`Searching for Plate: ${plate}, Province: ${provinceNew}, ProjectID: ${activeProject.project_id}`);
      const foundRegister = await findRegisterByPlate(activeProject.project_id, plate, provinceNew);

      if (foundRegister) {
        console.log('✅ C7 Record Found:', foundRegister);

        const seqNo = activeProject?.seq_no;
        let duplicateField = null; // ตัวแปรเก็บชื่อ field ที่ซ้ำ
        let hasDuplicate = false;

        // 1. activeProject?.seq_no ไม่มีค่า (เป็น null, undefined, 0)
        if (!seqNo || seqNo === 0) {
          if (foundRegister.checkin_date) { // ตรวจสอบว่า checkin_date 'มีค่า' (ไม่ใช่ null หรือ '')
            hasDuplicate = true;
            duplicateField = 'checkin_date';
          }
        }
        // 2. activeProject?.seq_no == 1
        else if (seqNo == 1) {
          if (foundRegister.activity1_date) { // ตรวจสอบว่า activity1_date 'มีค่า'
            hasDuplicate = true;
            duplicateField = 'activity1_date';
          }
        }
        // 3. activeProject?.seq_no == 2
        else if (seqNo == 2) {
          if (foundRegister.activity2_date) { // ตรวจสอบว่า activity2_date 'มีค่า'
            hasDuplicate = true;
            duplicateField = 'activity2_date';
          }
        }
        // (คุณสามารถเพิ่ม else if (seqNo == 3) ... ได้ในอนาคต)

        // ถ้าตรวจพบว่ามีข้อมูลซ้ำ
        if (hasDuplicate) {
          console.log(`Duplicate check-in detected. Field: ${duplicateField}, Value: ${foundRegister[duplicateField]}`);

          Alert.alert(
            'ลงทะเบียนแล้ว',
            `[${plate} ${prov}] ทะเบียนรถคันนี้ ได้ลงทะเบียนในกิจกรรมนี้ไปแล้ว`,
            [
              {
                text: 'ตกลง',
                // เรียกใช้ cancelProcess() เพื่อล้างค่า state และกลับหน้า main
                onPress: () => cancelProcess(),
              },
            ],
            { cancelable: false } // บังคับให้ผู้ใช้กดยืนยัน
          );

          return; // ‼️ สำคัญมาก: หยุดการทำงาน ไม่ต้อง setIsVerified
        }
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

  // ฟังก์ชันสำหรับแปลง 'ผู้ใหญ่|เด็ก|พระ|สามเณร' เป็นข้อความที่อ่านง่าย
  const formatPassengerInfo = (passengerString) => {
    if (!passengerString || typeof passengerString !== 'string') {
      return '-- คน'; // ค่า default ถ้าไม่มีข้อมูล
    }
    const parts = passengerString.split('|');
    if (parts.length < 4) {
      return '-- คน';
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
                  // listMode="MODAL"
                  style={styles.dropdown}
                  listMode="MODAL" // แนะนำให้ใช้โหมดนี้สำหรับรายการยาวๆ
                  listProps={{
                    keyboardShouldPersistTaps: "always"
                  }}
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
              {isModeOne ? "" : (
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>เลขสติกเกอร์</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="เลขสติกเกอร์"
                    value={stickerNumber}
                    onChangeText={setStickerNumber}
                    keyboardType="number-pad"
                  />
                </View>
              )}
              <View style={styles.menuFooter} >

                <TouchableOpacity style={styles.cancelButton} onPress={cancelProcess}>
                  <Text style={styles.cancelButtonText}>ยกเลิก</Text>
                </TouchableOpacity>

                {/* // ✅ ปรับเงื่อนไขการแสดงผลปุ่มตามโหมด */}
                {/* isModeOne ? 'ธรรมดา' : 'ธุดงค์' */}
                {isModeOne ? (<TouchableOpacity
                  style={[styles.confirmButton, (isSubmitting || !isVerified) && styles.buttonDisabled]}
                  onPress={handlePrintAndSave}
                  disabled={isSubmitting || !isVerified}
                >
                  {isSubmitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.confirmButtonText}>ต่อไป</Text>
                  )}
                </TouchableOpacity>)
                  :
                  (<TouchableOpacity
                    style={[styles.confirmButton, isSubmitting && styles.buttonDisabled]}
                    onPress={handlePrintAndSave}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.confirmButtonText}>
                        {/* ใช้ Ternary Operator เพื่อเปลี่ยนข้อความตาม isVerified */}
                        {isVerified ? 'บันทึกและพิมพ์' : 'บันทึก'}
                      </Text>
                    )}
                  </TouchableOpacity>)}
              </View>
            </View>

            {/* Hidden Receipt for printing */}
            {showReceipt && (
              <View style={{ position: 'absolute', left: -10000 }}>
                {/* <View style={{ position: 'absolute' }}> */}
                <ViewShot ref={receiptRef} style={styles.receiptContainer}>
                  <Text style={styles.textCenter}>! เอกสารสำคัญ ห้ามทำหาย !</Text>

                  <View style={[styles.receiptRow, { marginTop: 1, marginBottom: 1 }]}>
                    <Text style={styles.receiptMetaSmall}>#{sessionData?.userId || '--'}</Text>

                    <Text style={styles.receiptMetaSmall}>{foundRegisterData?.register_id || '--'}</Text>
                  </View>

                  <Text style={styles.receiptTitle}>ใบลงทะเบียนรถ</Text>
                  {/* ✅ ดึงชื่อโปรเจกต์มาแสดง */}
                  <Text style={styles.receiptSubtitle}>{activeProject?.name || 'ไม่พบชื่อโปรเจกต์'}</Text>

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
                    <Text style={styles.receiptValue}>
                      {vehicleType === 'Other' ? customVehicleType : vehicleType}
                    </Text>
                  </View>

                  {/* ✅ ดึงข้อมูลจาก C7 (foundRegisterData) ถ้ามี */}
                  {foundRegisterData && (
                    <>

                      <View style={styles.receiptRow}>
                        <Text style={styles.receiptLabel}>จุดออกรถ:</Text>
                        <Text style={styles.receiptValue}>{foundRegisterData.station_name || '--'}</Text>
                      </View>
                      <View style={styles.receiptRow}>
                        <Text style={styles.receiptLabel}>จังหวัด:</Text>
                        <Text style={styles.receiptValue}>{foundRegisterData.station_province || '--'}</Text>
                      </View>
                      <View style={styles.receiptRow}>
                        <Text style={styles.receiptLabel}>ผู้โดยสาร:</Text>
                        <Text style={styles.receiptValue}>{formatPassengerInfo(foundRegisterData.passenger)}</Text>
                      </View>
                    </>
                  )}

                  {/* <View style={styles.divider} />

                
                  {stickerNumber && (
                    <View style={styles.receiptRow}>
                      <Text style={styles.receiptLabel}>สติกเกอร์:</Text>
                      <Text style={styles.receiptValue}>{stickerNumber}</Text>
                    </View>
                  )} */}

                  <View style={styles.divider} />

                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>เวลาลงทะเบียน:</Text>
                    <Text style={styles.receiptValue}>
                      {new Date().toLocaleDateString('th-TH-u-ca-buddhist', {
                        year: '2-digit', month: '2-digit', day: '2-digit',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </Text>
                  </View>

                  {/* <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>รหัสยืนยัน:</Text>
                    <Text style={styles.receiptValue}>{foundRegisterData?.register_id || '--'}</Text>
                  </View> */}

                  {/* <View style={styles.divider} /> */}
                </ViewShot>
              </View>
            )}
          </ScrollView>)
        }
      </View >

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
            imageHeight={640}
            minScale={0.8} // อาจจะเพิ่ม minScale เพื่อให้ซูมออกได้
            maxScale={2.5}
          >
            <Image source={{ uri: imageUri }} style={styles.fullscreenImage} resizeMode="contain" />
          </ImageZoom>
          <TouchableOpacity style={styles.closeButton} onPress={() => setIsImageModalVisible(false)}>
            <Text style={styles.closeButtonText}>X</Text>
          </TouchableOpacity>
        </View>
      </Modal >

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
              <Text style={styles.label}>ทะเบียนจังหวัด</Text>
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
      </Modal >
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
    fontFamily: 'Sarabun-Regular',
    marginVertical: 0,
  },
  receiptValue: {
    fontSize: 18,
    fontWeight: 'bold',
    fontFamily: 'Sarabun-Regular',
    marginTop: 5,
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
    marginBottom: 5,
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
    fontSize: 20,
    letterSpacing: 2,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  dropdown: {
    backgroundColor: '#f8f9fa',
    borderColor: '#e9ecef',
  },
  receiptMetaSmall: {
    fontSize: 20,
    color: '#555',
    fontFamily: 'Sarabun-Regular',
    fontWeight: 'bold',
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
    fontSize: 25,
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
    backgroundColor: '#fff', // สีเทาเมื่อปิดใช้งาน
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e74c3c', // สีแดงสำหรับ Error
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 16,
    marginTop: 4, // ระยะห่างจากด้านบน
    marginBottom: 4, // ระยะห่างจากฟอร์มด้านล่าง
  },
  errorBannerText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    marginLeft: 10,
  },
});