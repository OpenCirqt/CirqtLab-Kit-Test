import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import { AppState, AppStateStatus } from "react-native";
import BleManager, {
  BleManagerDidUpdateValueForCharacteristicEvent,
} from "react-native-ble-manager";
import { RxUUID, ServiceUUID } from "../utils/UUIDs";

const Buffer = require("buffer/").Buffer;

export interface BleSubscriber {
  onData: (data: number[]) => void;
}

interface BleNotificationContextValue {
  subscribe: (subscriber: BleSubscriber) => () => void;
  setPeripheral: (id: string | undefined) => void;
}

const BleNotificationContext =
  createContext<BleNotificationContextValue | null>(null);

export const BleNotificationProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const peripheralIdRef = useRef<string | undefined>(undefined);
  const subscribersRef = useRef<Map<symbol, BleSubscriber>>(new Map());
  const listenerRef = useRef<{ remove: () => void } | null>(null);
  const isNotifyingRef = useRef<boolean>(false);

  const handleBLEDataIngest = useCallback((bytes: typeof Buffer): void => {
    const floats: number[] = [];
    for (let i = 0; i < bytes.length; i += 4) {
      floats.push(bytes.readFloatLE(i));
    }
    const packet = [...floats, Date.now()];
    subscribersRef.current.forEach(({ onData }) => onData(packet));
  }, []);

  const stopNotifying = useCallback(async (): Promise<void> => {
    const peripheralId = peripheralIdRef.current;
    if (!peripheralId || !isNotifyingRef.current) return;

    try {
      listenerRef.current?.remove();
      listenerRef.current = null;
      await BleManager.stopNotification(peripheralId, ServiceUUID, RxUUID);
      isNotifyingRef.current = false;
    } catch (e) {
      console.warn("BLE stopNotification error:", e);
    }
  }, []);

  const startNotifying = useCallback(async (): Promise<void> => {
    const peripheralId = peripheralIdRef.current;
    if (!peripheralId || isNotifyingRef.current) return;

    try {
      await BleManager.retrieveServices(peripheralId);
      await BleManager.startNotification(peripheralId, ServiceUUID, RxUUID);
      isNotifyingRef.current = true;

      listenerRef.current = BleManager.onDidUpdateValueForCharacteristic(
        ({ value }: BleManagerDidUpdateValueForCharacteristicEvent) => {
          handleBLEDataIngest(Buffer.from(value));
        },
      );
    } catch (e) {
      console.warn("BLE startNotification error:", e);
    }
  }, [handleBLEDataIngest]);

  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus): void => {
      if (nextAppState === "background" || nextAppState === "inactive") {
        stopNotifying();
      } else if (nextAppState === "active") {
        // Only restart if there are active subscribers
        if (subscribersRef.current.size > 0) {
          startNotifying();
        }
      }
    };

    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange,
    );
    return () => subscription.remove();
  }, [startNotifying, stopNotifying]);

  const subscribe = useCallback(
    (subscriber: BleSubscriber): (() => void) => {
      const key = Symbol();
      subscribersRef.current.set(key, subscriber);

      if (subscribersRef.current.size === 1) {
        startNotifying();
      }

      return () => {
        subscribersRef.current.delete(key);
        if (subscribersRef.current.size === 0) {
          stopNotifying();
        }
      };
    },
    [startNotifying, stopNotifying],
  );

  const setPeripheral = useCallback((id: string | undefined): void => {
    peripheralIdRef.current = id;
  }, []);

  return (
    <BleNotificationContext.Provider value={{ subscribe, setPeripheral }}>
      {children}
    </BleNotificationContext.Provider>
  );
};

export const useBleNotificationContext = (): BleNotificationContextValue => {
  const ctx = useContext(BleNotificationContext);
  if (!ctx)
    throw new Error(
      "useBleNotificationContext must be used within BleNotificationProvider",
    );
  return ctx;
};
