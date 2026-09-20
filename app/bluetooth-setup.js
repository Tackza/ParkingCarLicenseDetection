import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  FlatList,
  Modal,
  NativeEventEmitter,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { BluetoothManager } from 'react-native-bluetooth-escpos-printer';
import { PERMISSIONS, RESULTS, requestMultiple } from 'react-native-permissions';
// MODIFIED: เพิ่มการ import AsyncStorage
// import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSetting, saveSetting } from '../constants/Database';
import { usePrinter } from '../contexts/PrinterContext';

const SAVED_PRINTER_KEY = 'saved_printer'; // Key สำหรับเก็บข้อมูลใน AsyncStorage

export default function BluetoothSetupScreen() {
  // MODIFIED: เพิ่ม isLoading state สำหรับการตรวจสอบข้อมูลตอนเริ่มต้น
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [pairedDevices, setPairedDevices] = useState([]);
  const [foundDevices, setFoundDevices] = useState([]);
  const [connectedDevice, setConnectedDevice] = useState(null);
  const router = useRouter();
  // manual=1 แปลว่าผู้ใช้กดมาจากแถบเตือนเพื่อเลือกเครื่องพิมพ์เอง ไม่ใช่ขั้นตอนหลัง login
  const { manual } = useLocalSearchParams();
  const isManual = manual === '1';
  const { markConnected, markDisconnected } = usePrinter();
  // ข้อความในกล่อง "กำลังเชื่อมต่อ" กลางจอ อัปเดตตามขั้นตอนที่กำลังทำ
  const [connectingStatus, setConnectingStatus] = useState('กำลังเริ่มต้น Bluetooth...');
  // รายชื่ออุปกรณ์มาทาง event ซึ่งอ่านจาก state ใน effect ไม่ได้ (ติด closure เก่า) จึงต้องผ่าน ref
  const pairedDevicesRef = useRef([]);
  const foundDevicesRef = useRef([]);

  // --- ส่วนจัดการ Event Listeners (ไม่เปลี่ยนแปลง) ---
  const deviceAlreadPaired = useCallback(
    (rsp) => {
      let ds = null;
      try {
        ds = typeof rsp.devices === 'object' ? rsp.devices : JSON.parse(rsp.devices);
      } catch (e) { /* ignore error */ }


      if (ds && ds.length) {
        pairedDevicesRef.current = ds;
        setPairedDevices(ds);
      }
    },
    []
  );

  const deviceFoundEvent = useCallback(
    (rsp) => {
      let r = null;
      try {
        r = typeof rsp.device === 'object' ? rsp.device : JSON.parse(rsp.device);
      } catch (e) { /* ignore error */ }
      
      if (r) {
        setFoundDevices((prev) => {
          if (prev.some((device) => device.address === r.address)) {
            return prev;
          }
          const next = [...prev, r];
          foundDevicesRef.current = next;
          return next;
        });
      }
    },
    []
  );

  useEffect(() => {
    const emitter = Platform.OS === 'ios' ? new NativeEventEmitter(BluetoothManager) : DeviceEventEmitter;
    const listeners = [
      emitter.addListener(BluetoothManager.EVENT_DEVICE_ALREADY_PAIRED, deviceAlreadPaired),
      emitter.addListener(BluetoothManager.EVENT_DEVICE_FOUND, deviceFoundEvent),
      emitter.addListener(BluetoothManager.EVENT_CONNECTION_LOST, () => {
        setConnectedDevice(null);
        markDisconnected();
        Alert.alert('การเชื่อมต่อหลุด', 'การเชื่อมต่อกับเครื่องพิมพ์ถูกตัด');
      }),
    ];
    return () => {
      listeners.forEach((listener) => listener.remove());
    };
  }, [deviceAlreadPaired, deviceFoundEvent]);

  // --- ส่วนขอสิทธิ์และสแกนอุปกรณ์ (ไม่เปลี่ยนแปลง) ---
  const requestBluetoothPermission = async () => {
    if (Platform.OS === 'android') {
      try {
        const statuses = await requestMultiple([
          PERMISSIONS.ANDROID.BLUETOOTH_SCAN,
          PERMISSIONS.ANDROID.BLUETOOTH_CONNECT,
          PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION,
        ]);
        const allGranted = Object.values(statuses).every((status) => status === RESULTS.GRANTED);
        if (allGranted) {
          return true;
        }
        Alert.alert('ต้องการสิทธิ์', 'กรุณาอนุญาตให้แอปใช้ Bluetooth และ Location เพื่อค้นหาเครื่องพิมพ์');
        return false;
      } catch (err) {
        // console.warn(err);
        return false;
      }
    }
    return true;
  };

  const scanDevices = async () => {
    const hasPermission = await requestBluetoothPermission();
    if (!hasPermission) return;

    setIsScanning(true);
    setFoundDevices([]);
    foundDevicesRef.current = []; // ล้าง ref ด้วย ไม่งั้นอาจหยิบอุปกรณ์ค้างจากการสแกนรอบก่อน
    try {
      await BluetoothManager.scanDevices();
    } catch (error) {
      console.error('Scan error:', error);
      Alert.alert('เกิดข้อผิดพลาด', 'ไม่สามารถสแกนหาอุปกรณ์ได้');
    } finally {
      setTimeout(() => setIsScanning(false), 5000);
    }
  };

  // ลองเชื่อมสองครั้ง เครื่องพิมพ์ที่เพิ่งเปิดมักไม่ติดในครั้งแรก
  const tryConnect = async (device) => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await BluetoothManager.connect(device.address);
        return true;
      } catch (e) {
        console.log(`Connect attempt ${attempt} to ${device.address} failed:`, e?.message);
        if (attempt < 2) await new Promise(r => setTimeout(r, 1200));
      }
    }
    return false;
  };

  // รายชื่ออุปกรณ์ทยอยมาทาง event จึงต้องรอ ไม่ใช่อ่านได้ทันทีหลัง scanDevices()
  // เอาที่จับคู่ไว้แล้วก่อน (คือลำดับเดียวกับที่แสดงในรายการ) ถ้าไม่มีค่อยใช้ที่เพิ่งค้นเจอ
  const waitForFirstDevice = async (timeoutMs = 8000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (pairedDevicesRef.current?.length > 0) return pairedDevicesRef.current[0];
      await new Promise(r => setTimeout(r, 300));
    }
    return pairedDevicesRef.current?.[0] || foundDevicesRef.current?.[0] || null;
  };

  // --- MODIFIED: ปรับปรุงฟังก์ชันเริ่มต้น ---
  useEffect(() => {
    const initializeBluetooth = async () => {
      try {
        // เปิด Bluetooth ถ้ายังไม่เปิด
        const enabled = await BluetoothManager.isBluetoothEnabled();
        if (!enabled) {
          await BluetoothManager.enableBluetooth();
        }

        // ✅ ผู้ใช้กดมาจากแถบเตือนที่หน้าหลักเพื่อเลือกเครื่องพิมพ์เอง — แสดงรายการเลย
        if (isManual) {
          setConnectingStatus('กำลังค้นหาเครื่องพิมพ์...');
          setIsLoading(false);
          scanDevices();
          return;
        }

        // 1) ลองเครื่องพิมพ์ที่บันทึกไว้ก่อน
        const savedPrinterJSON = await getSetting(SAVED_PRINTER_KEY);
        let connectedTo = null;

        if (savedPrinterJSON) {
          const savedPrinter = JSON.parse(savedPrinterJSON);
          setConnectingStatus(`กำลังเชื่อมต่อ ${savedPrinter.name || 'เครื่องพิมพ์'}...`);
          if (await tryConnect(savedPrinter)) {
            connectedTo = savedPrinter;
          } else {
            // ✅ ไม่ลบ saved_printer ทิ้ง เครื่องพิมพ์แค่ปิดอยู่หรืออยู่ไกลชั่วคราว
            //    ก็ไม่ควรเสียค่าที่ตั้งไว้ รอบหน้าจะได้ลองเชื่อมตัวเดิมอีก
            console.log('Saved printer unavailable; falling back to the first device.');
          }
        }

        // 2) ยังไม่ได้เชื่อม → ค้นหาแล้วเลือกตัวแรกให้เอง
        //    หน้างานเลือกตัวแรกสุดทุกครั้งอยู่แล้ว จึงไม่มีเหตุผลให้ต้องกดเลือกเอง
        if (!connectedTo) {
          setConnectingStatus('กำลังค้นหาเครื่องพิมพ์...');
          await scanDevices();

          const firstDevice = await waitForFirstDevice();
          if (firstDevice) {
            setConnectingStatus(`กำลังเชื่อมต่อ ${firstDevice.name || 'เครื่องพิมพ์'}...`);
            if (await tryConnect(firstDevice)) {
              connectedTo = firstDevice;
              await saveSetting(SAVED_PRINTER_KEY, JSON.stringify(firstDevice));
            }
          } else {
            console.log('No bluetooth device found to auto-connect.');
          }
        }

        if (connectedTo) {
          setConnectedDevice(connectedTo);
          markConnected(connectedTo);
          console.log('เชื่อมต่อเครื่องพิมพ์สำเร็จ:', connectedTo);
        } else {
          markDisconnected();
        }

        // ✅ เข้าหน้าหลักเสมอ ไม่ว่าจะต่อเครื่องพิมพ์ติดหรือไม่
        //    เดิมถ้าต่อไม่ติดจะค้างอยู่หน้านี้ ทั้งที่การลงทะเบียนสำคัญกว่าการพิมพ์
        //    หน้าหลักมีแถบเตือนให้กดกลับมาเชื่อมใหม่ได้ตลอด
        //    ใช้ replace เพื่อไม่ให้หน้านี้ค้างอยู่ใน stack แล้วกดย้อนกลับมาโดน
        router.replace('/main');
      } catch (error) {
        setIsLoading(false);
        Alert.alert('ข้อผิดพลาด', 'ไม่สามารถเริ่มต้นการใช้งาน Bluetooth ได้');
      }
    };

    initializeBluetooth();
  }, [router, isManual]);


  // --- MODIFIED: ปรับปรุงฟังก์ชันเชื่อมต่อ ให้บันทึกข้อมูลหลังเชื่อมต่อสำเร็จ ---
  const connectDevice = async (device) => {
    setIsScanning(true);
    try {
      await BluetoothManager.connect(device.address);

      // บันทึกข้อมูลเครื่องพิมพ์ที่เชื่อมต่อสำเร็จ
      await saveSetting(SAVED_PRINTER_KEY, JSON.stringify(device));

      setConnectedDevice(device);
      markConnected(device);
      setIsScanning(false);
      Alert.alert('สำเร็จ', `เชื่อมต่อกับ ${device.name || 'Unknown Device'} สำเร็จ`, [
        {
          text: 'ตกลง',
          onPress: () => router.replace('/main'),
        },
      ]);
    } catch (error) {
      setIsScanning(false);
      Alert.alert('ข้อผิดพลาด', 'ไม่สามารถเชื่อมต่อกับเครื่องพิมพ์ได้');
    }
  };

  const allDevices = useMemo(() => {
    const deviceMap = new Map();
    pairedDevices.forEach((device) => deviceMap.set(device.address, device));
    foundDevices.forEach((device) => deviceMap.set(device.address, device));
    return Array.from(deviceMap.values());
  }, [pairedDevices, foundDevices]);

  const renderDevice = ({ item }) => (
    <TouchableOpacity style={styles.deviceItem} onPress={() => connectDevice(item)}>
      <View style={styles.deviceInfo}>
        <Text style={styles.deviceName}>{item.name || 'Unknown Device'}</Text>
        <Text style={styles.deviceAddress}>{item.address}</Text>
      </View>
      {connectedDevice?.address === item.address && (
        <View style={styles.connectedBadge}>
          <Text style={styles.connectedText}>เชื่อมต่อแล้ว</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  // --- ✅ กล่องแจ้งสถานะกลางจอระหว่างเชื่อมต่อเครื่องพิมพ์อัตโนมัติ ---
  //     เดิมเป็น spinner เต็มจอที่บอกแค่ "กำลังตรวจสอบการตั้งค่า" ซึ่งไม่บอกว่ากำลังทำอะไรอยู่
  if (isLoading) {
    return (
      <View style={styles.container}>
        <Modal visible transparent animationType="fade" onRequestClose={() => { }}>
          <View style={styles.connectingBackdrop}>
            <View style={styles.connectingCard}>
              <ActivityIndicator size="large" color="#3498db" />
              <Text style={styles.connectingTitle}>กำลังเชื่อมต่อเครื่องพิมพ์</Text>
              <Text style={styles.connectingStatusText}>{connectingStatus}</Text>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>เชื่อมต่อเครื่องพิมพ์</Text>
        <Text style={styles.subtitle}>เลือกเครื่องพิมพ์ที่ต้องการใช้งาน</Text>
      </View>

      <View style={styles.content}>
        <FlatList
          data={allDevices}
          renderItem={renderDevice}
          keyExtractor={(item) => item.address}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              {isScanning ? (
                <>
                  <ActivityIndicator size="large" color="#3498db" />
                  <Text style={styles.loadingText}>กำลังค้นหาเครื่องพิมพ์...</Text>
                </>
              ) : (
                <>
                  <Text style={styles.emptyText}>ไม่พบเครื่องพิมพ์ในบริเวณนี้</Text>
                  <Text style={styles.emptyText}>กรุณาตรวจสอบว่าเครื่องพิมพ์เปิดอยู่</Text>
                </>
              )}
            </View>
          }
        />
        <TouchableOpacity
          style={styles.scanButton}
          onPress={scanDevices}
          disabled={isScanning}
        >
          {isScanning ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.scanButtonText}>🔍 สแกนหาเครื่องพิมพ์</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Stylesheet remains the same as your original code
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    padding: 30,
    paddingTop: 60,
    backgroundColor: '#fff',
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 14,
    color: '#7f8c8d',
  },
  content: {
    flex: 1,
    padding: 15,
  },
  connectingBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  connectingCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 32,
    alignItems: 'center',
    minWidth: 260,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  connectingTitle: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: '700',
    color: '#2c3e50',
  },
  connectingStatusText: {
    marginTop: 6,
    fontSize: 14,
    color: '#7f8c8d',
    textAlign: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
  },
  loadingText: {
    marginTop: 15,
    fontSize: 16,
    color: '#7f8c8d',
  },
  deviceItem: {
    backgroundColor: '#fff',
    borderRadius: 15,
    padding: 20,
    marginBottom: 12,
    marginTop: 5,
    marginHorizontal: 5,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 4,
  },
  deviceAddress: {
    fontSize: 13,
    color: '#95a5a6',
  },
  connectedBadge: {
    backgroundColor: '#2ecc71',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  connectedText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    color: '#95a5a6',
    textAlign: 'center',
    lineHeight: 24,
  },
  scanButton: {
    backgroundColor: '#3498db',
    borderRadius: 15,
    padding: 16,
    alignItems: 'center',
    marginTop: 10,
  },
  scanButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  continueButton: {
    backgroundColor: '#2ecc71',
    borderRadius: 15,
    padding: 16,
    alignItems: 'center',
    marginTop: 10,
  },
  continueButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});