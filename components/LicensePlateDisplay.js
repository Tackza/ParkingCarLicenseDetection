import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, Pressable, View } from 'react-native';

export default function LicensePlateDisplay({ plate, province, onEditPress }) {
  return (
    <Pressable style={styles.container} onPress={onEditPress}>
      {/* ส่วนกรอบและเนื้อหาของป้ายทะเบียน */}
      <View style={styles.plateContainer}>
        <Text style={styles.plateText}>{plate || ''}</Text>
        <Text style={styles.provinceText}>{province || ''}</Text>
      </View>

      {/* 2. เปลี่ยนปุ่มแก้ไขจาก TouchableOpacity เป็น View ธรรมดา */}
      <View style={styles.editButton}>
        <Ionicons name="settings-outline" size={20} color="#4f5a5e" />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 10,
    position: 'relative', // ทำให้ปุ่มแก้ไขอ้างอิงตำแหน่งจากกรอบนี้ได้
  },
  plateContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#34495e',
    paddingVertical: 15,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  provinceText: {
    fontSize: 22,
    color: '#2c3e50',
    fontWeight: '600',
    marginBottom: 5,
  },
  plateText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#000000',
    letterSpacing: 2, // เพิ่มระยะห่างระหว่างตัวอักษร
  },
  editButton: {
    position: 'absolute',
    top: 85,
    right:5,
    backgroundColor: 'white',
    borderRadius: 15,
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 0, // สำหรับ Android
  },
});