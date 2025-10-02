import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const SyncStatus = ({ isSyncing, lastSyncTime, onPressSync }) => {
  const formatTime = (time) => {
    if (!time) return 'กดเพื่อซิงค์';
    return `ล่าสุด: ${new Date(time).toLocaleTimeString('th-TH')}`;
  };

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPressSync}
      disabled={isSyncing}
    >
      {isSyncing ? (
        <>
          <ActivityIndicator size="small" color="#3498db" />
          <Text style={styles.syncingText}>กำลังซิงค์...</Text>
        </>
      ) : (
        <>
          <Ionicons name="sync-outline" size={18} color="#7f8c8d" />
          <Text style={styles.statusText}>{formatTime(lastSyncTime)}</Text>
        </>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
   marginRight: 10,
    backgroundColor: '#f0f0f0',
  },
  syncingText: {
    marginLeft: 8,
    fontSize: 12,
    color: '#3498db',
    fontWeight: '500',
  },
  statusText: {
    marginLeft: 14,
    fontSize: 12,
    color: '#7f8c8d',
  },
});

export default SyncStatus;