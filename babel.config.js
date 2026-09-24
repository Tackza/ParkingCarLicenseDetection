module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      // jsxImportSource: 'nativewind' ทำให้ JSX ทุกตัวถูกคอมไพล์ผ่าน jsx runtime ของ NativeWind
      // ซึ่งเป็นตัวที่ทำให้ prop className มีความหมายกับ <View>/<Text> ของ React Native
      // ถ้าขาดบรรทัดนี้ className จะถูกเมินเงียบๆ ไม่มี error ให้เห็น
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
  };
};
