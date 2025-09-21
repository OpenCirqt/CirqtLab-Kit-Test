import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  SectionList,
  StyleSheet,
  View,
} from "react-native";
import type { Peripheral } from "react-native-ble-manager";
import BleManager from "react-native-ble-manager";
import ButtonUi from "../components/common/ButtonUi";
import TextUi from "../components/common/TextUi";
import DeviceCard from "../components/dashboard/DeviceCard";
import { setPeripheral } from "../features/ble/bleSlice";
import { useAppDispatch, useAppSelector } from "../store";
import { Colors } from "../theme";
import { fs, px } from "../utils/setSize";
import { ServiceUUID } from "../utils/UUIDs";

const BluetoothConnectionScreen = () => {
  const [peripherals, setPeripherals] = useState<Peripheral[]>([]);
  const [isScanning, setIsScanning] = useState<boolean>(true);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const connectedPeripheral = useAppSelector((state) => state.ble.peripheral);

  const connectedDevices = connectedPeripheral ? [connectedPeripheral] : [];

  const discoveredDevices = peripherals.filter(
    (p) => connectedPeripheral?.id !== p.id
  );

  const sections = [
    {
      title: "Connected Devices",
      data: connectedDevices,
    },
    {
      title: "Discovered Devices",
      data: discoveredDevices,
    },
  ];

  const dispatch = useAppDispatch();

  useEffect(() => {
    const discoverListener = BleManager.onDiscoverPeripheral(
      handleDiscoverPeripheral
    );
    const onStopScanListener = BleManager.onStopScan(() =>
      setIsScanning(false)
    );

    scan();

    return () => {
      discoverListener.remove();
      onStopScanListener.remove();
      console.log("BLEDeviceSelectModal unmounted");
    };
  }, []);

  const handleDiscoverPeripheral = (peripheral: Peripheral) => {
    if (!peripheral.name) {
      peripheral.name = "NO NAME";
    }
    setPeripherals((prev) => {
      if (prev.find((p) => p.id === peripheral.id)) {
        return prev;
      }
      return [...prev, peripheral];
    });
  };

  const scan = async () => {
    try {
      setIsScanning(true);
      setPeripherals([]);
      await BleManager.scan([ServiceUUID], 5, false);
    } catch (error) {
      await BleManager.stopScan();
      throw error;
    } finally {
      setIsScanning(false);
    }
  };

  const connectToDevice = async (device: Peripheral) => {
    if (connectingId) return; // Ignore if already connecting

    if (connectedPeripheral?.id === device.id) {
      try {
        setConnectingId(device.id);
        await BleManager.disconnect(device.id);
        dispatch(setPeripheral(null));
        setConnectingId(null);
      } catch (e) {
        console.warn("Disconnect error:", e);
      }
    } else {
      // Disconnect current and start connecting new
      try {
        if (connectedPeripheral) {
          setConnectingId(connectedPeripheral.id);
          await BleManager.disconnect(connectedPeripheral.id);
          dispatch(setPeripheral(null));
          setConnectingId(null);
        }
      } catch (e) {
        console.warn("Disconnect error:", e);
      }

      try {
        setConnectingId(device.id);
        await BleManager.connect(device.id);

        // android only
        if (Platform.OS === "android") {
          console.debug(`${device.id}] createBond`);
          try {
            await BleManager.createBond(device.id);
            console.debug(
              `${device.id}] createBond success or there is already an existing one`
            );
          } catch (e) {
            console.warn(`${device.id}] createBond failed:`, e);
          }
        }

        setConnectingId(null);
        dispatch(setPeripheral(device));
      } catch (e) {
        console.warn("Connection error:", e);
      }
    }
  };

  return (
    <View style={styles.listContent}>
      <SectionList
        sections={sections}
        data={peripherals}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const isLoading = connectingId === item.id;
          const isConnected = connectedPeripheral?.id === item.id;

          return (
            <DeviceCard
              peripheral={item}
              loading={isLoading}
              connected={isConnected}
              onPress={() => connectToDevice(item)}
            />
          );
        }}
        renderSectionHeader={({ section: { title } }) => (
          <TextUi tag="h4" weight="bold" style={styles.sectionHeader}>
            {title}
          </TextUi>
        )}
        renderSectionFooter={({ section }) => {
          if (isScanning) {
            return (
              <View style={styles.placeholderContainer}>
                <ActivityIndicator size="small"></ActivityIndicator>
              </View>
            );
          } else {
            if (section.data.length === 0) {
              return (
                <View style={styles.placeholderContainer}>
                  <TextUi tag="h3" weight="bold" style={styles.placeholderText}>
                    No devices found
                  </TextUi>
                </View>
              );
            }
          }
          return <View style={styles.placeholderHeight}></View>;
        }}
      />
      <ButtonUi
        type="primary"
        size="large"
        onPress={scan}
        customStyle={styles.button}
      >
        Re-scan
      </ButtonUi>
    </View>
  );
};

const styles = StyleSheet.create({
  sectionHeader: {
    paddingVertical: px(6),
    paddingHorizontal: px(12),
  },
  listContent: {
    margin: fs(16),
    flex: 1,
  },
  placeholderContainer: {
    padding: px(16),
    flexDirection: "row",
    justifyContent: "center",
  },
  placeholderText: {
    color: Colors.text,
  },
  placeholderHeight: {
    height: px(30),
  },
  button: {
    marginBottom: px(50),
  },
});

export default BluetoothConnectionScreen;
