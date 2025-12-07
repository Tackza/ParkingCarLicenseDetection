import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function LicensePlateDisplay({ plate, province, onEditPress }) {
  return (
    <Pressable style={styles.container} onPress={onEditPress}>
      <View style={styles.plateContainer}>
        <Text style={styles.plateText}>{plate || ''}</Text>
        <Text style={styles.provinceText}>{province || ''}</Text>
      </View>

      {/* Edit Button outside container, aligned below */}
      <View style={styles.editButton}>
        <Ionicons name="create-outline" size={18} color="#7f8c8d" />
        <Text style={styles.editButtonText}>แตะเพื่อแก้ไข</Text>
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
    fontSize: 30,
    color: '#2c3e50',
    fontWeight: '600',
    marginBottom: 5,
  },
  plateText: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#000000',
    letterSpacing: 2, // เพิ่มระยะห่างระหว่างตัวอักษร
  },
  editButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  editButtonText: {
    fontSize: 14,
    color: '#7f8c8d', // สีเทาให้ดูไม่เด่นเกินไปแต่รู้ว่ากดได้
    fontWeight: '600',
    marginLeft: 6,
  },
});