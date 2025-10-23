import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Dimensions,
  FlatList,
  Image, // เพิ่มเข้ามา
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
// import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import ImageZoom from 'react-native-image-pan-zoom';
import CheckInSyncManager from '../../components/CheckInSyncManager';
import HistoryItem from '../../components/HistoryItem';
import { getScanHistory } from '../../constants/Database';
import { useProject } from '../../contexts/ProjectContext';
import { useSync } from '../../contexts/SyncContext';

const windowWidth = Dimensions.get('window').width;
const windowHeight = Dimensions.get('window').height;

export default function HistoryScreen() {
  const [history, setHistory] = useState([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const router = useRouter();
  const { isOnline, setIsOnline } = useSync();
  const { activeProject, refreshCurrentProject } = useProject();


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
  useEffect(() => {
    // เมื่อ activeProject เปลี่ยน (หลังจาก refreshCurrentProject) ให้โหลด history
    loadHistory();
  }, [activeProject, loadHistory]);


  // ✅ 2. สร้างฟังก์ชัน loadHistory ที่ขึ้นอยู่กับ activeProject
  const loadHistory = useCallback(async () => {
    // ถ้ายังไม่มีโปรเจกต์ หรือโปรเจกต์กำลังโหลด ให้เคลียร์ history
    if (!activeProject) {
      setHistory([]);
      return;
    }
    try {
      console.log(`Loading history for project ID: ${activeProject.project_id}`);
      // ✅ ตรวจสอบว่า getScanHistory ถูกปรับให้ใช้ `check_ins` table แล้ว
      const data = await getScanHistory(activeProject.project_id);
      setHistory(data);
      // เรียงลำดับจากใหม่ไปเก่า (ตาม created_at)
      // setHistory(data.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
    } catch (error) {
      console.error('Error loading history:', error);
      Alert.alert('ข้อผิดพลาด', 'ไม่สามารถโหลดประวัติได้');
    }
  }, [activeProject]);




  const openImageModal = (uri) => {
    setSelectedImage(uri);
    setModalVisible(true);
  };

  const numberPlate = (index) => {
    return (history.length - index)
  }


  return (
    <View style={styles.container}>
      <View style={styles.tabMobile}>

      </View>
      <View style={styles.header}>
        <Text style={styles.title}>{activeProject?.name}</Text>

        <Ionicons
          name={isOnline ? "cloud-done" : "cloud-offline"}
          size={22}
          color={isOnline ? '#27ae60' : '#e74c3c'} // เขียวเมื่อ Online, แดงเมื่อ Offline
        />

      </View>
      <CheckInSyncManager />
      <View style={styles.content}>
        {history.length === 0 ? (
          <View style={styles.emptyContainer}><Text>
            ไม่มีข้อมูล</Text></View>
        ) :
          (

            <FlatList
              data={history} // สมมติว่าข้อมูลของคุณชื่อ history
              keyExtractor={(item) => item.id ? item.id.toString() : Math.random().toString()} // ใช้ค่าที่ไม่ซ้ำกันจริงๆ ดีกว่า index
              // 3. แก้ไข renderItem ให้เรียกใช้ HistoryItem
              renderItem={({ item, index }) => (
                <HistoryItem
                  item={item}
                  index={index}
                  numberPlate={numberPlate} // ส่งฟังก์ชันเข้าไปเป็น prop
                  openImageModal={openImageModal} // ส่งฟังก์ชันเข้าไปเป็น prop
                />
              )}
            />
          )
        }
      </View>

      {/* Modal สำหรับแสดงรูปภาพเต็มจอ */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
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
            <Image
              source={{ uri: selectedImage }}
              style={styles.fullscreenImage}
              resizeMode="contain"
            />
          </ImageZoom>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => setModalVisible(false)}
          >
            <Text style={styles.closeButtonText}>✕</Text>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingTop: 0,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderColor: '#e9ecef',
    height: 50,
  },
  tabMobile: {
    height: 25,
    backgroundColor: 'black',
    borderBottomWidth: 1,
    // borderColor:'#e9ecef',
    justifyContent: 'center',
    alignItems: 'center'
  },
  title: {
    fontSize: 14,
    fontWeight: '300',
    color: '#2c3e50',
    fontFamily: 'Kanit-Regular',

  },
  clearButton: {
    fontSize: 14,
    color: '#e74c3c',
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  listContainer: {
    padding: 15,
  },










  detailLabel: {
    fontWeight: '300',
    color: '#7f8c8d',
  },

  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyIcon: {
    fontSize: 80,
    marginBottom: 20,
  },
  emptyText: {
    fontSize: 16,
    color: '#95a5a6',
  },
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
  chipText: {
    backgroundColor: '#3498db',
    color: '#fff',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontSize: 12,
    overflow: 'hidden',
    maxWidth: 50,
    textAlign: 'center',
    fontWeight: '500',
    marginLeft: 6,
  },

});