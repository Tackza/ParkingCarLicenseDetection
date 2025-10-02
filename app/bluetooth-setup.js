import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  Alert,
  Platform,
  DeviceEventEmitter,
  NativeEventEmitter,
} from 'react-native';
import { useRouter } from 'expo-router';
import { BluetoothManager } from 'react-native-bluetooth-escpos-printer';
import { PERMISSIONS, requestMultiple, RESULTS } from 'react-native-permissions';

export default function BluetoothSetupScreen() {
  const [isScanning, setIsScanning] = useState(false);
  const [pairedDevices, setPairedDevices] = useState([]);
  const [foundDevices, setFoundDevices] = useState([]);
  const [connectedDevice, setConnectedDevice] = useState(null);
  const router = useRouter();

  // --- ส่วนจัดการ Event Listeners ---
  const deviceAlreadPaired = useCallback(
    (rsp) => {
      let ds = null;
      try {
        ds = typeof rsp.devices === 'object' ? rsp.devices : JSON.parse(rsp.devices);
      } catch (e) {
        // ignore error
      }
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
      } catch (e) {
        // ignore error
      }
      if (r) {
        setFoundDevices((prev) => {
          // ป้องกันการเพิ่มอุปกรณ์ซ้ำ
          if (prev.some((device) => device.address === r.address)) {
            return prev;
          }
          return [...prev, r];
        });
      }
    },
    []
  );

  // --- ตั้งค่า Event Listeners เมื่อ component ถูก mount ---
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

    // Cleanup listeners when component unmounts
    return () => {
      listeners.forEach((listener) => listener.remove());
    };
  }, [deviceAlreadPaired, deviceFoundEvent]);


  // --- ส่วนขอสิทธิ์และสแกนอุปกรณ์ ---
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
        console.warn(err);
        return false;
      }
    }
    return true; // iOS handles permissions differently
  };

  const scanDevices = async () => {
    const hasPermission = await requestBluetoothPermission();
    if (!hasPermission) return;

    setIsScanning(true);
    setFoundDevices([]); // ล้างรายการที่เจอครั้งก่อนหน้า
    try {
      await BluetoothManager.scanDevices();
    } catch (error) {
      console.error('Scan error:', error);
      Alert.alert('เกิดข้อผิดพลาด', 'ไม่สามารถสแกนหาอุปกรณ์ได้');
    } finally {
      // หยุด animation loading หลังจากผ่านไประยะหนึ่ง
      setTimeout(() => setIsScanning(false), 5000);
    }
  };

  // --- เริ่มต้นทำงานเมื่อเปิดหน้า ---
  useEffect(() => {
    const init = async () => {
      try {
        const enabled = await BluetoothManager.isBluetoothEnabled();
        if (!enabled) {
          await BluetoothManager.enableBluetooth();
        }
        scanDevices(); // เริ่มสแกนเมื่อ Bluetooth พร้อมใช้งาน
      } catch (error) {
        Alert.alert('ข้อผิดพลาด', 'ไม่สามารถเปิด Bluetooth ได้');
      }
    };
    init();
  }, []);

  const connectDevice = async (device) => {
    setIsScanning(true); // แสดง loading ขณะเชื่อมต่อ
    try {
      await BluetoothManager.connect(device.address);
      setConnectedDevice(device);
      setIsScanning(false);
      Alert.alert('สำเร็จ', `เชื่อมต่อกับ ${device.name || 'Unknown Device'} สำเร็จ`, [
        {
          text: 'ตกลง',
          onPress: () => router.replace('/scan'), // ไปยังหน้าถัดไป
        },
      ]);
    } catch (error) {
      setIsScanning(false);
      Alert.alert('ข้อผิดพลาด', 'ไม่สามารถเชื่อมต่อกับเครื่องพิมพ์ได้');
    }
  };

  // --- รวมรายการอุปกรณ์ทั้งหมดเพื่อแสดงผล ---
  const allDevices = useMemo(() => {
    const deviceMap = new Map();
    pairedDevices.forEach((device) => deviceMap.set(device.address, device));
    foundDevices.forEach((device) => deviceMap.set(device.address, device));
    return Array.from(deviceMap.values());
  }, [pairedDevices, foundDevices]);

  const renderDevice = ({ item }) => (
    <TouchableOpacity
      style={styles.deviceItem}
      onPress={() => connectDevice(item)}
    >
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>เชื่อมต่อเครื่องพิมพ์</Text>
        <Text style={styles.subtitle}>เลือกเครื่องพิมพ์ที่ต้องการใช้งาน</Text>
      </View>

      <View style={styles.content}>
        {(isScanning && allDevices.length === 0) ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#3498db" />
            <Text style={styles.loadingText}>กำลังค้นหาเครื่องพิมพ์...</Text>
          </View>
        ) : (
          <>
            <FlatList
              data={allDevices}
              renderItem={renderDevice}
              keyExtractor={(item) => item.address}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>ไม่พบเครื่องพิมพ์ในบริเวณนี้</Text>
                  <Text style={styles.emptyText}>กรุณาตรวจสอบว่าเครื่องพิมพ์เปิดอยู่</Text>
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

            {connectedDevice && (
              <TouchableOpacity
                style={styles.continueButton}
                onPress={() => router.replace('/scan')}
              >
                <Text style={styles.continueButtonText}>ดำเนินการต่อ →</Text>
              </TouchableOpacity>
            )}
          </>
        )}
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
    padding: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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