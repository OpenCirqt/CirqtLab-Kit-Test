import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import {
  CompositeNavigationProp,
  useIsFocused,
  useNavigation,
} from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as FileSystem from "expo-file-system";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Image,
  processColor,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import BleManager from "react-native-ble-manager";
import { LineChart, LineData, LineDataset } from "react-native-charts-wrapper";
import ButtonUi from "../components/common/ButtonUi";
import ModalUi from "../components/common/ModalUi";
import NotificationUi from "../components/common/NotificationUi";
import PermissionModalUi from "../components/common/PermissionModalUi";
import PPGWarningModal from "../components/common/PPGWarningModal";
import TextUi from "../components/common/TextUi";
import StatCard, { StatCardProps } from "../components/dashboard/StatCard";
import {
  clearPeripheral,
  setAutoConnect,
  setCollecting,
} from "../features/ble/bleSlice";
import useAppPermission from "../hooks/useAppPermission";
import { useBleLiveStream } from "../hooks/useBleLiveStream";
import { PPGSample, usePPGAnalyzer } from "../hooks/usePPGAnalyzer";
import { usePPGStream } from "../hooks/usePPGStream";
import { DashboardRootStackParamList } from "../navigations/DashboardNavigator";
import { RootTabParamList } from "../navigations/TabNavigator";
import { useAppDispatch, useAppSelector } from "../store";
import { Colors } from "../theme";
import {
  DataTypeCategory,
  DataTypes,
  dataTypeToCategory,
  Status,
} from "../utils/constants";
import { defaultFFTConfig, FFTConfig, FFTPresets } from "../utils/fftConfig";
import { transformToFrequencyDomain } from "../utils/fftUtils";
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

// default dataset
const emptyDataSet: LineDataset = {
  label: "Empty",
  values: [{ x: 0, y: 0 }],
  config: {
    color: processColor("transparent"),
    drawValues: false,
    drawCircles: false,
    mode: "CUBIC_BEZIER",
  },
};

// build graph datasets
const buildDataSets = (
  nestedData: number[][],
  dataType: DataTypes,
  fftEnabled: boolean = false,
  fftConfig: FFTConfig = defaultFFTConfig,
): LineDataset[] => {
  const keepIndices = SensorParameter[dataType];

  if (fftEnabled) {
    // FFT mode - transform to frequency domain
    return keepIndices.map((colIndex, lineIndex) => {
      const values = transformToFrequencyDomain(
        nestedData,
        colIndex,
        fftConfig,
      );

      return {
        values,
        label: `FFT Line ${colIndex}`,
        config: {
          color: processColor(colors[lineIndex % colors.length]) as number,
          drawValues: false,
          lineWidth: 1,
          drawCircles: false,
          mode: "CUBIC_BEZIER",
        },
      };
    });
  }

  // Time domain mode (original)
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
  // from redux store
  const connectedDevice = useAppSelector((state) => state.ble.peripheral);
  const isAutoReconnect = useAppSelector((state) => state.ble.autoReconnect);
  const selectedDataPoints = useAppSelector(
    (state) => state.ble.selectedDataPoints,
  );
  const collecting = useAppSelector((state) => state.ble.collecting);
  const uploading = useAppSelector((state) => state.ble.uploading);
  const filePrefix = useAppSelector((state) => state.fileStorage.filePrefix);

  const dispatch = useAppDispatch();

  // graph
  const cachedData = useRef<number[][]>([]);
  const graphUpdateTimer = useRef<ReturnType<typeof setInterval> | null>(null);

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
  const [modalVisible, setModalVisible] = useState(false);
  const [modalStatus, setModalStatus] = useState<Status>("idle");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [doneMessage, setDoneMessage] = useState<string | undefined>(undefined);

  // autoConnect
  const hasTried = useRef(false);

  const cachedPpgData = useRef<number[][]>([]);
  const ppgDataUpdateTimer = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  const {
    addSample,
    analysis,
    reset: resetAnalyzer,
  } = usePPGAnalyzer({
    windowSeconds: 9,
    bpmChannel: "ir",
    minBPM: 40,
    maxBPM: 200,
    bpmHistorySize: 6,
    bpmJumpThreshold: 20,
    bpmConfidenceOverrideThreshold: 0.65,
    analysisIntervalMs: 500,
    skipSpikeFilter: true, // ← pre-cleaned by usePPGStream
  });

  const { addRawPacket, resetStream } = usePPGStream({
    spikeRatioThreshold: 3.0, // >3× the reference median  → spike
    spikeAbsoluteThreshold: 500, // AND >500 ADC units off     → spike
    referenceWindowSize: 12, // last 12 accepted samples   (~480 ms @ 25 Hz)
    maxConsecutiveSpikes: 8, // 8 straight rejections      → reset reference
    replacementStrategy: "hold",

    onCleanSample: useCallback(
      (sample: PPGSample) => {
        // → FFT analyzer
        addSample(sample);
        // → waveform display buffer
      },
      [addSample],
    ),

    onSpike: useCallback(() => {}, []),
  });

  const analysisRef = useRef(analysis);

  useEffect(() => {
    analysisRef.current = analysis;
  }, [analysis]);

  // PPG unlock state
  const ppgUnlocked = useRef<boolean>(false);
  const [showPPGWarning, setShowPPGWarning] = useState(false);

  // FFT state - only available after collection stops
  const [fftEnabled, setFftEnabled] = useState(false);

  // Load PPG unlock state from AsyncStorage on mount
  useEffect(() => {
    const loadPPGUnlockState = async () => {
      try {
        const unlocked = await AsyncStorage.getItem("ppgUnlocked");
        if (unlocked === "true") {
          ppgUnlocked.current = true;
        }
      } catch (error) {
        console.error("Failed to load PPG unlock state:", error);
      }
    };
    loadPPGUnlockState();
  }, []);

  // Handle PPG unlock request
  const handlePPGUnlock = () => {
    setShowPPGWarning(true);
  };

  // Handle PPG warning acceptance
  const handlePPGWarningAccept = async () => {
    try {
      await AsyncStorage.setItem("ppgUnlocked", "true");
      ppgUnlocked.current = true;
      setShowPPGWarning(false);
    } catch (error) {
      console.error("Failed to save PPG unlock state:", error);
    }
  };

  // Handle PPG warning cancel
  const handlePPGWarningCancel = () => {
    setShowPPGWarning(false);
  };

  // Handle PPG re-lock
  const handlePPGLock = async () => {
    try {
      await AsyncStorage.removeItem("ppgUnlocked");
      ppgUnlocked.current = false;
      // setPpgAnalysisResult(null);
      Alert.alert(
        "PPG Locked",
        "Heart Rate and SpO2 readings have been locked. Tap to unlock again.",
        [{ text: "OK" }],
      );
    } catch (error) {
      console.error("Failed to lock PPG:", error);
    }
  };

  // Calculate actual sampling rate from collected data (Windows Fs)
  const getActualSamplingRate = (): number => {
    if (elapsedTimeRef.current > 0 && cachedData.current.length > 0) {
      return cachedData.current.length / elapsedTimeRef.current;
    }
    return 100; // fallback default
  };

  // Get appropriate FFT preset based on data type
  const getFFTPresetForDataType = (dataType: DataTypes): FFTConfig => {
    if (dataType.includes("ppg")) {
      return FFTPresets.ppgAnalysis;
    } else if (dataType.includes("acc")) {
      return FFTPresets.accelerometerAnalysis;
    }
    return FFTPresets.balanced;
  };

  // When FFT is toggled, recompute the graph datasets
  useEffect(() => {
    if (!collecting && cachedData.current.length > 0) {
      // Get the full dataset or a reasonable window
      const threshold = fftEnabled
        ? cachedData.current.length
        : Math.min(cachedData.current.length, 1000);
      const dataSet = cachedData.current.slice(-threshold);

      // Use actual sampling rate from collected data (Windows Fs)
      const actualSamplingRate = getActualSamplingRate();

      // Get presets and update with actual sampling rate
      const fftConfig1 = {
        ...getFFTPresetForDataType(selectedDataPoint1Ref.current),
        samplingRate: actualSamplingRate,
        maxFrequency: Math.min(
          getFFTPresetForDataType(selectedDataPoint1Ref.current).maxFrequency,
          actualSamplingRate / 2, // Nyquist limit
        ),
      };

      const fftConfig2 = {
        ...getFFTPresetForDataType(selectedDataPoint2Ref.current),
        samplingRate: actualSamplingRate,
        maxFrequency: Math.min(
          getFFTPresetForDataType(selectedDataPoint2Ref.current).maxFrequency,
          actualSamplingRate / 2, // Nyquist limit
        ),
      };

      setChart1DataSet({
        dataSets: buildDataSets(
          dataSet,
          selectedDataPoint1Ref.current,
          fftEnabled,
          fftConfig1,
        ),
      });
      setChart2DataSet({
        dataSets: buildDataSets(
          dataSet,
          selectedDataPoint2Ref.current,
          fftEnabled,
          fftConfig2,
        ),
      });
    }
  }, [fftEnabled, collecting]);

  // Disable FFT mode when collection starts
  useEffect(() => {
    if (collecting && fftEnabled) {
      setFftEnabled(false);
    }
  }, [collecting, fftEnabled]);

  const handleStopCollection = () => {
    if (graphUpdateTimer.current != null) {
      clearInterval(graphUpdateTimer.current);
      graphUpdateTimer.current = null;
    }
    if (ppgDataUpdateTimer.current != null) {
      clearInterval(ppgDataUpdateTimer.current);
      ppgDataUpdateTimer.current = null;
    }
    resetAnalyzer();
    resetStream();
    dispatch(setCollecting(false));
  };

  const disconnectDevice = async () => {
    if (connectedDevice?.id) {
      dispatch(clearPeripheral());
      resetStates();
      graphUpdateTimer.current = null;
      ppgDataUpdateTimer.current = null;
      await BleManager.disconnect(connectedDevice.id);
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

    // try auto reconnect the cached BLE device
    // give up if cannot connect within 10 secs
    if (
      bluetoothState === "on" &&
      locationState === "READY" &&
      connectedDevice?.id &&
      !hasTried.current
    ) {
      hasTried.current = true;
      dispatch(setAutoConnect(true));

      const tryReconnect = async () => {
        try {
          let connected = false;
          const timeout = setTimeout(async () => {
            if (!connected) {
              console.warn("[AutoConnect] Failed");
              dispatch(clearPeripheral());
            }
            await BleManager.disconnect(connectedDevice.id);
          }, 10000);

          await BleManager.connect(connectedDevice.id);
          connected = true;

          clearTimeout(timeout);
          console.info("[AutoConnect] Connected");
        } catch (e) {
          console.warn("[AutoConnect] Failed", e);
          dispatch(clearPeripheral());
          await BleManager.disconnect(connectedDevice.id);
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
      const incomingData = data as number[];
      const ir = incomingData[SensorParameter[DataTypes.PPG_IR][0]];
      const red = incomingData[SensorParameter[DataTypes.PPG_RED][0]];
      const green = incomingData[SensorParameter[DataTypes.PPG_GREEN][0]];
      const timestamp = incomingData[incomingData.length - 1];
      const rawPPG = [ir, red, green, timestamp];
      const clean = addRawPacket(rawPPG);
      if (clean) {
        incomingData[SensorParameter[DataTypes.PPG_IR][0]] = clean.ir;
        incomingData[SensorParameter[DataTypes.PPG_RED][0]] = clean.red;
        incomingData[SensorParameter[DataTypes.PPG_GREEN][0]] =
          clean.green ?? 0;
        cachedData.current.push(incomingData);
      } else {
        cachedData.current.push(data as number[]);
      }
    },
    (data) => {
      elapsedStartRef.current = data;
    },
  );

  useEffect(() => {
    selectedDataPoint1Ref.current = selectedDataPoints[0];
    selectedDataPoint2Ref.current = selectedDataPoints[1];
  }, [selectedDataPoints]);

  // cannot start data collection while conducting DFU
  useEffect(() => {
    if (isFocused && uploading) {
      setModalVisible(true);
      setModalStatus("uploading");
    } else {
      setModalVisible(false);
      setModalStatus("idle");
    }
  }, [uploading, isFocused]);

  const setUpTimer = () => {
    dispatch(setCollecting(true));

    let threshold = 300;
    if (
      selectedDataPoints[0].includes("ppg") ||
      selectedDataPoints[1].includes("ppg")
    ) {
      threshold = 1000;
    }

    graphUpdateTimer.current = setInterval(() => {
      const startTime = Date.now();

      const dataSet = cachedData.current.slice(-threshold);

      if (dataSet.length === 0) {
        return;
      }

      // update graph datasets (always in time domain during collection)
      setChart1DataSet({
        dataSets: buildDataSets(
          dataSet,
          selectedDataPoint1Ref.current,
          false,
          defaultFFTConfig,
        ),
      });
      setChart2DataSet({
        dataSets: buildDataSets(
          dataSet,
          selectedDataPoint2Ref.current,
          false,
          defaultFFTConfig,
        ),
      });

      // update graph compute time
      graphComputeTimeRef.current = Date.now() - startTime;

      // update elapsed time
      if (elapsedStartRef.current === 0) {
        elapsedTimeRef.current = 0;
      } else {
        elapsedTimeRef.current =
          Math.round(((Date.now() - elapsedStartRef.current) / 1000) * 100) /
          100;
      }

      // update buffer used
      bufferUsedSizeRef.current +=
        cachedData.current.length *
        (cachedData.current[0]?.length ? cachedData.current[0].length * 8 : 0);

      if (bufferUsedSizeRef.current > MaxBufferSize) {
        Alert.alert(
          "Warning",
          "Buffer is full, stopping collection. Please save your data.",
        );
        dispatch(setCollecting(false));
      }

      cachedPpgData.current.push([
        analysisRef.current.bpm ?? 0,
        analysisRef.current.spo2 ?? 0,
        Date.now(),
      ]);

      // update buffer used
      bufferUsedSizeRef.current +=
        cachedPpgData.current.length *
        (cachedPpgData.current[0]?.length
          ? cachedPpgData.current[0].length * 8
          : 0);
    }, 300);

    ppgDataUpdateTimer.current = setInterval(() => {
      // to be removed soon
    }, 1000);
  };

  const convertToCsv = (matrix: number[][]) => {
    return matrix.map((row) => row.join(",")).join("\n");
  };

  const saveCsvFile = async () => {
    try {
      setModalStatus("saving");
      const csvString = convertToCsv(cachedData.current);

      const now = Date.now();
      const dir = `${FileSystem.documentDirectory}${filePrefix}/`;
      const rawFileDisplay = `${filePrefix}_raw_${now}.csv`;
      const rawFileUri = `${dir}${rawFileDisplay}`;

      const dirInfo = await FileSystem.getInfoAsync(dir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(dir, {
          intermediates: true,
        });
      }

      await FileSystem.writeAsStringAsync(rawFileUri, csvString, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      let doneMessage = `File ${rawFileDisplay} has been saved.`;

      // if (Platform.OS === "android") {
      const csvOutputString = convertToCsv(cachedPpgData.current);

      const outputFileDisplay = `${filePrefix}_output_${now}.csv`;
      const outputFileUri = `${dir}${outputFileDisplay}`;

      await FileSystem.writeAsStringAsync(outputFileUri, csvOutputString, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      doneMessage = `Files ${rawFileDisplay} and ${outputFileDisplay} have been saved`;
      // }

      setDoneMessage(doneMessage);
    } catch (err) {
      setDoneMessage(`Error: ${String(err)}`);
    } finally {
      setModalStatus("done");
    }
  };

  /**
   * Show a dialog if there're unsaved data when trying to start a new data collection
   * Otherwise, start timer directly
   */
  const handleStartCollection = () => {
    if (cachedData.current.length > 0) {
      setModalVisible(true);
      setModalStatus("unsaved");
      setPendingAction("collection");
    } else {
      setUpTimer();
    }
  };

  /**
   * Show a dialog if there're unsaved data when trying to disconnect BLE device
   * Otherwise, disconnect device directly
   */
  const disconnect = () => {
    if (cachedData.current.length > 0) {
      setModalVisible(true);
      setModalStatus("unsaved");
      setPendingAction("disconnect");
    } else {
      disconnectDevice();
    }
  };

  const resetStates = () => {
    // clear graph timer
    if (graphUpdateTimer.current !== null) {
      clearInterval(graphUpdateTimer.current);
    }

    // clear ppg analysis timer
    if (ppgDataUpdateTimer.current !== null) {
      clearInterval(ppgDataUpdateTimer.current);
    }

    // clear BLE emitted data
    cachedData.current = [];
    cachedPpgData.current = [];

    // clear and reset PPG analysis
    resetStream();
    resetAnalyzer();

    // reset FFT mode
    setFftEnabled(false);

    // @ts-ignore
    chart1Ref.current?.fitScreen();
    // @ts-ignore
    chart2Ref.current?.fitScreen();

    // clear graph data and stats
    setChart1DataSet({
      dataSets: [emptyDataSet],
    });
    setChart2DataSet({
      dataSets: [emptyDataSet],
    });
    bufferUsedSizeRef.current = 0;
    graphComputeTimeRef.current = 0;
    elapsedStartRef.current = 0;
    elapsedTimeRef.current = 0;
  };

  /**
   * Displays the last reading of BLE data
   * @param dataType - supported BLE data types
   * @returns JSX
   */
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

  /**
   * Generates graph header
   * @param dataType - supported BLE data types
   * @returns JSX
   */
  const generateGraphHeader = (dataType: DataTypes, fftEnabled: boolean) => {
    return (
      <View style={styles.graphCardHeaderContainer}>
        <View style={styles.graphCardHeaderLeft}>
          {dataTypeToCategory[dataType] === DataTypeCategory.IMU && (
            <Image
              source={require("../assets/images/imu_sensor.png")}
              style={{ width: px(57), height: px(57) }}
              resizeMode="contain"
            />
          )}
          {dataTypeToCategory[dataType] === DataTypeCategory.PPG && (
            <Ionicons
              name="pulse-outline"
              size={px(54)}
              color={Colors.tertiary}
            />
          )}
          <TextUi tag="h2" weight="bold" style={styles.graphHeader}>
            {dataType.toUpperCase()}
            <TextUi tag="h3" weight="bold" style={styles.graphHeader}>
              {fftEnabled ? " (FFT)" : " (Time Domain)"}
            </TextUi>
          </TextUi>
        </View>
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

  const { width } = useWindowDimensions();

  /**
   * Generates Stat Cards
   * NOTE: Hide heart rate and SpO2 for now
   */
  const generateStatCards = () => {
    const statCardPropsList: StatCardProps[] = [
      {
        title: "Graph Compute Time",
        value: graphComputeTimeRef.current,
        decimal: 2,
        unit: "ms",
      },
      {
        title: "Elapsed Time",
        value: elapsedTimeRef.current,
        decimal: 2,
        unit: "s",
        timeConversion: true,
      },
      {
        title: "Buffer Used",
        value: bufferUsedSizeRef.current / 1024 / 1024,
        decimal: 2,
        unit: "MB",
      },
      {
        title: "Windows Fs",
        value: cachedData.current.length / elapsedTimeRef.current || 0,
        decimal: 2,
        unit: "Hz",
      },
    ];

    // if (Platform.OS === "android") {
    statCardPropsList.push({
      title: "Heart Rate",
      value: ppgUnlocked.current ? analysis?.bpm : undefined,
      decimal: 2,
      unit: "bpm",
      locked: !ppgUnlocked.current,
      onUnlock: handlePPGUnlock,
      onLock: handlePPGLock,
    });
    statCardPropsList.push({
      title: "SpO2",
      value: ppgUnlocked.current ? analysis?.spo2 : undefined,
      decimal: 2,
      unit: "%",
      locked: !ppgUnlocked.current,
      onUnlock: handlePPGUnlock,
      onLock: handlePPGLock,
    });
    // }

    const itemsPerRow = statCardPropsList.length <= 4 ? 2 : 3;
    const itemWidth =
      (width - px(50) - (itemsPerRow - 1) * px(16)) / itemsPerRow;

    return (
      <View style={styles.statCardContainer}>
        {statCardPropsList.map((item, index) => (
          <StatCard
            key={"stat" + index}
            title={item.title}
            value={item.value}
            decimal={item.decimal}
            unit={item.unit}
            locked={item.locked}
            onUnlock={item.onUnlock}
            onLock={item.onLock}
            timeConversion={item.timeConversion}
            style={{
              width: itemWidth,
            }}
          />
        ))}
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
            style={styles.dataPoint}
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
            style={styles.dataPoint}
            onPress={() => {
              setModalVisible(true);

              saveCsvFile();
            }}
          >
            Save Data
          </ButtonUi>
        </View>
        <View style={styles.collectionButton}>
          <ButtonUi
            type={
              collecting || cachedData.current.length === 0
                ? "disabled"
                : fftEnabled
                  ? "primary"
                  : "secondary"
            }
            size="medium"
            style={{ flex: 1 }}
            onPress={() => {
              setFftEnabled(!fftEnabled);
            }}
          >
            {fftEnabled ? "Time Domain" : "Frequency Domain (FFT)"}
          </ButtonUi>
        </View>
        <View style={styles.statContainer}>
          <TextUi tag="h2" weight="bold">
            Stats
          </TextUi>
          {generateStatCards()}
        </View>
        <View style={styles.graphCard}>
          {generateGraphHeader(selectedDataPoints[0], fftEnabled)}
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
            maxVisibleValueCount={fftEnabled ? 500 : 50}
            dragDecelerationEnabled={true}
            dragDecelerationFrictionCoef={0.99}
            zoom={{ scaleX: 1, scaleY: 1, xValue: 0, yValue: 0 }}
            highlightPerTapEnabled={false}
            highlightPerDragEnabled={false}
          />
        </View>
        <View style={styles.graphCard}>
          {generateGraphHeader(selectedDataPoints[1], fftEnabled)}
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
            maxVisibleValueCount={fftEnabled ? 500 : 50}
            dragDecelerationEnabled={true}
            dragDecelerationFrictionCoef={0.99}
            zoom={{ scaleX: 1, scaleY: 1, xValue: 0, yValue: 0 }}
            highlightPerTapEnabled={false}
            highlightPerDragEnabled={false}
          />
        </View>
      </ScrollView>
      <ModalUi
        visible={modalVisible}
        onClose={() => {
          setModalStatus("idle");
          setModalVisible(false);

          if (pendingAction === "collection") {
            resetStates();
            setUpTimer();
          } else if (pendingAction === "disconnect") {
            disconnectDevice();
          } else {
            // after a direct save
            resetStates();
          }
          setPendingAction(null);
        }}
        onContinue={() => {
          setModalStatus("idle");
          setModalVisible(false);

          if (pendingAction === "collection") {
            resetStates();
            setUpTimer();
          } else if (pendingAction === "disconnect") {
            disconnectDevice();
          }
          setPendingAction(null);
        }}
        onSave={() => {
          if (!modalVisible) {
            setModalVisible(modalVisible);
          }
          saveCsvFile();
        }}
        onNavigate={() => {
          setModalVisible(false);
          setModalStatus("idle");

          navigation.navigate("DFUTab", {
            screen: "DFU",
          });
        }}
        status={modalStatus}
        doneMessage={doneMessage}
      />
      <PermissionModalUi
        visible={showModal}
        bleState={bluetoothState}
        locationState={locationState}
        onClose={() => setShowModal(false)}
        onOpenSettings={() => handleOpenSettings()}
      />
      <PPGWarningModal
        visible={showPPGWarning}
        onAccept={handlePPGWarningAccept}
        onCancel={handlePPGWarningCancel}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.lightGray,
    paddingVertical: px(16),
    paddingHorizontal: px(24),
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
  graphCardHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: px(8),
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
  statCardContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: px(16),
    marginTop: px(6),
  },
});

export default DashboardScreen;
