

import React, { useRef, useState, useEffect } from 'react';
import { SafeAreaView, Button, View, Text, StyleSheet } from 'react-native';
import ViewShot, { captureRef } from 'react-native-view-shot';
import OrderSlip from './OrderSlip'; // import Component สลิป
import { BluetoothEscposPrinter } from 'react-native-bluetooth-escpos-printer';

const Base64Image = ({ dataToSend }) => {
  // state สำหรับเก็บค่า base64
  const [base64Image, setBase64Image] = useState('');
  // สร้าง ref เพื่ออ้างอิงไปยัง View ของสลิป
  const slipRef = useRef();

  useEffect(() => {
    // 3. ตรวจสอบว่ามี dataToSend และไม่เป็นค่าว่าง
    if (dataToSend) {
      // หน่วงเวลาเล็กน้อยเพื่อให้แน่ใจว่า UI ของ OrderSlip render เสร็จสมบูรณ์
      // ก่อนที่จะทำการ capture ซึ่งจะช่วยลดโอกาสเกิดข้อผิดพลาดได้
      const timer = setTimeout(() => {
        console.log('dataToSend พร้อมแล้ว, เริ่มสร้างภาพสลิป...');
        generateSlipImage();
      }, 100); // หน่วงเวลา 100 มิลลิวินาที

      // คืนค่าฟังก์ชัน cleanup เพื่อยกเลิก timer หาก component unmount ก่อนเวลา
      return () => clearTimeout(timer);
    }
  }, [dataToSend]);

  // ฟังก์ชันสำหรับแปลง View เป็น Base64
  const generateSlipImage = () => {
    if (!slipRef.current) {
      console.error("Ref ของสลิปยังไม่พร้อมใช้งาน");
      return;
    }
    captureRef(slipRef.current, {
      format: 'png',      // ประเภทไฟล์
      quality: 1.0,       // คุณภาพของภาพ (0.0 - 1.0)
      result: 'base64',   // ผลลัพธ์ที่ต้องการ
      backgroundColor: '#FFFFFF' // กำหนดพื้นหลังเป็นสีขาว
    }).then(
      (uri) => {
        console.log('สร้าง Base64 สำเร็จ!', uri);
        setBase64Image(uri);
        setTimeout(() => {
          
          printerOrderSlipWithBase64()
        }, 1000);
        // ณ จุดนี้ คุณสามารถนำค่า uri (ซึ่งเป็น base64 string)
        // ไปส่งให้ไลบรารีของเครื่องปริ้นได้เลย
        // ตัวอย่าง: printViaBluetooth(uri);
      },
      (error) => console.error('เกิดข้อผิดพลาด!', error)
    );
  };

  const printerOrderSlipWithBase64 = async () => {
    try {
      await BluetoothEscposPrinter.printText('\r\n\r\n\r\n', {});
      await BluetoothEscposPrinter.printPic(base64Image, { width: 520, left: 0 });
      await BluetoothEscposPrinter.printText('\r\n\r\n\r\n', {});

    } catch (error) {
      console.error('Print error:', error);

    }

  }

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>ตัวอย่างสร้างสลิป Base64</Text>

      {/* ส่วนนี้คือ Component สลิปที่เราจะซ่อนไว้ หรือแสดงผลก็ได้
        เราส่ง ref เข้าไปที่นี่ 
      */}
      <View style={styles.hiddenContainer}>
        <OrderSlip ref={slipRef} orderDetails={dataToSend} />
      </View>
      {/* {dataToSend ? (<OrderSlip ref={slipRef} orderDetails={dataToSend} />) : null} */}

      <Button title="สร้างภาพสลิป (Base64)" onPress={generateSlipImage} />

      {/* แสดงผลลัพธ์ตัวอย่าง */}
      {base64Image ? (
        <View style={styles.resultContainer}>
          <Text>Base64 ที่ได้ (แสดง 50 ตัวอักษรแรก):</Text>
          <Text style={styles.base64Text}>{base64Image.substring(0, 50)}...</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    marginTop: 50,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  resultContainer: {
    marginTop: 20,
    padding: 10,
    backgroundColor: '#f0f0f0',
  },
  base64Text: {
    fontFamily: 'monospace',
    fontSize: 12,
  },
  hiddenContainer: {
    position: 'absolute',
    left: -10000,
  },

});

export default Base64Image;