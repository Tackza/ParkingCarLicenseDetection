import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const OrderSlip = React.forwardRef(({ orderDetails }, ref) => {
  const { licensePlate,
    province,
    vehicleType,
    stickerNumber,
    imageUri,
    timestamp } = orderDetails;

  return (
    // View ชั้นนอกสุดคือส่วนที่เราจะแคปเจอร์
    <View ref={ref} style={styles.container}>
      <Text style={styles.textCenter}>*** เอกสารสำคัญ ห้ามทำหาย ***</Text>
      <Text style={styles.header}>ใบลงทะเบียนรถ</Text>
      <Text style={styles.textCenter}>งานตักบาตร</Text>
      <View style={styles.totalRow}>
        <Text style={styles.text}>ทะเบียนรถ: </Text>
        <Text style={styles.text}>{licensePlate} {province}</Text>
      </View>
      <View style={styles.totalRow}>
        <Text style={styles.text}>ประเภทรถ: </Text>
        <Text style={styles.text}>{vehicleType} </Text>
      </View>
      <Text style={styles.text}>------------------------------</Text>
      <View style={styles.totalRow}>
        <Text style={styles.text}>รหัสจุดออกรถ: </Text>
        <Text style={styles.text}>1234</Text>
      </View>
      <View style={styles.totalRow}>
        <Text style={styles.text}>จุดออกรถ: </Text>
        <Text style={styles.text}>เมืองสมุทรสาคร</Text>
      </View>
      <View style={styles.totalRow}>
        <Text style={styles.text}>เขตอำเภอ: </Text>
        <Text style={styles.text}>เมืองสมุทรสาคร</Text>
      </View>
      <View style={styles.totalRow}>
        <Text style={styles.text}>จังหวัด: </Text>
        <Text style={styles.text}>สมุทรสาคร</Text>
      </View>
      <View style={styles.totalRow}>
        <Text style={styles.text}>ผู้โดยสาร: </Text>
        <Text style={styles.text}>12 คน/พระ 0 รูป</Text>
      </View>
      <View style={styles.totalRow}>
        <Text style={styles.text}>สติกเกอร์: </Text>
        <Text style={styles.text}>{stickerNumber}</Text>
      </View> 
      <Text style={styles.text}>------------------------------</Text>
      <View style={styles.totalRow}>
        <Text style={styles.text}>เวลาลงทะเบียน: </Text>
        <Text style={styles.text}>{new Date().toLocaleDateString('th-TH', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })}</Text>
      </View>
      <View style={styles.totalRow}>
        <Text style={styles.text}>เวลาพิมพ์: </Text>
        <Text style={styles.text}>{new Date().toLocaleDateString('th-TH', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })}</Text>
      </View>
      <View style={styles.totalRow}>
        <Text style={styles.text}>รหัสยืนยัน: </Text>
        <Text style={styles.text}> 1234</Text>
      </View>

      <Text style={styles.text}>------------------------------</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    padding: 0,
    backgroundColor: 'white', // พื้นหลังต้องเป็นสีขาว
    width: 300, // กำหนดความกว้างให้เหมือนสลิปจริง
  },
  header: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    color: 'black',
    marginBottom: 10,
  },
  text: {
    fontSize: 14,
    color: 'black', // ตัวหนังสือต้องเป็นสีดำ
    fontFamily: 'monospace', // ใช้ฟอนต์แบบ monospaced จะจัดคอลัมน์สวยงาม
    marginVertical: 2,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  itemName: {
    flex: 1,
  },
  itemPrice: {
    textAlign: 'right',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  totalText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: 'black',
    fontFamily: 'monospace',
  },
  footer: {
    textAlign: 'center',
    marginTop: 20,
    fontSize: 12,
    color: 'black',
  },
  textCenter: {
    textAlign: 'center',
    fontSize: 16,
    color: 'black',
    fontFamily: 'monospace',
  },
});

export default OrderSlip;