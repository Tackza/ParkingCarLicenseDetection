import React from 'react';
import { Dimensions, Image, Modal, Text, TouchableOpacity, View } from 'react-native';
import ImageZoom from 'react-native-image-pan-zoom';

const windowWidth = Dimensions.get('window').width;
const windowHeight = Dimensions.get('window').height;

// ดูรูปเต็มจอ ซูมได้
// เดิมเขียนซ้ำสองชุดใน main.js (รูปในประวัติ กับรูปจากผลค้นหา) — หน้ารายละเอียดจะเป็นชุดที่สาม
// จึงยกออกมาเป็นตัวเดียว หน้าตาคงเดิมทุกค่า
const ImageViewerModal = ({ uri, visible, onClose }) => (
  <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
    <View className="flex-1 items-center justify-end bg-black/90">
      <ImageZoom
        cropWidth={windowWidth}
        cropHeight={windowHeight}
        imageWidth={windowWidth}
        imageHeight={windowHeight}
        minScale={0.8}
        maxScale={2.5}
      >
        <Image source={{ uri }} resizeMode="contain" className="h-full w-full" />
      </ImageZoom>
      <TouchableOpacity
        onPress={onClose}
        accessibilityLabel="ปิด"
        className="absolute bottom-[50px] right-5 h-10 w-10 items-center justify-center rounded-[20px] bg-white/20"
      >
        <Text className="text-[20px] font-bold text-white">✕</Text>
      </TouchableOpacity>
    </View>
  </Modal>
);

export default ImageViewerModal;
