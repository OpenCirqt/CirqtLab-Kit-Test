import { useEffect } from "react";
import BleManager from "react-native-ble-manager";
import { setBatteryLevel, setBatteryPowerState } from "../features/ble/bleSlice";
import { useAppDispatch } from "../store";
import {
  BatteryLevelCharacteristicUUID,
  BatteryPowerStateCharacteristicUUID,
  BatteryServiceUUID
} from "../utils/UUIDs";

/**
 * Parses battery power state byte according to Bluetooth SIG specification
 * Bit 0-1: Battery Present (00 = Unknown, 01 = Not Present, 10 = Present, 11 = Reserved)
 * Bit 2-3: Wired External Power Source (00 = Unknown, 01 = Not Connected, 10 = Connected, 11 = Reserved)
 * Bit 4-5: Wireless External Power Source (00 = Unknown, 01 = Not Connected, 10 = Connected, 11 = Reserved)
 * Bit 6-7: Battery Charge State (00 = Unknown, 01 = Charging, 10 = Discharging, 11 = Reserved)
 */
const parseBatteryPowerState = (byte: number) => {
  const present = (byte & 0x03) === 0x02; // Battery present
  const charging = (byte & 0xC0) === 0x40; // Charging state
  const discharging = (byte & 0xC0) === 0x80; // Discharging state
  const criticallyLow = (byte & 0x03) === 0x01; // Battery critically low or not present

  return {
    present,
    discharging,
    charging,
    criticallyLow,
  };
};

/**
 * Hook to monitor battery level and power state from a BLE device
 * Reads battery level and power state on connection and subscribes to notifications
 *
 * @param peripheralId - The ID of the connected BLE device
 * @param enabled - Whether battery monitoring is enabled (typically when device is connected)
 */
export const useBatteryMonitor = (
  peripheralId: string | null,
  enabled: boolean
) => {
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (!peripheralId || !enabled) {
      dispatch(setBatteryLevel(null));
      dispatch(setBatteryPowerState(null));
      return;
    }

    let isMounted = true;

    const readBatteryLevel = async () => {
      try {
        console.log("Reading battery level from device:", peripheralId);

        // Read the battery level characteristic
        const data = await BleManager.read(
          peripheralId,
          BatteryServiceUUID,
          BatteryLevelCharacteristicUUID
        );

        if (isMounted && data && data.length > 0) {
          // Battery level is a single byte representing percentage (0-100)
          const batteryLevel = data[0];
          console.log("Battery level:", batteryLevel);
          dispatch(setBatteryLevel(batteryLevel));
        }
      } catch (error) {
        console.warn("Failed to read battery level:", error);
        // Device might not support battery service
        dispatch(setBatteryLevel(null));
      }
    };

    const readBatteryPowerState = async () => {
      try {
        console.log("Reading battery power state from device:", peripheralId);

        // Read the battery power state characteristic
        const data = await BleManager.read(
          peripheralId,
          BatteryServiceUUID,
          BatteryPowerStateCharacteristicUUID
        );

        if (isMounted && data && data.length > 0) {
          const powerState = parseBatteryPowerState(data[0]);
          console.log("Battery power state:", powerState);
          dispatch(setBatteryPowerState(powerState));
        }
      } catch (error) {
        console.warn("Failed to read battery power state:", error);
        // Device might not support battery power state characteristic
        dispatch(setBatteryPowerState(null));
      }
    };

    const subscribeToBatteryUpdates = async () => {
      try {
        console.log("Subscribing to battery level notifications");

        // Start notification for battery level updates
        await BleManager.startNotification(
          peripheralId,
          BatteryServiceUUID,
          BatteryLevelCharacteristicUUID
        );

        console.log("Subscribed to battery level notifications");
      } catch (error) {
        console.warn("Failed to subscribe to battery level notifications:", error);
        // Device might not support notifications for battery level
      }

      try {
        console.log("Subscribing to battery power state notifications");

        // Start notification for battery power state updates
        await BleManager.startNotification(
          peripheralId,
          BatteryServiceUUID,
          BatteryPowerStateCharacteristicUUID
        );

        console.log("Subscribed to battery power state notifications");
      } catch (error) {
        console.warn("Failed to subscribe to battery power state notifications:", error);
        // Device might not support notifications for battery power state
      }
    };

    const setupBatteryMonitoring = async () => {
      // Retrieve services to ensure battery service is discovered
      try {
        await BleManager.retrieveServices(peripheralId);

        // Initial battery level and power state read
        await readBatteryLevel();
        await readBatteryPowerState();

        // Subscribe to battery level and power state changes
        await subscribeToBatteryUpdates();
      } catch (error) {
        console.warn("Failed to setup battery monitoring:", error);
      }
    };

    // Setup battery monitoring
    setupBatteryMonitoring();

    // Listen for battery level and power state updates
    const updateListener = BleManager.onDidUpdateValueForCharacteristic(
      (data: {
        value: number[];
        peripheral: string;
        characteristic: string;
        service: string;
      }) => {
        if (
          data.peripheral === peripheralId &&
          data.service.toLowerCase() === BatteryServiceUUID.toLowerCase()
        ) {
          // Handle battery level updates
          if (
            data.characteristic.toLowerCase() ===
            BatteryLevelCharacteristicUUID.toLowerCase()
          ) {
            if (data.value && data.value.length > 0) {
              const batteryLevel = data.value[0];
              console.log("Battery level updated:", batteryLevel);
              dispatch(setBatteryLevel(batteryLevel));
            }
          }
          // Handle battery power state updates
          else if (
            data.characteristic.toLowerCase() ===
            BatteryPowerStateCharacteristicUUID.toLowerCase()
          ) {
            if (data.value && data.value.length > 0) {
              const powerState = parseBatteryPowerState(data.value[0]);
              // console.log("Battery power state updated:", powerState);
              dispatch(setBatteryPowerState(powerState));
            }
          }
        }
      }
    );

    // Cleanup function
    return () => {
      isMounted = false;
      updateListener.remove();

      // Stop battery level notifications
      if (peripheralId) {
        BleManager.stopNotification(
          peripheralId,
          BatteryServiceUUID,
          BatteryLevelCharacteristicUUID
        ).catch((error) => {
          console.warn("Failed to stop battery level notifications:", error);
        });

        // Stop battery power state notifications
        BleManager.stopNotification(
          peripheralId,
          BatteryServiceUUID,
          BatteryPowerStateCharacteristicUUID
        ).catch((error) => {
          console.warn("Failed to stop battery power state notifications:", error);
        });
      }
    };
  }, [peripheralId, enabled, dispatch]);
};
