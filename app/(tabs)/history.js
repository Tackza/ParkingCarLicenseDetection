import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  Image,      // เพิ่มเข้ามา
  Modal,
  
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function HistoryScreen() {
  const [history, setHistory] = useState([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const router = useRouter();

  useFocusEffect(
    useCallback(() => {
      // โค้ดในนี้จะทำงานทุกครั้งที่หน้าจอนี้ถูก focus (เปิดเข้ามาดู)
      loadHistory();

      return () => {
        // (Optional) โค้ดสำหรับ cleanup เมื่อออกจากหน้าจอ
      };
    }, [])
  );

  const loadHistory = async () => {
    try {
      const data = await AsyncStorage.getItem('scan_history');
      if (data) {
        setHistory(JSON.parse(data));
      }
    } catch (error) {
      console.error('Error loading history:', error);
    }
  };

  const clearHistory = () => {
    Alert.alert(
      'ยืนยันการลบ',
      'คุณต้องการลบประวัติทั้งหมดหรือไม่?',
      [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: 'ลบ',
          style: 'destructive',
          onPress: async () => {
            try {
              await AsyncStorage.removeItem('scan_history');
              setHistory([]);
              Alert.alert('สำเร็จ', 'ลบประวัติทั้งหมดแล้ว');
            } catch (error) {
              Alert.alert('ข้อผิดพลาด', 'ไม่สามารถลบประวัติได้');
            }
          },
        },
      ]
    );
  };

  const openImageModal = (uri) => {
    setSelectedImage(uri);
    setModalVisible(true);
  };

  const renderItem = ({ item }) => (
    <View style={styles.historyItem}>
      {/* ส่วนรูปภาพ Thumbnail */}
      <TouchableOpacity onPress={() => openImageModal(item.imageUri)}>
        {item.imageUri ? (
          <Image source={{ uri: item.imageUri }} style={styles.thumbnail} />
        ) : (
          <View style={[styles.thumbnail, styles.noImagePlaceholder]}>
            <Text style={styles.noImageText}>ไม่มีรูป</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* ส่วนรายละเอียด */}
      <View style={styles.itemDetails}>
        <View style={styles.plateContainer}>
          <Text style={styles.plateText}>{item.licensePlate}</Text>
        </View>
          <Text style={styles.provinceText}>{item.province}</Text>
        <View style={styles.detailText}>
          <Text style={styles.detailLabel}>ประเภท:</Text> 
          <Text style={styles.detailLabel}>{item.vehicleType}</Text> 
        </View>
        {item.stickerNumber && (
          <View style={styles.detailText}>
            <Text style={styles.detailLabel}>สติกเกอร์:</Text> 
            <Text style={styles.detailLabel}>{item.stickerNumber}</Text>
          </View>
        )}
        <Text style={styles.dateText}>
          {new Date(item.timestamp).toLocaleString('th-TH', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
          })} น.
        </Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {/* <Text style={styles.title}>ประวัติการสแกน</Text> */}
        <TouchableOpacity onPress={clearHistory}>
          <Text style={styles.clearButton}>ลบทั้งหมด</Text>
        </TouchableOpacity>

      </View>
      <View style={styles.content}>
        {history.length === 0 ? (
          <View style={styles.emptyContainer}>{/* ... โค้ดเดิม ... */}</View>
        ) : (
          <FlatList
            data={history}
            renderItem={renderItem}
            keyExtractor={(item) => item.timestamp}
            contentContainerStyle={styles.listContainer}
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
          <Image
            source={{ uri: selectedImage }}
            style={styles.fullscreenImage}
            resizeMode="contain"
          />
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
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingRight: 20,
    paddingTop: 0,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderColor: '#e9ecef',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2c3e50',
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
  historyItem: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 5,
    elevation: 3,
    alignItems: 'center',
  },
  thumbnail: {
    width: 80,
    height: 80,
    borderRadius: 8,
    marginRight: 12,
  },
  noImagePlaceholder: {
    backgroundColor: '#e9ecef',
    justifyContent: 'center',
    alignItems: 'center',
  },
  noImageText: {
    fontSize: 12,
    color: '#95a5a6',
  },
  itemDetails: {
    flex: 1,
    justifyContent: 'center',
  },
  plateContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 1,
  },
  plateText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginRight: 8,
  },
  provinceText: {
    fontSize: 14,
    color: '#7f8c8d',
  },
  detailText: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 14,
    color: '#34495e',
    marginBottom: 2,
  },
  detailLabel: {
    fontWeight: '300',
    color: '#7f8c8d',
  },
  dateText: {
    fontSize: 12,
    color: '#95a5a6',
    marginTop: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
});