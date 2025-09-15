import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import BleManager from "react-native-ble-manager";
import { clearPeripheral, setAutoConnect } from "../features/ble/bleSlice";
import { useAppDispatch, useAppSelector } from "../store";

const useAutoReconnect = () => {
  const peripheral = useAppSelector((state) => state.ble.peripheral);

  const hasTried = useRef(false);
  const dispatch = useAppDispatch();

  const timeout = (ms: number) =>
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), ms)
    );

  useEffect(() => {
    if (!peripheral?.id || hasTried.current) return;
    hasTried.current = true;
    dispatch(setAutoConnect(true));

    const connectAndMaybeBond = (async () => {
      await BleManager.connect(peripheral.id);

      if (Platform.OS === "android") {
        console.debug(`${peripheral.id}] createBond`);
        try {
          await BleManager.createBond(peripheral.id);
          console.debug(
            `${peripheral.id}] createBond success or there is already an existing one`
          );
        } catch (e) {
          console.warn(`${peripheral.id}] createBond failed:`, e);
          // throw e; // Uncomment if bonding failure should cancel everything
        }
      }
    })();

    const tryReconnect = async () => {
      try {
        await Promise.race([
          connectAndMaybeBond,
          timeout(5000), // 5 second timeout
        ]);
        console.log("[AutoConnect] Connected");
      } catch (e) {
        console.warn("[AutoConnect] Failed", e);
        BleManager.disconnect(peripheral.id);
        dispatch(clearPeripheral());
      } finally {
        dispatch(setAutoConnect(false));
      }
    };

    tryReconnect();
  }, [peripheral, dispatch]);
};

export default useAutoReconnect;
