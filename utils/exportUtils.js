import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';
import { checkpointDatabase, getAllDataForExport, getSetting } from '../constants/Database';

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

/**
 * Export SQLite database file directly
 */
export const exportDatabaseFile = async () => {
  try {
    // Force checkpoint to ensure all data is in the .db file
    await checkpointDatabase();

    const dbName = 'LicensePlateReader.db';
    // Default Expo SQLite directory
    const dbDir = FileSystem.documentDirectory + 'SQLite/';
    const dbUri = dbDir + dbName;

    // Check if file exists
    let finalDbUri = dbUri;
    const fileInfo = await FileSystem.getInfoAsync(dbUri);
    if (!fileInfo.exists) {
      // Try looking in the root document directory just in case (older expo versions or different config)
      const rootDbUri = FileSystem.documentDirectory + dbName;
      const rootFileInfo = await FileSystem.getInfoAsync(rootDbUri);

      if (!rootFileInfo.exists) {
        Alert.alert("Error", "Database file not found");
        return;
      }
      finalDbUri = rootDbUri;
    }

    // Create a copy with a timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // Get machine code for filename
    const machineCode = await getSetting('machineCode');
    const machineSuffix = machineCode ? `_${machineCode}` : '';

    const newFileName = `LicensePlateReader_backup${machineSuffix}_${timestamp}.sqlite`; // .sqlite extension is often more recognized
    const newFileUri = FileSystem.documentDirectory + newFileName;

    await FileSystem.copyAsync({
      from: finalDbUri,
      to: newFileUri
    }); if (!(await Sharing.isAvailableAsync())) {
      Alert.alert("Error", "Sharing is not available on this device");
      return;
    }

    await Sharing.shareAsync(newFileUri);
  } catch (error) {
    console.error("Error exporting database file:", error);
    Alert.alert("Error", "Failed to export database file: " + error.message);
  }
};
