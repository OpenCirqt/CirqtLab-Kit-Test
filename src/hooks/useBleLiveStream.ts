import { useEffect, useRef } from "react";
import BleManager from "react-native-ble-manager"; // note: the trailing slash is important!
import { RxUUID, ServiceUUID } from "../utils/UUIDs";
const Buffer = require("buffer/").Buffer;

export const useBleLiveStream = (
  peripheralId: string | undefined,
  collecting: boolean,
  onData: (data: any) => void,
  onStart: (data: number) => void,
) => {
  const listenerRef = useRef<any>(null);

  useEffect(() => {
    const stopNotification = async (peripheralId: string) => {
      await BleManager.stopNotification(peripheralId, ServiceUUID, RxUUID);
    };
    if (!peripheralId || !collecting) {
      if (peripheralId) {
        stopNotification(peripheralId);
      }
      return;
    }

    const setup = async () => {
      const charCallback = ({ value, peripheral, characteristic, service }) => {
        const buffer = Buffer.from(value);
        handleBLEDataIngest(buffer);
      };

      const handleBLEDataIngest = (bytes: any) => {
        // convert every 4 bytes to a float and add to data
        const floatArray: number[] = [];
        for (let i = 0; i < bytes.length; i += 4) {
          const value = bytes.readFloatLE(i);
          floatArray.push(value);
        }

        onData([...floatArray, Date.now()]);
      };

      try {
        await BleManager.retrieveServices(peripheralId);
        await BleManager.startNotification(peripheralId, ServiceUUID, RxUUID);

        onStart(Date.now());

        listenerRef.current =
          BleManager.onDidUpdateValueForCharacteristic(charCallback);
      } catch (e) {
        console.warn("Live stream error:", e);
      }
    };

    setup();

    return () => {
      listenerRef.current?.remove();
      BleManager.stopNotification(peripheralId, ServiceUUID, RxUUID).catch(
        () => {},
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peripheralId, collecting]);
};
