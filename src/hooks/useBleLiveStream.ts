import { useEffect, useRef } from "react";
import {
  BleSubscriber,
  useBleNotificationContext,
} from "../contexts/BleNotificationContext";

export const useBleLiveStream = (
  peripheralId: string | undefined,
  collecting: boolean,
  onData: (data: number[]) => void,
): void => {
  const { subscribe, setPeripheral } = useBleNotificationContext();

  const onDataRef = useRef<(data: number[]) => void>(onData);

  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);

  useEffect(() => {
    if (peripheralId) setPeripheral(peripheralId);
  }, [peripheralId, setPeripheral]);

  useEffect(() => {
    if (!peripheralId || !collecting) return;

    const subscriber: BleSubscriber = {
      onData: (data) => onDataRef.current(data),
    };

    return subscribe(subscriber);
  }, [peripheralId, collecting, subscribe]);
};
