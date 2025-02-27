import * as ExpoDevice from 'expo-device';
import * as ExpoBlE from 'expo-ble';
import { Platform } from 'react-native';
import { getDatabase, ref, set } from "firebase/database";
import { db } from "./firebaseConfig";

class BLEBeacon {
  constructor() {
    this.isAdvertising = false;
    this.deviceId = null;
  }

  async requestPermissions() {
    if (Platform.OS === 'android' && (await ExpoDevice.getApiLevelAsync()) >= 31) {
      const status = await ExpoBlE.requestPermissionsAsync();
      return status.granted;
    }
    return true;
  }

  async startAdvertising(uuid) {
    try {
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) {
        console.error('Bluetooth permission denied');
        return false;
      }

      await ExpoBlE.startAdvertisingAsync({
        serviceUUIDs: [uuid],
        interval: 100 // milliseconds
      });

      this.isAdvertising = true;
      
      // Start scanning for other devices
      ExpoBlE.startScanningAsync({
        serviceUUIDs: [uuid],
        allowDuplicates: true
      }, (device) => {
        if (device) {
          this.deviceId = device.id;
          // Save BLE data to Firebase
          const bleRef = ref(db, `devices/${this.deviceId}/ble`);
          set(bleRef, {
            rssi: device.rssi,
            timestamp: new Date().toISOString(),
            uuid: uuid
          });
        }
      });

      return true;
    } catch (error) {
      console.error('Error starting BLE advertising:', error);
      return false;
    }
  }

  async stopAdvertising() {
    if (this.isAdvertising) {
      await ExpoBlE.stopAdvertisingAsync();
      await ExpoBlE.stopScanningAsync();
      this.isAdvertising = false;
    }
  }
}

export default new BLEBeacon(); 