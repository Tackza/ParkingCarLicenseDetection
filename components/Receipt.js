import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

const formatPassengerInfo = (passengerString) => {
  if (!passengerString || typeof passengerString !== 'string') {
    return '-- คน'; // ค่า default ถ้าไม่มีข้อมูล
  }
  const parts = passengerString.split('|');
  if (parts.length < 4) {
    return '-- คน';
  }

  let textCount = '';

  const people = parseInt(parts[0] || 0) + parseInt(parts[1] || 0); // รวมผู้ใหญ่กับเด็ก
  const monks = parseInt(parts[2] || 0);
  const novices = parseInt(parts[3] || 0);


  if (people > 0) {
    textCount += `${people}คน`;
  }
  if (monks > 0) {
    textCount += `/${monks}รูป`;
  }
  if (novices > 0) {
    textCount += `/สณ${novices}รูป`;
  }
  return textCount || '-- คน';
};

const Receipt = React.forwardRef(({
  machineCode,
  registerId,
  projectName,
  showActivity2,
  licensePlate,
  province,
  vehicleType,
  stationName,
  stationProvince,
  passenger,
  date,
  checkInBy,
  register // <-- เพิ่มรับ register object ด้วย (optional)
}, ref) => {
  // Helper: format act1_date to Thai time
  const formatThaiDate = (isoString) => {
    if (!isoString) return '';
    try {
      const dateObj = new Date(isoString);
      // แปลงเป็นเวลาไทย (UTC+7)
      return dateObj.toLocaleString('th-TH-u-ca-buddhist', {
        year: 'numeric', month: '2-digit', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  const act1Name = register?.activity1_name;
  const act1Date = register?.activity1_date;

  return (
    <View ref={ref} style={styles.receiptContainer}>
      <Text style={styles.textCenter}>! เอกสารสำคัญ ห้ามทำหาย !</Text>

      <View style={[styles.receiptRow, { marginTop: 1, marginBottom: 1 }]}>
        <Text style={styles.receiptMetaSmall}>{machineCode ? `#${machineCode}` : ''}</Text>
        <Text style={styles.receiptMetaSmall}>{registerId || '--'}</Text>
      </View>

      <Text style={styles.receiptTitle}>ใบลงทะเบียนรถ</Text>
      <Text style={styles.receiptSubtitle}>{projectName || 'ไม่พบชื่อโปรเจกต์'}</Text>

      {showActivity2 > 0 && (
        <View style={styles.activity2Container}>
          <Text style={styles.activity2Text}>กิจกรรมที่ 2</Text>
        </View>
      )}

      <View style={styles.divider} />

      <View style={styles.receiptRow}>
        <Text style={styles.receiptLabel}>ทะเบียนรถ:</Text>
        <Text style={styles.receiptValue}>{licensePlate}</Text>
      </View>

      <View style={styles.receiptRow}>
        <Text style={styles.receiptLabel}>ทะเบียนจังหวัด:</Text>
        <Text style={styles.receiptValue}>{province == 'กรุงเทพมหานคร' ? 'กทม.' : province}</Text>
      </View>

      <View style={styles.receiptRow}>
        <Text style={styles.receiptLabel}>ประเภทรถ:</Text>
        <Text style={styles.receiptValue}>{vehicleType}</Text>
      </View>

      {(stationName || stationProvince || passenger) && (
        <>
          <View style={styles.receiptRow}>
            <Text style={styles.receiptLabel}>จุดออกรถ:</Text>
            <Text style={styles.receiptValue}>{stationName || '--'}</Text>
          </View>
          <View style={styles.receiptRow}>
            <Text style={styles.receiptLabel}>จังหวัด:</Text>
            <Text style={styles.receiptValue}>{stationProvince || '--'}</Text>
          </View>
          <View style={styles.receiptRow}>
            <Text style={styles.receiptLabel}>ผู้โดยสาร:</Text>
            <Text style={styles.receiptValue}>{formatPassengerInfo(passenger)}</Text>
          </View>
        </>
      )}

      <View style={styles.divider} />

      <View style={styles.receiptRow}>
        <Text style={styles.receiptLabel}>เวลาลงทะเบียน:</Text>
        <Text style={styles.receiptValue}>
          {date}
        </Text>
      </View>

      {checkInBy && (
        <View style={styles.receiptRow}>
          <Text style={styles.receiptLabel}>ผู้ลงทะเบียน:</Text>
          <Text style={styles.receiptValue}>{checkInBy}</Text>
        </View>
      )}

      {/* เพิ่มส่วนนี้: ถ้ามี act1_name ให้แสดง divider, act1_name, act1_date (ไทย) */}
      {act1Name ? (
        <>
          <View style={styles.divider} />
          <View style={{ alignItems: 'center', marginVertical: 2 }}>
            <Text style={styles.receiptSubtitle}>{act1Name}</Text>
          </View>
          <View style={styles.receiptRow}>
            <Text style={styles.receiptLabel}>เวลาลงทะเบียน:</Text>
            <Text style={styles.receiptValue}>{formatThaiDate(act1Date)}</Text>
          </View>
        </>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  receiptContainer: {
    backgroundColor: '#fff',
    padding: 0,
    marginTop: 0,
    width: 300,
  },
  textCenter: {
    textAlign: 'center',
    fontSize: 20,
    color: 'black',
    fontFamily: 'Sarabun-Regular',
  },
  receiptMetaSmall: {
    fontSize: 18,
    color: '#555',
    fontFamily: 'Sarabun-Regular',
  },
  receiptTitle: {
    fontSize: 22,
    textAlign: 'center',
    marginBottom: 5,
  },
  receiptSubtitle: {
    fontSize: 19,
    textAlign: 'center',
    marginBottom: 15,
  },
  activity2Container: {
    borderWidth: 2,
    borderColor: '#000',
    padding: 5,
    marginVertical: 5,
    alignSelf: 'center',
    borderRadius: 5,
    width: '60%',
  },
  activity2Text: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    marginVertical: 10,
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 0,
  },
  receiptLabel: {
    fontSize: 18,
    fontFamily: 'Sarabun-Regular',
    paddingTop: 3,
    flex: 2,
  },
  receiptValue: {
    fontSize: 22,
    fontFamily: 'Sarabun-Regular',
    flex: 3,
    textAlign: 'right',
    flexWrap: 'wrap',
  },
});

export default Receipt;
