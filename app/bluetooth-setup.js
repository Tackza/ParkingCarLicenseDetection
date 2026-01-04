import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  FlatList,
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
import { deleteSetting, getSetting, saveSetting } from '../constants/Database';

const SAVED_PRINTER_KEY = 'saved_printer'; // Key สำหรับเก็บข้อมูลใน AsyncStorage

export default function BluetoothSetupScreen() {
  // MODIFIED: เพิ่ม isLoading state สำหรับการตรวจสอบข้อมูลตอนเริ่มต้น
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [pairedDevices, setPairedDevices] = useState([]);
  const [foundDevices, setFoundDevices] = useState([]);
  const [connectedDevice, setConnectedDevice] = useState(null);
  const router = useRouter();

  // --- ส่วนจัดการ Event Listeners (ไม่เปลี่ยนแปลง) ---
  const deviceAlreadPaired = useCallback(
    (rsp) => {
      let ds = null;
      try {
        ds = typeof rsp.devices === 'object' ? rsp.devices : JSON.parse(rsp.devices);
      } catch (e) { /* ignore error */ }


      if (ds && ds.length) {
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
          return [...prev, r];
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
    try {
      await BluetoothManager.scanDevices();
    } catch (error) {
      console.error('Scan error:', error);
      Alert.alert('เกิดข้อผิดพลาด', 'ไม่สามารถสแกนหาอุปกรณ์ได้');
    } finally {
      setTimeout(() => setIsScanning(false), 5000);
    }
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

        // ตรวจสอบเครื่องพิมพ์ที่บันทึกไว้
        const savedPrinterJSON = await getSetting(SAVED_PRINTER_KEY);
        if (savedPrinterJSON) {
          const savedPrinter = JSON.parse(savedPrinterJSON);
          // Alert.alert('พบเครื่องพิมพ์ที่บันทึกไว้', `กำลังพยายามเชื่อมต่อกับ ${savedPrinter.name || 'Unknown Device'}...`);

          try {
            // พยายามเชื่อมต่ออัตโนมัติ
            await BluetoothManager.connect(savedPrinter.address);
            setConnectedDevice(savedPrinter);
            // Alert.alert('สำเร็จ', `เชื่อมต่อกับ ${savedPrinter.name} เรียบร้อยแล้ว`);
            console.log('เชื่อมต่อกับเครื่องพิมพ์ที่บันทึกไว้สำเร็จ:', savedPrinter);
            router.push('/main');// ไปหน้าต่อไปทันที
          } catch (autoConnectError) {
            // หากเชื่อมต่ออัตโนมัติล้มเหลว
            Alert.alert('เชื่อมต่ออัตโนมัติล้มเหลว', 'ไม่สามารถเชื่อมต่อกับเครื่องพิมพ์ที่บันทึกไว้ได้ กรุณาเลือกเครื่องพิมพ์ใหม่');
            await deleteSetting(SAVED_PRINTER_KEY); // ลบข้อมูลที่ไม่ถูกต้องออก
            setIsLoading(false); // แสดงหน้าให้ผู้ใช้เลือก
            scanDevices(); // เริ่มสแกนหาเครื่องพิมพ์ใหม่
          }
        } else {
          // ถ้าไม่มีเครื่องพิมพ์ที่บันทึกไว้ ก็เริ่มสแกนตามปกติ
          setIsLoading(false);
          scanDevices();
        }
      } catch (error) {
        setIsLoading(false);
        Alert.alert('ข้อผิดพลาด', 'ไม่สามารถเริ่มต้นการใช้งาน Bluetooth ได้');
      }
    };

    initializeBluetooth();
  }, [router]);


  // --- MODIFIED: ปรับปรุงฟังก์ชันเชื่อมต่อ ให้บันทึกข้อมูลหลังเชื่อมต่อสำเร็จ ---
  const connectDevice = async (device) => {
    setIsScanning(true);
    try {
      await BluetoothManager.connect(device.address);

      // บันทึกข้อมูลเครื่องพิมพ์ที่เชื่อมต่อสำเร็จ
      await saveSetting(SAVED_PRINTER_KEY, JSON.stringify(device));

      setConnectedDevice(device);
      setIsScanning(false);
      Alert.alert('สำเร็จ', `เชื่อมต่อกับ ${device.name || 'Unknown Device'} สำเร็จ`, [
        {
          text: 'ตกลง',
          onPress: () => router.push('/main'),
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

  // --- MODIFIED: เพิ่มหน้าจอ Loading ตอนเริ่มต้น ---
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#3498db" />
        <Text style={styles.loadingText}>กำลังตรวจสอบการตั้งค่า...</Text>
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