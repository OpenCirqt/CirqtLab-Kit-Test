import * as IntentLauncher from "expo-intent-launcher";
import * as Location from "expo-location";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, PermissionsAndroid, Platform } from "react-native";
import BleManager from "react-native-ble-manager";

type LocationState = 'READY' | 'NO_READY_GLOBAL' | 'NO_READY_APP' | '';

const useAppPermission = (
  callback?: (enableScan: boolean) => void
) => {
  const [showModal, setShowModal] = useState(false);
  const [bluetoothState, setBluetoothState] = useState('');
  const [locationState, setLocationState] = useState<LocationState>('');

  const requestBlePermissions = useCallback(async () => {
    try {
      const { BLUETOOTH_SCAN, BLUETOOTH_CONNECT, ACCESS_FINE_LOCATION } = PermissionsAndroid.PERMISSIONS;

      // If BLUETOOTH_SCAN and CONNECT exist, request them (Android 12+)
      if (BLUETOOTH_SCAN && BLUETOOTH_CONNECT) {
        const granted = await PermissionsAndroid.requestMultiple([
          BLUETOOTH_SCAN,
          BLUETOOTH_CONNECT,
        ]);

        const allGranted =
          granted[BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED &&
          granted[BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED;

        return allGranted; 
      } else {
        // Fallback for Android 11 and below
        const granted = await PermissionsAndroid.request(ACCESS_FINE_LOCATION);
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
    } catch (err) {
      console.warn('Permission request error', err);
      return false;
    }
  }, []);

  const requestStoragePermissions = useCallback(async () => {
    if (Platform.OS === "android" && Platform.Version < 29) {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
      ]);
      return (
        granted["android.permission.READ_EXTERNAL_STORAGE"] ===
        PermissionsAndroid.RESULTS.GRANTED
      );
    }
    return true;
  }, []);

  const ensurePermissionsReady = useCallback(async () => {
    return new Promise<{
      bluetoothState: string;
      locationState: LocationState;
    }>(async (resolve) => {
      let bluetoothState = '';
      let locationState: LocationState = '';
      if (Platform.OS === "ios") {
        locationState = 'READY';
      }

      const subscription = BleManager.onDidUpdateState(
        async (args: { state: string }) => {
          bluetoothState = args.state;
          subscription.remove();

          if (Platform.OS === "android") {
            // request runtime permissions first
            await requestStoragePermissions();

            const permOk = await requestBlePermissions();
            if (!permOk) {
              resolve({ bluetoothState, locationState: 'NO_READY_APP' });
              return;
            }

            // then check if location services are enabled (if it's granted)
            const locationGranted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
            if (locationGranted) {
              const servicesEnabled = await Location.hasServicesEnabledAsync();
              if (!servicesEnabled) {
                resolve({ bluetoothState, locationState: 'NO_READY_GLOBAL' });
                return;
              }
            }

            locationState = "READY";
          }

          resolve({ bluetoothState, locationState });
        }
      );

      BleManager.checkState(); // triggers initial event
    });
  }, [requestBlePermissions, requestStoragePermissions]);

  async function openAppSettings() {
    try {
      await Linking.openSettings();
    } catch (err) {
      console.warn("Cannot open settings:", err);
    } finally {
      setShowModal(false);
    }
  }

  function openLocationSettingsAndroid() {
    if (Platform.OS === "android") {
      IntentLauncher.startActivityAsync(
        IntentLauncher.ActivityAction.LOCATION_SOURCE_SETTINGS
      );
    }
  }

  function openBluetoothSettingsAndroid() {
    if (Platform.OS === "android") {
      IntentLauncher.startActivityAsync(
        IntentLauncher.ActivityAction.BLUETOOTH_SETTINGS
      );
    }
  }

  function handleOpenSettings() {
    if (locationState === 'NO_READY_GLOBAL' && Platform.OS === "android") {
      openLocationSettingsAndroid();
    } else if (bluetoothState === 'off' && Platform.OS === "android") {
      openBluetoothSettingsAndroid();
    } else {
      openAppSettings();
    }
  }

  const checkStatus = useCallback(async (navigateToScan?: boolean) => {
    const result = await ensurePermissionsReady();
    setBluetoothState(result.bluetoothState);
    setLocationState(result.locationState);

    const goodBleState = result.bluetoothState === 'on';
    const goodLocState = result.locationState === 'READY';
    setShowModal(!goodBleState || !goodLocState);

    if (callback && navigateToScan) {
      callback(goodBleState && goodLocState);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ensurePermissionsReady]);

  const isPermissionFetching = useRef(false);

  useEffect(() => {
    checkStatus();

    const sub = AppState.addEventListener("change", async (nextState) => {
      console.info("[APP NEXT STATE]: ", nextState);
      if (nextState === 'active' && !isPermissionFetching.current) {
        isPermissionFetching.current = true;
        await checkStatus();
        isPermissionFetching.current = false;
      }
    });

    return () => sub.remove();
  }, [checkStatus]);

  return {
    showModal,
    setShowModal,
    bluetoothState,
    locationState,
    handleOpenSettings,
    checkStatus
  };
};

export default useAppPermission;
