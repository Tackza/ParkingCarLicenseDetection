import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  FlatList,
  Image, // เพิ่มเข้ามา
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  TextInput,
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
  const [searchQuery, setSearchQuery] = useState('');
  const router = useRouter();
  const { isOnline } = useSync();
  const { activeProject, refreshCurrentProject } = useProject();
  const debounceTimer = useRef(null);


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
    if (activeProject) {
      console.log("Project changed, loading full history...");
      loadHistory(''); // 👈 โหลดทั้งหมด (ล้าง searchQuery)
      setSearchQuery(''); // 👈 เคลียร์ช่องค้นหาด้วย
    }
  }, [activeProject]);


  // ✅ 2. สร้างฟังก์ชัน loadHistory ที่ขึ้นอยู่กับ activeProject
  // const loadHistory = useCallback(async () => {
  //   if (!activeProject) {
  //     setHistory([]);
  //     return;
  //   }
  //   try {
  //     // 🔷 MODIFY: ส่ง searchQuery เข้าไปด้วย
  //     console.log(`Loading history for project ID: ${activeProject.project_id}, Query: "${searchQuery}"`);
  //     const data = await getScanHistory(activeProject.project_id, searchQuery);
  //     setHistory(data);
  //   } catch (error) {
  //     console.error('Error loading history:', error);
  //     Alert.alert('ข้อผิดพลาด', 'ไม่สามารถโหลดประวัติได้');
  //   }
  // }, [activeProject, searchQuery]);

  const loadHistory = async (query) => {
    // (ย้าย Guard Clause มาไว้ที่นี่)
    if (!activeProject) {
      setHistory([]);
      return;
    }
    try {
      console.log(`Loading history for project ID: ${activeProject.project_id}, Query: "${query}"`);
      const data = await getScanHistory(activeProject.project_id, query);
      setHistory(data);
    } catch (error) {
      console.error('Error loading history:', error);
      Alert.alert('ข้อผิดพลาด', 'ไม่สามารถโหลดประวัติได้');
    }
  };

  useEffect(() => {
    // (ถ้า project ยังไม่โหลด ก็ไม่ต้องทำอะไร)
    if (!activeProject) {
      return;
    }

    // เมื่อผู้ใช้พิมพ์, ให้เคลียร์ timer เก่า
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    // ตั้ง timer ใหม่ (300ms)
    console.log("User typing... setting 300ms debounce");
    debounceTimer.current = setTimeout(() => {
      // เมื่อครบ 300ms (ผู้ใช้หยุดพิมพ์)
      // ให้เรียก loadHistory ด้วย searchQuery "ล่าสุด"
      console.log("Debounce timer fired! Searching for:", searchQuery);
      loadHistory(searchQuery);
    }, 300); // 300 มิลลิวินาที

    // Cleanup: เคลียร์ timer ถ้า component ถูก unmount
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [searchQuery, activeProject]);




  const openImageModal = (uri) => {
    setSelectedImage(uri);
    setModalVisible(true);
  };

  const numberPlate = (index) => {
    console.log('index :>> ', index);
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

      {/* ✅ ADD: เพิ่ม Search Bar UI */}
     <View style={styles.searchContainer}>
        <Ionicons name="search" size={20} color="#888" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="ค้นหาทะเบียนรถ (เช่น 1234)..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholderTextColor="#888"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={20} color="#aaa" />
          </TouchableOpacity>
        )}
      </View>
      

      <View style={styles.content}>
        {history.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              {searchQuery.length > 0 ? 'ไม่พบข้อมูลที่ตรงกัน' : 'ไม่มีข้อมูล'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={history}
            keyExtractor={(item) => item.id ? item.id.toString() : Math.random().toString()}
            renderItem={({ item, index }) => (
              <HistoryItem
                item={item}
                index={index}
                numberPlate={numberPlate}
                openImageModal={openImageModal}
              />
            )}
            keyboardShouldPersistTaps="handled"
          />
        )}
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
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 15,
    marginHorizontal: 10,
    marginTop: 10,
    marginBottom: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e9ecef',
    elevation: 1,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    height: 45, // เพิ่มความสูงเล็กน้อย
    fontSize: 16,
    color: '#333',
  },

});