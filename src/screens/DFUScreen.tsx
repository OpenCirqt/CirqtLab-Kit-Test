import Ionicons from "@expo/vector-icons/Ionicons";
import { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import {
  CompositeNavigationProp,
  useIsFocused,
} from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import ExpoNordicDfu from "@xinhao128/expo-nordic-dfu";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { useNavigation } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import BleManager, { Peripheral } from "react-native-ble-manager";
import ButtonUi from "../components/common/ButtonUi";
import ModalUi from "../components/common/ModalUi";
import TextUi from "../components/common/TextUi";
import NumberCircle from "../components/dfu/NumberCircle";
import ProgressBar from "../components/dfu/ProgressBar";
import { clearPeripheral, setUploading } from "../features/ble/bleSlice";
import { DFURootStackParamList } from "../navigations/DFUNavigator";
import { RootTabParamList } from "../navigations/TabNavigator";
import { useAppDispatch, useAppSelector } from "../store";
import { Colors } from "../theme";
import { fs, px } from "../utils/setSize";

type FirmwareFileType = {
  uri: string;
  name: string;
};

type ProgressType = {
  state?: string;
  avgSpeed?: number;
  currentPart?: number;
  partsTotal?: number;
  percent?: number;
  speed?: number;
};

enum DFUSteps {
  ENABLING_DFU_MODE = "ENABLING_DFU_MODE",
  DFU_UPLOADING = "DFU_UPLOADING",
  DFU_COMPLETED = "DFU_COMPLETED",
}

type DFUScreenProp = NativeStackNavigationProp<DFURootStackParamList, "DFU">;

type DFUSCreenNavigationProp = CompositeNavigationProp<
  DFUScreenProp,
  BottomTabNavigationProp<RootTabParamList>
>;

const FAILED_INDEX = 9999;

const toSentenceCase = (input: string): string => {
  return input
    .toLowerCase()
    .split("_")
    .map((word, i) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

const DFUScreen = () => {
  const [firmwareFile, setFirmwareFile] = useState<
    FirmwareFileType | undefined
  >(undefined);
  const [firmwareProgress, setFirmwareProgress] = useState<
    ProgressType | undefined
  >(undefined);
  const currentIndexRef = useRef(-1);

  const navigation = useNavigation<DFUSCreenNavigationProp>();

  const connectedDevice = useAppSelector((state) => state.ble.peripheral);
  const { numOfPackets, disableResume, forceScanningLegacyDfu } =
    useAppSelector((state) => state.dfu);
  const isCollecting = useAppSelector((state) => state.ble.collecting);

  const [modalVisible, setModalVisible] = useState(false);
  const isFocused = useIsFocused();

  useEffect(() => {
    if (isFocused) {
      setModalVisible(isCollecting);
    }
  }, [isCollecting, isFocused]);

  const dispatch = useAppDispatch();

  const handleFileSelect = async (): Promise<void> => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/zip", "application/x-zip-compressed"],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];

        if (!file.name.toLowerCase().endsWith(".zip")) {
          Alert.alert(
            "Invalid File",
            "Please select a valid firmware (.zip) file"
          );
          return;
        }

        const fileInfo = await FileSystem.getInfoAsync(file.uri);
        if (!fileInfo.exists) {
          throw new Error("File does not exist");
        }

        console.debug("File selected:", file);
        setFirmwareFile({
          uri: file.uri,
          name: file.name,
        });
      }
    } catch (err) {
      console.error("File select error", err);
      Alert.alert("Error", "Check your file and try again");
    }
  };

  const startDFU = async (
    peripheral: Peripheral | null,
    firmwareFile?: FirmwareFileType
  ) => {
    if (!peripheral?.id || !firmwareFile?.uri) return;

    dispatch(setUploading(true));

    try {
      ExpoNordicDfu.module.addListener("DFUProgress", (progress) => {
        console.info("DFUProgress:", progress);
        setFirmwareProgress({ ...progress, state: "Updating..." });
      });
      ExpoNordicDfu.module.addListener("DFUStateChanged", ({ state }) => {
        console.info("DFUStateChanged:", state);

        if (currentIndexRef.current < 0) {
          currentIndexRef.current = 0;
        } else if (
          state === "DFU_UPLOADING" ||
          state === "DFU_PROCESS_STARTED"
        ) {
          if (currentIndexRef.current === 0) {
            currentIndexRef.current = 1;
          }
        } else if (
          state === "FIRMWARE_VALIDING" ||
          state === "DEVICE_DISCONNECTING"
        ) {
          if (currentIndexRef.current === 1) {
            currentIndexRef.current = 2;
          }
        } else if (state === "DFU_FAILED" || state === "DFU_ABORTED") {
          currentIndexRef.current = FAILED_INDEX;
          disconnect();
        } else if (state === "DFU_COMPLETED") {
          currentIndexRef.current = 3;
          dispatch(clearPeripheral());
        }

        setFirmwareProgress({ state, ...firmwareProgress });
      });
      await ExpoNordicDfu.startDfu({
        deviceAddress: peripheral.id,
        fileUri: firmwareFile.uri,
        packetReceiptNotificationParameter: numOfPackets,
        disableResume: disableResume,
        forceScanningForNewAddressInLegacyDfu: forceScanningLegacyDfu,
        android: {
          deviceName: peripheral.name,
        },
      });
    } catch (error) {
      console.error(error);
    } finally {
      ExpoNordicDfu.module.removeAllListeners("DFUProgress");
      ExpoNordicDfu.module.removeAllListeners("DFUStateChanged");

      dispatch(setUploading(false));
    }
  };

  const disconnect = async () => {
    if (connectedDevice?.id) {
      await BleManager.disconnect(connectedDevice.id);
      dispatch(clearPeripheral());
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={styles.container}
      >
        <View style={styles.step}>
          <NumberCircle number={1} style={styles.stepNumber} />
          <View style={styles.stepRowContainer}>
            <View style={styles.stepRow}>
              <TextUi tag="h2" weight="medium" style={styles.stepText}>
                Select File
              </TextUi>
              <ButtonUi
                type={"primary"}
                size="large"
                style={styles.stepButton}
                onPress={handleFileSelect}
              >
                {firmwareFile?.uri ? "Manage" : "Select"}
              </ButtonUi>
            </View>
            <View style={styles.stepContent}>
              <TextUi
                tag="h4"
                weight="medium"
                style={
                  firmwareFile?.name
                    ? styles.stepContentText
                    : styles.stepContentDefaultText
                }
              >
                {firmwareFile?.name ?? "No .zip found."}
              </TextUi>
            </View>
          </View>
        </View>
        <View style={styles.step}>
          <NumberCircle number={2} style={styles.stepNumber} />
          <View style={styles.stepRowContainer}>
            <View style={styles.stepRow}>
              <TextUi tag="h2" weight="medium" style={styles.stepText}>
                Select Device
              </TextUi>
              <ButtonUi
                type={"primary"}
                size="large"
                style={styles.stepButton}
                onPress={() => {
                  currentIndexRef.current = -1;
                  navigation.navigate("BluetoothConnection");
                }}
              >
                {connectedDevice?.id ? "Manage" : "Select"}
              </ButtonUi>
            </View>
            <View style={styles.stepContent}>
              <TextUi
                tag="h4"
                weight="medium"
                style={
                  connectedDevice?.name
                    ? styles.stepContentText  
                    : styles.stepContentDefaultText
                }
              >
                {connectedDevice?.name ?? "No Device Selected."}
              </TextUi>
            </View>
          </View>
        </View>
        <View style={styles.step}>
          <NumberCircle number={3} style={styles.stepNumber} />
          <View style={styles.stepRowContainer}>
            <View style={styles.stepRow}>
              <TextUi tag="h2" weight="medium" style={styles.stepText}>
                Upload Code
              </TextUi>
              <ButtonUi
                type={
                  connectedDevice?.id && firmwareFile?.uri
                    ? "primary"
                    : "disabled"
                }
                size="large"
                style={styles.stepButton}
                onPress={() => startDFU(connectedDevice, firmwareFile)}
              >
                Upload
              </ButtonUi>
            </View>
            <View style={styles.stepContent}>
              {Object.values(DFUSteps).map((step, index) => {
                let icon = null;

                if (currentIndexRef.current === FAILED_INDEX) {
                  icon = (
                    <Ionicons
                      name="close-circle"
                      size={22}
                      color={Colors.red}
                    />
                  );
                } else {
                  if (index < currentIndexRef.current) {
                    icon = (
                      <Ionicons
                        name="checkmark-circle"
                        size={22}
                        color={Colors.primary}
                      />
                    );
                  } else if (index === currentIndexRef.current) {
                    icon = (
                      <ActivityIndicator size="small" color={Colors.black} />
                    );
                  } else {
                    icon = (
                      <Ionicons
                        name="time-outline"
                        size={22}
                        color={Colors.disabled}
                      />
                    );
                  }
                }

                return (
                  <View key={step}>
                    <View style={styles.uploadStepRow}>
                      <View style={styles.uploadStatusIconContainer}>
                        {icon}
                      </View>
                      <TextUi tag="h4" weight="medium" style={styles.stepContentText}>
                        {toSentenceCase(step)}
                      </TextUi>
                    </View>
                    {step === "DFU_UPLOADING" &&
                      currentIndexRef.current === 1 && (
                        <ProgressBar
                          progress={firmwareProgress?.percent ?? 0}
                        />
                      )}
                  </View>
                );
              })}
            </View>
          </View>
        </View>
        <ModalUi
          visible={modalVisible}
          status="collecting"
          onNavigate={() => {
            setModalVisible(false);
            navigation.navigate("DashboardTab", {
              screen: "Dashboard",
            });
          }}
        />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.lightGray,
    padding: px(20),
  },
  step: {
    flexDirection: "row",
    gap: px(16),
    padding: px(16),
    paddingBottom: px(20),
    marginVertical: px(16),
    borderRadius: px(20),
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: px(4),
    elevation: px(2), // for Android
    backgroundColor: Colors.white,
  },
  stepNumber: {
    marginTop: px(16),
  },
  stepRowContainer: {
    flexShrink: 1,
    flexGrow: 1,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: px(16),
  },
  stepText: {
    flexGrow: 1,
  },
  stepButton: {
    width: px(160),
  },
  stepContent: {
    padding: fs(12),
    marginVertical: fs(8),
    borderRadius: fs(16),
    backgroundColor: Colors.warmGray,
    flexDirection: "column",
    gap: px(16),
  },
  stepContentText: {
    color: Colors.darkInfoTitleText,
  },
  stepContentDefaultText: {
    color: Colors.infoTitleText,
  },
  uploadStepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: px(16),
  },
  uploadStatusIconContainer: {
    width: px(40),
    alignItems: "center",
  },
});

export default DFUScreen;
