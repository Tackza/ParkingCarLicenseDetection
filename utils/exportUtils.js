import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';
import { getAllDataForExport } from '../constants/Database';

/**
 * Export database to JSON file
 * @param {string|null} startDate - วันที่เริ่มต้น (format: 'YYYY-MM-DD')
 * @param {string|null} endDate - วันที่สิ้นสุด (format: 'YYYY-MM-DD')
 */
export const exportDatabaseToJSON = async (startDate = null, endDate = null) => {
  try {
    const data = await getAllDataForExport(startDate, endDate);
    const jsonString = JSON.stringify(data, null, 2);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `database_export_${timestamp}.json`;
    const fileUri = FileSystem.documentDirectory + fileName;

    await FileSystem.writeAsStringAsync(fileUri, jsonString, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    if (!(await Sharing.isAvailableAsync())) {
      Alert.alert("Error", "Sharing is not available on this device");
      return;
    }

    await Sharing.shareAsync(fileUri);
  } catch (error) {
    console.error("Error exporting database:", error);
    Alert.alert("Error", "Failed to export database");
  }
};
