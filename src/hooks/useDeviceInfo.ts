import { useEffect } from "react";
import BleManager from "react-native-ble-manager";
import {
  DeviceInformationServiceUUID,
  FirmwareRevisionCharacteristicUUID,
  HardwareRevisionCharacteristicUUID,
  SoftwareRevisionCharacteristicUUID,
  ManufacturerNameCharacteristicUUID,
  ModelNumberCharacteristicUUID,
} from "../utils/UUIDs";
import { setDeviceInformation, DeviceInformation } from "../features/ble/bleSlice";
import { useAppDispatch } from "../store";

/**
 * Converts byte array to string (UTF-8)
 */
const bytesToString = (bytes: number[]): string => {
  return String.fromCharCode(...bytes);
};

/**
 * Hook to read device information from a BLE device
 * Reads firmware, hardware, and software revision strings
 *
 * @param peripheralId - The ID of the connected BLE device
 * @param enabled - Whether device info reading is enabled (typically when device is connected)
 */
export const useDeviceInfo = (
  peripheralId: string | null,
  enabled: boolean
) => {
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (!peripheralId || !enabled) {
      dispatch(setDeviceInformation(null));
      return;
    }

    let isMounted = true;

    const readDeviceInformation = async () => {
      const deviceInfo: DeviceInformation = {
        firmwareRevision: null,
        hardwareRevision: null,
        softwareRevision: null,
        manufacturerName: null,
        modelNumber: null,
      };

      try {
        console.log("Reading device information from device:", peripheralId);

        // Retrieve services to ensure device information service is discovered
        await BleManager.retrieveServices(peripheralId);

        // Read firmware revision
        try {
          const firmwareData = await BleManager.read(
            peripheralId,
            DeviceInformationServiceUUID,
            FirmwareRevisionCharacteristicUUID
          );
          if (firmwareData && firmwareData.length > 0) {
            deviceInfo.firmwareRevision = bytesToString(firmwareData).trim();
            console.log("Firmware Revision:", deviceInfo.firmwareRevision);
          }
        } catch (error) {
          console.warn("Failed to read firmware revision:", error);
        }

        // Read hardware revision
        try {
          const hardwareData = await BleManager.read(
            peripheralId,
            DeviceInformationServiceUUID,
            HardwareRevisionCharacteristicUUID
          );
          if (hardwareData && hardwareData.length > 0) {
            deviceInfo.hardwareRevision = bytesToString(hardwareData).trim();
            console.log("Hardware Revision:", deviceInfo.hardwareRevision);
          }
        } catch (error) {
          console.warn("Failed to read hardware revision:", error);
        }

        // Read software revision
        try {
          const softwareData = await BleManager.read(
            peripheralId,
            DeviceInformationServiceUUID,
            SoftwareRevisionCharacteristicUUID
          );
          if (softwareData && softwareData.length > 0) {
            deviceInfo.softwareRevision = bytesToString(softwareData).trim();
            console.log("Software Revision:", deviceInfo.softwareRevision);
          }
        } catch (error) {
          console.warn("Failed to read software revision:", error);
        }

        // Read manufacturer name
        try {
          const manufacturerData = await BleManager.read(
            peripheralId,
            DeviceInformationServiceUUID,
            ManufacturerNameCharacteristicUUID
          );
          if (manufacturerData && manufacturerData.length > 0) {
            deviceInfo.manufacturerName = bytesToString(manufacturerData).trim();
            console.log("Manufacturer Name:", deviceInfo.manufacturerName);
          }
        } catch (error) {
          console.warn("Failed to read manufacturer name:", error);
        }

        // Read model number
        try {
          const modelData = await BleManager.read(
            peripheralId,
            DeviceInformationServiceUUID,
            ModelNumberCharacteristicUUID
          );
          if (modelData && modelData.length > 0) {
            deviceInfo.modelNumber = bytesToString(modelData).trim();
            console.log("Model Number:", deviceInfo.modelNumber);
          }
        } catch (error) {
          console.warn("Failed to read model number:", error);
        }

        // Update Redux state if still mounted
        if (isMounted) {
          dispatch(setDeviceInformation(deviceInfo));
        }
      } catch (error) {
        console.warn("Failed to read device information:", error);
        if (isMounted) {
          dispatch(setDeviceInformation(null));
        }
      }
    };

    // Read device information
    readDeviceInformation();

    // Cleanup function
    return () => {
      isMounted = false;
    };
  }, [peripheralId, enabled, dispatch]);
};
