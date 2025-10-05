import { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import {
  CompositeNavigationProp,
  useIsFocused,
  useNavigation,
} from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as FileSystem from "expo-file-system";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  processColor,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import BleManager from "react-native-ble-manager";
import { LineChart, LineData, LineDataset } from "react-native-charts-wrapper";
import ButtonUi from "../components/common/ButtonUi";
import ModalUi from "../components/common/ModalUi";
import NotificationUi from "../components/common/NotificationUi";
import PermissionModalUi from "../components/common/PermissionModalUi";
import TextUi from "../components/common/TextUi";
import StatCard from "../components/dashboard/StatCard";
import {
  clearPeripheral,
  setAutoConnect,
  setCollecting,
} from "../features/ble/bleSlice";
import useAppPermission from "../hooks/useAppPermission";
import { useBleLiveStream } from "../hooks/useBleLiveStream";
import { DashboardRootStackParamList } from "../navigations/DashboardNavigator";
import { RootTabParamList } from "../navigations/TabNavigator";
import { useAppDispatch, useAppSelector } from "../store";
import { Colors } from "../theme";
import { DataTypes, Status } from "../utils/constants";
import { MaxBufferSize, SensorParameter } from "../utils/indexRange";
import { px } from "../utils/setSize";

type DashboardScreenProp = NativeStackNavigationProp<
  DashboardRootStackParamList,
  "Dashboard"
>;

type DashboardScreenNavigationProp = CompositeNavigationProp<
  DashboardScreenProp,
  BottomTabNavigationProp<RootTabParamList>
>;

type ChartValue = { x: number; y: number };

type PendingAction = "collection" | "disconnect" | null;

const colors = [Colors.primary, Colors.red, Colors.blue];

const buildDataSets = (
  nestedData: number[][],
  dataType: DataTypes
): LineDataset[] => {
  const keepIndices = SensorParameter[dataType];
  return keepIndices.map((colIndex, lineIndex) => {
    const values: ChartValue[] = nestedData.map((row, x) => ({
      x, // row index = x
      y: row[colIndex], // take the value at the kept column
    }));

    return {
      values,
      label: `Line ${colIndex}`, // label by original column index
      config: {
        color: processColor(colors[lineIndex % colors.length]) as number,
        drawValues: false,
        lineWidth: 1,
        drawCircles: false,
        mode: "CUBIC_BEZIER",
      },
    };
  });
};

const DashboardScreen = () => {
  const connectedDevice = useAppSelector((state) => state.ble.peripheral);
  const isAutoReconnect = useAppSelector((state) => state.ble.autoReconnect);
  const selectedDataPoints = useAppSelector(
    (state) => state.ble.selectedDataPoints
  );
  const collecting = useAppSelector((state) => state.ble.collecting);
  const uploading = useAppSelector((state) => state.ble.uploading);
  const filePrefix = useAppSelector((state) => state.fileStorage.filePrefix);

  const dispatch = useAppDispatch();

  // graph
  const cachedData = useRef<number[][]>([]);
  const graphUpdateTimer = useRef<number | null>(null);

  // stats
  const graphComputeTimeRef = useRef<number>(0);
  const bufferUsedSizeRef = useRef<number>(0);
  const elapsedStartRef = useRef<number>(0);
  const elapsedTimeRef = useRef<number>(0);

  // graph datasets
  const chart1Ref = React.useRef<LineChart>(null);
  const [chart1DataSet, setChart1DataSet] = useState<LineData>({});
  const chart2Ref = React.useRef<LineChart>(null);
  const [chart2DataSet, setChart2DataSet] = useState<LineData>({});

  // selected data points
  const selectedDataPoint1Ref = useRef<DataTypes>(DataTypes.ACC);
  const selectedDataPoint2Ref = useRef<DataTypes>(DataTypes.PPG_IR);

  // navigation
  const navigation = useNavigation<DashboardScreenNavigationProp>();
  const isFocused = useIsFocused();

  // error handling/ save modal
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [doneMessage, setDoneMessage] = useState<string | undefined>(undefined);

  // autoConnect
  const hasTried = useRef(false);

  const handleStopCollection = () => {
    clearInterval(graphUpdateTimer.current!);
    dispatch(setCollecting(false));
  };

  const disconnectDevice = async () => {
    if (connectedDevice?.id) {
      dispatch(clearPeripheral());
      resetStates();
      await BleManager.disconnect(connectedDevice.id, false);
    }
  };

  const {
    showModal,
    setShowModal,
    bluetoothState,
    locationState,
    handleOpenSettings,
    checkStatus,
  } = useAppPermission((enableScan) => {
    if (enableScan) {
      navigation.navigate("BluetoothConnection");
    }
  });

  // if bluetooth or location (for android) dropped, stop data collection and disconnect device
  useEffect(() => {
    if (
      (bluetoothState && bluetoothState !== "on") ||
      (locationState && locationState !== "READY")
    ) {
      handleStopCollection();
      disconnectDevice();
    }

    if (
      bluetoothState === "on" &&
      locationState === "READY" &&
      connectedDevice?.id &&
      !hasTried.current
    ) {
      const timeout = (ms: number) =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), ms)
        );
      hasTried.current = true;
      dispatch(setAutoConnect(true));

      const connect = (async () => {
        await BleManager.connect(connectedDevice.id);
      })();

      const tryReconnect = async () => {
        try {
          await Promise.race([
            connect,
            timeout(5000), // 5 second timeout
          ]);
          console.info("[AutoConnect] Connected");
        } catch (e) {
          console.warn("[AutoConnect] Failed", e);
          dispatch(clearPeripheral());
          BleManager.disconnect(connectedDevice.id, false);
        } finally {
          dispatch(setAutoConnect(false));
        }
      };

      tryReconnect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bluetoothState, locationState, dispatch, connectedDevice]);

  // subscribes to device data updates
  useBleLiveStream(
    connectedDevice?.id,
    collecting,
    (data) => {
      cachedData.current.push(data as number[]);
    },
    (data) => {
      elapsedStartRef.current = data;
    }
  );

  useEffect(() => {
    selectedDataPoint1Ref.current = selectedDataPoints[0];
    selectedDataPoint2Ref.current = selectedDataPoints[1];
  }, [selectedDataPoints]);

  useEffect(() => {
    if (isFocused && uploading) {
      setVisible(true);
      setStatus("uploading");
    } else {
      setVisible(false);
      setStatus("idle");
    }
  }, [uploading, isFocused]);

  const setUpTimer = () => {
    dispatch(setCollecting(true));
    resetStates();

    // @ts-ignore
    chart1Ref.current.fitScreen();
    // @ts-ignore
    chart2Ref.current.fitScreen();

    let threshold = 300;
    if (
      selectedDataPoints[0].includes("ppg") ||
      selectedDataPoints[1].includes("ppg")
    ) {
      threshold = 1000;
    }

    graphUpdateTimer.current = setInterval(() => {
      const startTime = Date.now();

      setChart1DataSet({
        dataSets: buildDataSets(
          cachedData.current.slice(-threshold),
          selectedDataPoint1Ref.current
        ),
      });
      setChart2DataSet({
        dataSets: buildDataSets(
          cachedData.current.slice(-threshold),
          selectedDataPoint2Ref.current
        ),
      });

      graphComputeTimeRef.current = Date.now() - startTime;

      if (elapsedStartRef.current === 0) {
        elapsedTimeRef.current = 0;
      } else {
        elapsedTimeRef.current =
          Math.round(((Date.now() - elapsedStartRef.current) / 1000) * 100) /
          100;
      }

      bufferUsedSizeRef.current =
        bufferUsedSizeRef.current +
        cachedData.current.length *
          (cachedData.current[0] === undefined
            ? 0
            : cachedData.current[0].length * 4);

      if (bufferUsedSizeRef.current > MaxBufferSize) {
        Alert.alert(
          "Warning",
          "Buffer is full, stopping collection. Please save your data."
        );
        dispatch(setCollecting(false));
      }
    }, 300);
  };

  const convertToCsv = (matrix: number[][]) => {
    return matrix.map((row) => row.join(",")).join("\n");
  };

  const saveCsvFile = async () => {
    try {
      setStatus("saving");
      const csvString = convertToCsv(cachedData.current);

      const now = Date.now();
      const dir = `${FileSystem.documentDirectory}${filePrefix}/`;
      const fileUri = `${dir}${filePrefix}_${now}.csv`;

      const fileDisplay = `${filePrefix}_${now}.csv`;

      const dirInfo = await FileSystem.getInfoAsync(dir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(dir, {
          intermediates: true,
        });
      }

      await FileSystem.writeAsStringAsync(fileUri, csvString, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      setDoneMessage(`File ${fileDisplay} has been saved.`);
    } catch (err) {
      setDoneMessage(`Error: ${String(err)}`);
    } finally {
      setStatus("done");
      resetStates();
    }
  };

  const handleStartCollection = () => {
    if (cachedData.current.length > 0) {
      setVisible(true);
      setStatus("unsaved");
      setPendingAction("collection");
    } else {
      setUpTimer();
    }
  };

  const disconnect = () => {
    if (cachedData.current.length > 0) {
      setVisible(true);
      setStatus("unsaved");
      setPendingAction("disconnect");
    } else {
      disconnectDevice();
    }
  };

  const resetStates = () => {
    cachedData.current = [];
    setChart1DataSet({ dataSets: [] });
    setChart2DataSet({ dataSets: [] });
    bufferUsedSizeRef.current = 0;
    graphComputeTimeRef.current = 0;
    elapsedStartRef.current = 0;
    elapsedTimeRef.current = 0;
  };

  const generateLastReading = (dataType: DataTypes) => {
    if (cachedData.current.length === 0) {
      return;
    }
    const indices = SensorParameter[dataType];
    return indices.map((index, i) => (
      <TextUi
        tag="h5"
        weight="medium"
        key={SensorParameter[dataType] + " " + i}
        style={{ color: colors[i % colors.length] }}
      >
        {cachedData.current[cachedData.current.length - 1][index].toFixed(2)}
        {i !== indices.length - 1 && ", "}
      </TextUi>
    ));
  };

  const generateGraphHeader = (dataType: DataTypes) => {
    return (
      <View style={styles.graphCardHeaderContainer}>
        <TextUi tag="h2" weight="bold" style={styles.graphHeader}>
          {dataType.toUpperCase()}
        </TextUi>
        {cachedData.current.length > 1 && (
          <View style={styles.graphLastReadingContainer}>
            <TextUi tag="h5" weight="medium">
              Last Reading:
            </TextUi>
            <View style={styles.graphLastReading}>
              {generateLastReading(dataType)}
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={styles.container}
        contentContainerStyle={styles.contentContainerStyle}
      >
        {isAutoReconnect && connectedDevice?.id ? (
          <NotificationUi
            type="disabled"
            message={`Found device ${connectedDevice.name}. Reconnecting...`}
            buttonText="Scan"
            onPress={() => {
              disconnect();
            }}
          />
        ) : connectedDevice?.id ? (
          <NotificationUi
            type={collecting ? "disabled" : "info"}
            message={`Linked device ${connectedDevice.name}`}
            buttonText="Disconnect"
            onPress={() => {
              disconnect();
            }}
          />
        ) : (
          <NotificationUi
            type="warning"
            message="Device not connected. Connect a device to start."
            buttonText="Scan"
            onPress={() => {
              checkStatus(true);
            }}
          />
        )}
        <View style={styles.collectionButton}>
          <ButtonUi
            type={connectedDevice?.id ? "primary" : "disabled"}
            size="medium"
            customStyle={styles.dataPoint}
            onPress={() => {
              if (collecting) {
                handleStopCollection();
              } else {
                handleStartCollection();
              }
            }}
          >
            {collecting ? "Stop Collection" : "Start Collection"}
          </ButtonUi>
          <ButtonUi
            type={
              collecting ||
              !connectedDevice?.id ||
              cachedData.current.length === 0
                ? "disabled"
                : "secondary"
            }
            size="medium"
            customStyle={styles.dataPoint}
            onPress={() => {
              setVisible(true);

              saveCsvFile();
            }}
          >
            Save Data
          </ButtonUi>
        </View>
        <View style={styles.statContainer}>
          <TextUi tag="h2" weight="bold">
            Stats
          </TextUi>
          <View style={styles.statCardRow}>
            <StatCard
              title="Graph Compute Time"
              value={graphComputeTimeRef.current}
              decimal={2}
              unit="ms"
              style={styles.statCard}
            />
            <StatCard
              title="Elapsed Time"
              value={elapsedTimeRef.current}
              decimal={2}
              unit="s"
              style={styles.statCard}
            />
          </View>
          <View style={styles.statCardRow}>
            <StatCard
              title="Buffer Used"
              value={bufferUsedSizeRef.current / 1024 / 1024}
              decimal={2}
              unit="MB"
              style={styles.statCard}
            />
            <StatCard
              title="Windows Fs"
              value={cachedData.current.length / elapsedTimeRef.current || 0}
              decimal={2}
              unit="Hz"
              style={styles.statCard}
            />
          </View>
        </View>
        <View style={styles.graphCard}>
          {generateGraphHeader(selectedDataPoints[0])}
          <LineChart
            style={{ flex: 1 }}
            ref={chart1Ref}
            data={chart1DataSet}
            chartDescription={{ text: "" }}
            xAxis={{
              position: "BOTTOM",
              textColor: processColor("black"),
              textSize: 12,
            }}
            yAxis={{
              left: {
                drawGridLines: true,
                position: "OUTSIDE_CHART",
                textColor: processColor("black"),
                textSize: 12,
              },
              right: { enabled: false },
            }}
            legend={{ enabled: false }}
            maxVisibleValueCount={50}
            dragDecelerationEnabled={true}
            dragDecelerationFrictionCoef={0.99}
            zoom={{ scaleX: 1.5, scaleY: 1, xValue: 0, yValue: 0 }}
          />
        </View>
        <View style={styles.graphCard}>
          {generateGraphHeader(selectedDataPoints[1])}
          <LineChart
            style={{ flex: 1 }}
            ref={chart2Ref}
            data={chart2DataSet}
            chartDescription={{ text: "" }}
            xAxis={{
              position: "BOTTOM",
              textColor: processColor("black"),
              textSize: 12,
            }}
            yAxis={{
              left: {
                drawGridLines: true,
                position: "OUTSIDE_CHART",
                textColor: processColor("black"),
                textSize: 12,
              },
              right: { enabled: false },
            }}
            legend={{ enabled: false }}
            maxVisibleValueCount={50}
            dragDecelerationEnabled={true}
            dragDecelerationFrictionCoef={0.99}
            zoom={{ scaleX: 1.5, scaleY: 1, xValue: 0, yValue: 0 }}
          />
        </View>
      </ScrollView>
      <ModalUi
        visible={visible}
        onClose={() => {
          setVisible(false);
          setStatus("idle");

          if (pendingAction === "collection") {
            setUpTimer();
          } else if (pendingAction === "disconnect") {
            disconnectDevice();
          }
          setPendingAction(null);
        }}
        onContinue={() => {
          setVisible(false);
          setStatus("idle");

          if (pendingAction === "collection") {
            setUpTimer();
          } else if (pendingAction === "disconnect") {
            disconnectDevice();
          }
          setPendingAction(null);
        }}
        onSave={() => {
          if (!visible) {
            setVisible(visible);
          }
          saveCsvFile();
        }}
        onNavigate={() => {
          setVisible(false);
          setStatus("idle");

          navigation.navigate("DFUTab", {
            screen: "DFU",
          });
        }}
        status={status}
        doneMessage={doneMessage}
      />
      <PermissionModalUi
        visible={showModal}
        bleState={bluetoothState}
        locationState={locationState}
        onClose={() => setShowModal(false)}
        onOpenSettings={() => handleOpenSettings()}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.lightGray,
    padding: px(30),
  },
  contentContainerStyle: {
    paddingBottom: px(60),
  },
  graphCard: {
    height: 280,
    padding: px(16),
    marginVertical: px(12),
    borderRadius: px(12),
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: px(4),
    elevation: px(2), // for Android
    backgroundColor: Colors.white,
  },
  graphCardHeaderContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  graphHeader: {
    color: Colors.primary,
  },
  graphLastReadingContainer: {
    flexDirection: "column",
    alignItems: "flex-end",
  },
  graphLastReading: {
    flexDirection: "row",
  },
  collectionButton: {
    flexDirection: "row",
    gap: px(12),
  },
  dataPoint: {
    flex: 1,
  },
  statContainer: {
    marginVertical: px(8),
  },
  statCardRow: {
    flexDirection: "row",
    gap: px(20),
    marginVertical: px(8),
  },
  statCard: {
    flex: 1,
  },
});

export default DashboardScreen;
