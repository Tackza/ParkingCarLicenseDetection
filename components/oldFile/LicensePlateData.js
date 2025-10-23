import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Base64Image from '../base64Image';

const LicensePlateScanner = () => {
  const [imageUri, setImageUri] = useState(null);
  const [licensePlate, setLicensePlate] = useState('');
  const [province, setProvince] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [stickerNumber, setStickerNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [dataToSend, setDataToSend] = useState(null);

  // ขออนุญาตใช้กล้อง
  const requestPermissions = async () => {
    const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
    const mediaPermission = await MediaLibrary.requestPermissionsAsync();

    if (cameraPermission.status !== 'granted' || mediaPermission.status !== 'granted') {
      Alert.alert('ขออนุญาต', 'กรุณาอนุญาตให้เข้าถึงกล้องและคลังรูปภาพ');
      return false;
    }
    return true;
  };

  // ถ่ายรูป
  const takePhoto = async () => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        aspect: [16, 9],
        quality: 1,
        allowsMultipleSelection: false,
        exif: false,
        cameraType: ImagePicker.CameraType.back,
      });

      console.log('result :>> ', result);

      if (!result.canceled && result.assets && result.assets.length > 0) {
        // const resizedUri = await resizeImage(result.assets[0]);
        await processImage(result.assets[0].uri);
      }
    } catch (error) {
      Alert.alert('ผิดพลาด', 'ไม่สามารถเปิดกล้องได้');
      console.error(error);
    }
  };

  const resizeImage = async (result) => {
    try {
      let quality = 50;

      const { width, height } = result;
      const aspectRatio = width / height;
      const targetSize = 800;
      let cropSize;
      console.log("aspectRatio :>> ", aspectRatio);
      if (aspectRatio > 1) {
        cropSize = height;
        const offsetX = (width - height) / 2;
        const manipResult = await ImageManipulator.manipulateAsync(
          result.uri,
          [
            {
              crop: {
                originX: offsetX,
                originY: 0,
                width: cropSize,
                height: cropSize,
              },
            },
            { resize: { width: targetSize, height: targetSize } },
          ],
          { compress: quality / 100, format: ImageManipulator.SaveFormat.JPEG }
        );
        const getSizeImageAfterCompress =
          await ImageManipulator.manipulateAsync(manipResult.uri, [], {
            compress: quality / 100,
            format: ImageManipulator.SaveFormat.JPEG,
          });

        console.log(
          "getSizeImageAfterCompress :>> ",
          getSizeImageAfterCompress
        );

        return manipResult.uri;
      } else {
        cropSize = width;
        const offsetY = (height - width) / 2;
        const manipResult = await ImageManipulator.manipulateAsync(
          result.uri,
          [
            {
              crop: {
                originX: 0,
                originY: offsetY,
                width: cropSize,
                height: cropSize,
              },
            },
            { resize: { width: targetSize, height: targetSize } },
          ],
          {
            compress: quality / 100,
            format: ImageManipulator.SaveFormat.JPEG,
          }
        );

        const getSizeImageAfterCompress =
          await ImageManipulator.manipulateAsync(manipResult.uri, [], {
            compress: quality / 100,
            format: ImageManipulator.SaveFormat.JPEG,
          });

        console.log(
          "getSizeImageAfterCompress :>> ",
          getSizeImageAfterCompress
        );

        return manipResult.uri;
      }
    } catch (error) {
      console.error("Error resizing image:", error);
      // หากการ resize ล้มเหลว ให้ใช้ภาพต้นฉบับ
      return result;
    }
  };

  // เลือกรูปจากคลัง
  const pickImage = async () => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.8,
        allowsMultipleSelection: false,
        exif: false,
        cameraType: ImagePicker.CameraType.back,
      });

      if (!result.canceled) {
        await processImage(result.assets[0].uri);
      }
    } catch (error) {
      Alert.alert('ผิดพลาด', 'ไม่สามารถเลือกรูปภาพได้');
      console.error(error);
    }
  };

  // ปรับแต่งและบีบอัดรูปภาพ
  const processImage = async (uri) => {
    try {
      setLoading(true);

      // ปรับขนาดและบีบอัดรูป
      const manipResult = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 800 } }], // ปรับขนาดความกว้างเป็น 800px
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
      );

      setImageUri(manipResult.uri);
      console.log('manipResult.uri :>> ', manipResult.uri);

      // ส่งรูปไปยัง API เพื่อตรวจจับทะเบียน
      await sendImageToAPI(manipResult.uri);

    } catch (error) {
      Alert.alert('ผิดพลาด', 'ไม่สามารถประมวลผลรูปภาพได้');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // ส่งรูปไปยัง API
  const sendImageToAPI = async (uri) => {
    try {
      setLoading(true);
      // สร้าง FormData สำหรับส่งรูปภาพ
      const formData = new FormData();
      formData.append('image', {
        uri: uri,
        type: 'image/jpeg',
        name: `image_${Date.now()}.jpg`,

      });


      // เปลี่ยน URL นี้เป็น API ของคุณ
      const response = await fetch(
        "https://mbus-detect-yolo-api-833646348122.asia-southeast1.run.app/detect",
        {
          method: "POST",
          headers: {
            "Content-Type": "multipart/form-data",
          },
          body: formData,
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Error data from server:', errorData); // <--- นี่คือสิ่งที่คุณต้องดู!
        throw new Error(`Server error: ${JSON.stringify(errorData)}`);
      }

      const { data } = await response.json();
      console.log("data :>> ", data);


      // สมมติว่า API ส่งกลับมาในรูปแบบนี้
      // { licensePlate: "กก-1234", province: "กรุงเทพมหานคร" }
      if (data.license_plate) {
        setLicensePlate(data.license_plate);
      }
      if (data.province) {
        setProvince(data.province);
      }

      Alert.alert('สำเร็จ', 'ตรวจจับทะเบียนรถสำเร็จ');

    } catch (error) {
      Alert.alert('ผิดพลาด', 'ไม่สามารถส่งข้อมูลไปยัง API ได้\n' + error.message);
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // บันทึกข้อมูล
  const saveData = async () => {
    if (!licensePlate || !province || !vehicleType || !stickerNumber) {
      Alert.alert('แจ้งเตือน', 'กรุณากรอกข้อมูลให้ครบถ้วน');
      return;
    }

    try {
      setLoading(true);

      // สร้างข้อมูลที่จะส่ง
      const dataToSend = {
        licensePlate,
        province,
        vehicleType,
        stickerNumber,
        imageUri,
        timestamp: new Date().toISOString(),
      };

      setDataToSend(dataToSend);

      // บันทึกรูปลงใน Media Library
      if (imageUri) {
        await MediaLibrary.saveToLibraryAsync(imageUri);
      }

      // ส่งข้อมูลไปยัง API (เปลี่ยน URL ตามที่ต้องการ)
      // const response = await fetch('https://your-api-endpoint.com/save-vehicle', {
      //   method: 'POST',
      //   headers: {
      //     'Content-Type': 'application/json',
      //     // 'Authorization': 'Bearer YOUR_TOKEN',
      //   },
      //   body: JSON.stringify(dataToSend),
      // });

      // if (!response.ok) {
      //   throw new Error('Failed to save data');
      // }

      Alert.alert('สำเร็จ', 'บันทึกข้อมูลเรียบร้อย', [
        {
          text: 'ตรวจสอบคันใหม่',
          onPress: resetForm,
        },
      ]);

    } catch (error) {
      Alert.alert('ผิดพลาด', 'ไม่สามารถบันทึกข้อมูลได้');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // รีเซ็ตฟอร์ม
  const resetForm = () => {
    setImageUri(null);
    setLicensePlate('');
    setProvince('');
    setVehicleType('');
    setStickerNumber('');
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>ระบบถ่ายภาพทะเบียนรถ</Text>

        {/* ปุ่มถ่ายรูปและเลือกรูป */}

        {dataToSend && (<Base64Image dataToSend={dataToSend} />)}

        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.button} onPress={takePhoto}>
            <Text style={styles.buttonText}>📷 ถ่ายรูป</Text>
          </TouchableOpacity>

          {/* <TouchableOpacity style={styles.button} onPress={pickImage}>
            <Text style={styles.buttonText}>🖼️ เลือกรูป</Text>
          </TouchableOpacity> */}
        </View>

        {/* แสดงรูปภาพ */}
        {imageUri && (
          <View style={styles.imageContainer}>
            <Image source={{ uri: imageUri }} style={styles.image} />
          </View>
        )}

        {/* แสดง Loading */}
        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.loadingText}>กำลังประมวลผล...</Text>
          </View>
        )}

        {/* ฟอร์มกรอกข้อมูล */}
        <View style={styles.form}>
          <Text style={styles.label}>ทะเบียนรถ</Text>
          <TextInput
            style={styles.input}
            value={licensePlate}
            onChangeText={setLicensePlate}
            placeholder="เช่น กก-1234"
            editable={!loading}
          />

          <Text style={styles.label}>จังหวัด</Text>
          <TextInput
            style={styles.input}
            value={province}
            onChangeText={setProvince}
            placeholder="เช่น กรุงเทพมหานคร"
            editable={!loading}
          />

          <Text style={styles.label}>ประเภทรถ *</Text>
          <TextInput
            style={styles.input}
            value={vehicleType}
            onChangeText={setVehicleType}
            placeholder="เช่น รถเก๋ง, รถกระบะ, มอเตอร์ไซค์"
            editable={!loading}
          />

          <Text style={styles.label}>เลขสติกเกอร์ *</Text>
          <TextInput
            style={styles.input}
            value={stickerNumber}
            onChangeText={setStickerNumber}
            placeholder="เช่น 123456"
            keyboardType="numeric"
            editable={!loading}
          />
        </View>

        {/* ปุ่มบันทึก */}
        <TouchableOpacity
          style={[styles.saveButton, loading && styles.disabledButton]}
          onPress={saveData}
          disabled={loading}
        >
          <Text style={styles.saveButtonText}>
            {loading ? 'กำลังบันทึก...' : '💾 บันทึกข้อมูล'}
          </Text>
        </TouchableOpacity>

        {/* ปุ่มรีเซ็ต */}
        <TouchableOpacity
          style={styles.resetButton}
          onPress={resetForm}
          disabled={loading}
        >
          <Text style={styles.resetButtonText}>🔄 เริ่มใหม่</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
    color: '#333',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  button: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginHorizontal: 5,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  imageContainer: {
    marginBottom: 20,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  image: {
    width: '100%',
    height: 250,
    resizeMode: 'contain',
  },
  loadingContainer: {
    alignItems: 'center',
    marginVertical: 20,
  },
  loadingText: {
    marginTop: 10,
    color: '#666',
    fontSize: 14,
  },
  form: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 10,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
    marginTop: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
    backgroundColor: '#f9f9f9',
  },
  saveButton: {
    backgroundColor: '#34C759',
    padding: 18,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  disabledButton: {
    backgroundColor: '#ccc',
  },
  saveButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  resetButton: {
    backgroundColor: '#FF3B30',
    padding: 18,
    borderRadius: 10,
    alignItems: 'center',
  },
  resetButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default LicensePlateScanner;