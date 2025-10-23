export default () => {
  // อ่านค่าตัวแปร APP_VARIANT ที่เราตั้งไว้ในไฟล์ eas.json
  const appVariant = process.env.APP_VARIANT;

  // นี่คือค่า config ทั้งหมดจากไฟล์เดิมของคุณ
  // เราจะใช้ object นี้เป็นค่าตั้งต้น
  let config = {
    "expo": {
      "name": "RegisterMbus", // <-- ชื่อสำหรับ Production
      "slug": "tackpongsatorn",
      "version": "1.0.0",
      "orientation": "portrait",
      "icon": "./assets/images/c7.png",
      "scheme": "myapp",
      "userInterfaceStyle": "automatic",
      "splash": {
        "image": "./assets/images/c7.png",
        "resizeMode": "contain",
        "backgroundColor": "#ffffff"
      },
      "ios": {
        "supportsTablet": true,
        "bundleIdentifier": "com.donnytang.myapp" // <-- Bundle ID สำหรับ Production
      },
      "android": {
        "adaptiveIcon": {
          "foregroundImage": "./assets/images/c7.png",
          "backgroundColor": "#ffffff"
        },
        "permissions": [
          "android.permission.CAMERA",
          "android.permission.RECORD_AUDIO",
          "android.permission.BLUETOOTH",
          "android.permission.BLUETOOTH_ADMIN",
          "android.permission.BLUETOOTH_CONNECT",
          "android.permission.BLUETOOTH_SCAN"
        ],
        "package": "com.donnytang.myapp" // <-- Package Name สำหรับ Production
      },
      "web": {
        "bundler": "metro",
        "output": "static",
        "favicon": "./assets/images/favicon.png"
      },
      "plugins": [
        "expo-router",
      ],
      "experiments": {
        "typedRoutes": true
      },
      "extra": {
        "router": {
          "origin": false
        },
        "eas": {
          "projectId": "5f174e08-157c-4a3f-8174-209b75158d09"
        }
      }
    }
  };

  // --- ส่วนตรรกะแบบไดนามิก ---
  // ถ้า Profile ที่สั่ง build คือ 'development'
  if (appVariant === 'development') {
    // ให้ทำการแก้ไขค่า config สำหรับเวอร์ชัน Dev
    config.expo.name = "RegisterMbus (Dev)"; // เปลี่ยนชื่อแอป
    config.expo.android.package = "com.donnytang.myapp.dev"; // เปลี่ยน Package Name
    config.expo.ios.bundleIdentifier = "com.donnytang.myapp.dev"; // เปลี่ยน Bundle ID
  }

  // ส่งค่า config สุดท้ายออกไปให้ Expoใช้งาน
  return config;
};