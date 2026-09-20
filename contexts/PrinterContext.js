// file: contexts/PrinterContext.js
//
// เก็บสถานะการเชื่อมต่อเครื่องพิมพ์ไว้ที่เดียว ให้ทุกหน้าอ่านได้
//
// เดิมสถานะนี้อยู่ใน state ของหน้า bluetooth-setup เท่านั้น หน้าอื่นจึงไม่รู้เลยว่า
// ต่อเครื่องพิมพ์ติดหรือยัง พอเปลี่ยนให้เข้าหน้าหลักได้แม้เชื่อมไม่สำเร็จ
// หน้าหลักต้องรู้เพื่อขึ้นแถบเตือน ไม่งั้นผู้ใช้จะไปรู้ตอนกดพิมพ์แล้วไม่ออก
//
// หมายเหตุ: ต้อง mount ที่ root ครั้งเดียวเท่านั้น อย่าทำซ้ำแบบ SyncProvider
// ที่ถูก mount ทั้งที่ root และใน (tabs)/_layout.js จนสองฝั่งมองเห็นคนละ state

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { DeviceEventEmitter, NativeEventEmitter, Platform } from 'react-native';
import { BluetoothManager } from 'react-native-bluetooth-escpos-printer';
import { getSetting } from '../constants/Database';

const SAVED_PRINTER_KEY = 'saved_printer';

const PrinterContext = createContext({
  isConnected: false,
  printerName: null,
  hasSavedPrinter: false,
  markConnected: () => { },
  markDisconnected: () => { },
  refreshSavedPrinter: async () => { },
});

export const PrinterProvider = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [printerName, setPrinterName] = useState(null);
  const [hasSavedPrinter, setHasSavedPrinter] = useState(false);

  const refreshSavedPrinter = useCallback(async () => {
    try {
      const saved = await getSetting(SAVED_PRINTER_KEY);
      setHasSavedPrinter(!!saved);
      if (saved) {
        try {
          setPrinterName(JSON.parse(saved)?.name || null);
        } catch (e) {
          console.warn('Failed to parse saved_printer', e);
        }
      } else {
        setPrinterName(null);
      }
      return saved;
    } catch (e) {
      console.error('Failed to read saved printer', e);
      return null;
    }
  }, []);

  useEffect(() => {
    refreshSavedPrinter();
  }, [refreshSavedPrinter]);

  // ฟังการหลุดการเชื่อมต่อจากทุกหน้า ไม่ใช่เฉพาะตอนอยู่หน้าตั้งค่าเครื่องพิมพ์
  // เครื่องพิมพ์ออกนอกระยะกลางกะจะได้ขึ้นเตือนทันที
  useEffect(() => {
    const emitter = Platform.OS === 'ios'
      ? new NativeEventEmitter(BluetoothManager)
      : DeviceEventEmitter;
    const subscription = emitter.addListener(
      BluetoothManager.EVENT_CONNECTION_LOST,
      () => {
        console.log('🖨️ Printer connection lost');
        setIsConnected(false);
      }
    );
    return () => subscription.remove();
  }, []);

  const markConnected = useCallback((device) => {
    setIsConnected(true);
    setHasSavedPrinter(true);
    if (device?.name) setPrinterName(device.name);
  }, []);

  const markDisconnected = useCallback(() => setIsConnected(false), []);

  return (
    <PrinterContext.Provider
      value={{ isConnected, printerName, hasSavedPrinter, markConnected, markDisconnected, refreshSavedPrinter }}
    >
      {children}
    </PrinterContext.Provider>
  );
};

export const usePrinter = () => useContext(PrinterContext);
