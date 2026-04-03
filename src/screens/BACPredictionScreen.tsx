import { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import {
  CompositeNavigationProp,
  useIsFocused,
  useNavigation,
} from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import axios, { isAxiosError } from "axios";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path, Text as SvgText } from "react-native-svg";
import ButtonUi from "../components/common/ButtonUi";
import ModalUi from "../components/common/ModalUi";
import TextUi from "../components/common/TextUi";
import { setBacCollecting } from "../features/ble/bleSlice";
import { useBleLiveStream } from "../hooks/useBleLiveStream";
import { PPGSample } from "../hooks/usePPGAnalyzer";
import { usePPGStream } from "../hooks/usePPGStream";
import { BACRootStackParamList } from "../navigations/BACNavigator";
import { RootTabParamList } from "../navigations/TabNavigator";
import { useAppDispatch, useAppSelector } from "../store";
import { Colors } from "../theme";
import { DataTypes, Status } from "../utils/constants";
import { SensorParameter } from "../utils/indexRange";
import { fs, px } from "../utils/setSize";

const FONT = "Inter_500Medium";
const FONT_BOLD = "Inter_500Bold";

type BACPredictionScreenProp = NativeStackNavigationProp<
  BACRootStackParamList,
  "BAC"
>;

type BACPredictionScreenNavigationProp = CompositeNavigationProp<
  BACPredictionScreenProp,
  BottomTabNavigationProp<RootTabParamList>
>;

// ─── Constants ────────────────────────────────────────────────────────────────
const COLLECT_SECS = 10;
const RING_FILL_PCT = 0.8; // ring diameter = 80% of container width
const RING_STROKE = 12;

const GAUGE_FILL_PCT = 0.8; // arc width = 80% of container width
const GAUGE_STROKE = 20;
const G_START = Math.PI;
const G_END = 2 * Math.PI;

// ─── Types ────────────────────────────────────────────────────────────────────
type Screen = "gauge" | "countdown" | "idle" | "loading";

interface Point {
  x: number;
  y: number;
}

interface BACResult {
  drinking: 0 | 1;
  probability: number;
  threshold: number;
}

const instance = axios.create({
  baseURL: "http://47.83.239.31:8000",
  timeout: 5000, // 5 second timeout
});

interface CountdownViewProps {
  onComplete: () => void;
}

interface GaugeViewProps {
  hasResult: boolean;
  connectedDeviceId: string | undefined;
  isDrunk: boolean;
  probability: number;
  onRetest: () => void;
  errorMessage?: string;
}

// ─── Gauge math (dynamic — pass cx/cy/r derived from measured width) ──────────
function gaugePt(angle: number, cx: number, cy: number, r: number): Point {
  return {
    x: cx + r * Math.cos(angle),
    y: cy + r * Math.sin(angle),
  };
}

function gaugeArc(
  from: number,
  to: number,
  cx: number,
  cy: number,
  r: number,
): string {
  if (Math.abs(to - from) < 0.001) to = from + 0.001;
  const s = gaugePt(from, cx, cy, r);
  const e = gaugePt(to, cx, cy, r);
  const large = to - from > Math.PI ? 1 : 0;
  return `M${s.x.toFixed(3)},${s.y.toFixed(3)} A${r},${r} 0 ${large} 1 ${e.x.toFixed(3)},${e.y.toFixed(3)}`;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// ─── fetch prediction ──────────
async function fetchBACPrediction(samples: number[]): Promise<BACResult> {
  const { data } = await instance.post<BACResult>("/predict", {
    ppg: samples,
    sampling_rate_hz: samples.length / COLLECT_SECS,
  });
  return {
    drinking: data.drinking,
    probability: data.probability,
    threshold: data.threshold,
  };
}

function CountdownView({ onComplete }: CountdownViewProps): React.JSX.Element {
  const [secsLeft, setSecsLeft] = useState<number>(COLLECT_SECS);
  const [ringOffset, setRingOffset] = useState<number>(0);
  const [size, setSize] = useState<number>(0); // measured container width
  const startTsRef = useRef<number>(Date.now());
  const doneRef = useRef<boolean>(false);

  // Bounce scale for the countdown number — punches up on each new second
  const bounceScale = useRef(new Animated.Value(1)).current;

  // Derived ring geometry — recalculated whenever the container is measured
  const ringSize = size * RING_FILL_PCT; // SVG canvas size
  const cx = ringSize / 2;
  const cy = ringSize / 2;
  const r = (ringSize - RING_STROKE * 2) / 2; // inset so stroke doesn't clip
  const circumf = 2 * Math.PI * r;

  useEffect(() => {
    startTsRef.current = Date.now();
    doneRef.current = false;

    const tick = setInterval(() => {
      const elapsed = (Date.now() - startTsRef.current) / 1000;
      const frac = Math.min(elapsed / COLLECT_SECS, 1);

      setSecsLeft(Math.max(0, Math.ceil(COLLECT_SECS - elapsed)));
      setRingOffset(circumf * frac);

      if (frac >= 1 && !doneRef.current) {
        doneRef.current = true;
        clearInterval(tick);
        onComplete();
      }
    }, 50);

    return () => clearInterval(tick);
  }, [onComplete, circumf]);

  // Bounce the number each time secsLeft ticks down
  useEffect(() => {
    Animated.sequence([
      Animated.spring(bounceScale, {
        toValue: 1.25,
        useNativeDriver: true,
        speed: 40,
        bounciness: 18,
      }),
      Animated.spring(bounceScale, {
        toValue: 1,
        useNativeDriver: true,
        speed: 20,
        bounciness: 10,
      }),
    ]).start();
  }, [bounceScale, secsLeft]);

  return (
    <View
      style={styles.centeredView}
      onLayout={(e) => setSize(e.nativeEvent.layout.width)}
    >
      <TextUi tag="h4" style={styles.collectLabel}>
        Collecting samples
      </TextUi>

      {size > 0 && (
        <View
          style={{
            width: ringSize,
            height: ringSize,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Svg width={ringSize} height={ringSize}>
            {/* Track ring */}
            <Circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke="#D6D4CF"
              strokeWidth={RING_STROKE}
            />
            {/* Progress ring — drains clockwise from top */}
            <Circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={Colors.primary}
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={circumf}
              strokeDashoffset={ringOffset}
              transform={`rotate(-90, ${cx}, ${cy})`}
            />
            <SvgText
              fontFamily={FONT}
              x={cx}
              y={cy + ringSize * 0.2}
              textAnchor="middle"
              fontSize={ringSize * 0.05}
              fill={Colors.infoTitleText}
            >
              seconds
            </SvgText>
          </Svg>
          {/* Countdown number overlaid with Animated.View for bounce */}
          <Animated.View
            style={{
              position: "absolute",
              alignItems: "center",
              justifyContent: "center",
              transform: [{ scale: bounceScale }],
            }}
          >
            <Text
              style={{
                fontFamily: FONT,
                fontSize: ringSize * 0.28,
                fontWeight: "600",
                color: Colors.text,
                lineHeight: ringSize * 0.32,
              }}
            >
              {secsLeft}
            </Text>
          </Animated.View>
        </View>
      )}
    </View>
  );
}

function GaugeView({
  hasResult,
  connectedDeviceId,
  isDrunk,
  probability,
  onRetest,
  errorMessage,
}: GaugeViewProps): React.JSX.Element {
  const [needleAngle, setNeedleAngle] = useState<number>(G_START);
  const [animatedProb, setAnimatedProb] = useState<number>(0);
  const [width, setWidth] = useState<number>(0);
  const angleRef = useRef<number>(G_START);
  const rafRef = useRef<number | null>(null);

  // Derived geometry — updates whenever container width is measured
  const svgW = width * GAUGE_FILL_PCT;
  const svgH = svgW * 0.65;
  const pad = svgW * 0.014; // extra room so stroke caps never clip
  const r = svgW / 2 - GAUGE_STROKE - pad;
  const cx = svgW / 2;
  const cy = svgH - GAUGE_STROKE / 2 - pad / 2;

  const targetAngle = isDrunk
    ? G_START + (G_END - G_START) * probability
    : G_START;

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      const from = angleRef.current;
      const duration = 1200;
      const startTs = performance.now();

      function step(now: number): void {
        const t = Math.min((now - startTs) / duration, 1);
        const next = from + (targetAngle - from) * easeInOut(t);
        angleRef.current = next;
        setNeedleAngle(next);

        // Derive animated probability directly from the current angle
        const currentProb = (next - G_START) / (G_END - G_START);
        setAnimatedProb(Math.max(0, currentProb));

        if (t < 1) {
          rafRef.current = requestAnimationFrame(step);
        } else {
          rafRef.current = null;
        }
      }

      rafRef.current = requestAnimationFrame(step);
    }, 300);

    return () => {
      clearTimeout(timeout);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [targetAngle]);

  const needlePos = gaugePt(needleAngle, cx, cy, r);
  const trackPath = width > 0 ? gaugeArc(G_START, G_END, cx, cy, r) : "";
  const fillD =
    width > 0 && needleAngle > G_START + 0.005
      ? gaugeArc(G_START, needleAngle, cx, cy, r)
      : null;

  const pctLabel =
    hasResult && isDrunk ? `${Math.round(animatedProb * 100)}%` : "—";
  const arcColor = isDrunk ? Colors.red : Colors.primary;
  const pctColor = isDrunk ? Colors.red : Colors.text;
  const labelColor = isDrunk ? Colors.red : Colors.primary;
  const mainColor = isDrunk ? Colors.red : Colors.text;

  // Scale-relative sizes
  const tickFontSize = svgW * 0.04;
  const pctFontSize = svgW * 0.18;
  const lblFontSize = svgW * 0.05;
  const needleR = svgW * 0.0325;

  // Tick label positions
  const leftTick = gaugePt(G_START, cx, cy, r + GAUGE_STROKE * 0.8);
  const rightTick = gaugePt(G_END, cx, cy, r + GAUGE_STROKE * 0.8);
  const topTick = gaugePt(
    (G_START + G_END) / 2,
    cx,
    cy,
    r + GAUGE_STROKE * 0.8,
  );

  return (
    <View
      style={styles.centeredView}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {width > 0 && (
        <Svg width={svgW} height={svgH}>
          <Path
            d={trackPath}
            fill="none"
            stroke="#D6D4CF"
            strokeWidth={GAUGE_STROKE}
            strokeLinecap="round"
          />
          {fillD !== null && (
            <Path
              d={fillD}
              fill="none"
              stroke={arcColor}
              strokeWidth={GAUGE_STROKE}
              strokeLinecap="round"
            />
          )}
          {/* Range tick labels */}
          <SvgText
            fontFamily={FONT}
            x={leftTick.x + svgW * 0.14}
            y={leftTick.y + tickFontSize - svgH * 0.02}
            fill={Colors.disabled}
            fontSize={tickFontSize}
            textAnchor="middle"
          >
            0%
          </SvgText>
          <SvgText
            fontFamily={FONT}
            x={rightTick.x - svgW * 0.15}
            y={rightTick.y + tickFontSize - svgH * 0.02}
            fill={Colors.disabled}
            fontSize={tickFontSize}
            textAnchor="middle"
          >
            100%
          </SvgText>
          <SvgText
            fontFamily={FONT}
            x={topTick.x}
            y={topTick.y - tickFontSize * 0.4}
            fill={Colors.disabled}
            fontSize={tickFontSize}
            textAnchor="middle"
          >
            50%
          </SvgText>
          {/* Needle */}
          <Circle
            cx={needlePos.x}
            cy={needlePos.y}
            r={needleR}
            stroke={arcColor}
            strokeWidth={needleR * 0.16}
            fill={Colors.white}
          />
          {/* Center readout */}
          <SvgText
            fontFamily={FONT}
            x={cx}
            y={cy - svgH * 0.15}
            fill={pctColor}
            fontSize={pctFontSize}
            fontWeight="600"
            textAnchor="middle"
            alignmentBaseline="middle"
          >
            {pctLabel}
          </SvgText>
          <SvgText
            fontFamily={FONT}
            x={cx}
            y={cy - svgH * 0.08 + pctFontSize * 0.4}
            fill={Colors.infoTitleText}
            fontSize={lblFontSize}
            textAnchor="middle"
          >
            probability
          </SvgText>
        </Svg>
      )}

      <TextUi tag="h3" style={[styles.statusLabel, { color: labelColor }]}>
        {isDrunk ? "Alert" : "Status"}
      </TextUi>
      <TextUi
        tag="h1"
        weight="bold"
        style={[styles.statusMain, { color: mainColor }]}
      >
        {hasResult
          ? isDrunk
            ? "Alcohol detected"
            : "No alcohol detected"
          : "N/A"}
      </TextUi>
      <TextUi tag="h4" style={styles.statusSub}>
        {hasResult
          ? isDrunk
            ? "Subject likely intoxicated"
            : "Prediction confidence: high"
          : ""}
      </TextUi>

      <ButtonUi
        type={connectedDeviceId ? "primary" : "disabled"}
        size="large"
        onPress={onRetest}
        style={styles.predictionBtn}
      >
        Run New Prediction
      </ButtonUi>
      {!connectedDeviceId && (
        <TextUi tag="h4" style={styles.statusSub}>
          Please Go to Dashboard to Connect a BLE Device.
        </TextUi>
      )}
      {errorMessage && (
        <TextUi tag="h4" style={styles.statusError}>
          {errorMessage}
        </TextUi>
      )}
    </View>
  );
}

function LoadingView(): React.JSX.Element {
  return (
    <View style={styles.centeredView}>
      <TextUi tag="h2" style={styles.loadingText}>
        Loading Prediction...
      </TextUi>
    </View>
  );
}

const BACPredictionScreen = () => {
  const connectedDevice = useAppSelector((state) => state.ble.peripheral);
  const bacCollecting = useAppSelector((state) => state.ble.bacCollecting);
  const uploading = useAppSelector((state) => state.ble.uploading);

  const [isDrunk, setIsDrunk] = useState<boolean>(false);
  const [prob, setProb] = useState<number>(0);

  const cachedGreenData = useRef<number[]>([]);

  const dispatch = useAppDispatch();

  const [screen, setScreen] = useState<Screen>("idle");

  const navigation = useNavigation<BACPredictionScreenNavigationProp>();
  const isFocused = useIsFocused();
  const [modalVisible, setModalVisible] = useState(false);
  const [modalStatus, setModalStatus] = useState<Status>("idle");

  const [errMsg, setErrMsg] = useState("");

  const { addRawPacket, resetStream } = usePPGStream({
    spikeRatioThreshold: 3.0, // >3× the reference median  → spike
    spikeAbsoluteThreshold: 500, // AND >500 ADC units off     → spike
    referenceWindowSize: 12, // last 12 accepted samples   (~480 ms @ 25 Hz)
    maxConsecutiveSpikes: 8, // 8 straight rejections      → reset reference
    replacementStrategy: "hold",

    onCleanSample: useCallback((sample: PPGSample) => {
      // → FFT analyzer
      // console.log(sample);
    }, []),

    onSpike: useCallback(() => {}, []),
  });

  useBleLiveStream(connectedDevice?.id, bacCollecting, (data) => {
    if (!bacCollecting) return;

    const ir = data[SensorParameter[DataTypes.PPG_IR][0]];
    const red = data[SensorParameter[DataTypes.PPG_RED][0]];
    const green = data[SensorParameter[DataTypes.PPG_GREEN][0]];
    const timestamp = data[data.length - 1];
    const rawPPG = [ir, red, green, timestamp];
    const clean = addRawPacket(rawPPG);
    if (clean) {
      cachedGreenData.current.push(clean.green ?? 0);
    } else {
      cachedGreenData.current.push(green);
    }
  });

  useEffect(() => {
    if (isFocused && uploading) {
      setModalVisible(true);
      setModalStatus("uploading");
    } else {
      setModalVisible(false);
      setModalStatus("idle");
    }
  }, [uploading, isFocused]);

  const handleStartCollection = () => {
    dispatch(setBacCollecting(true));
    setScreen("countdown");
    setErrMsg("");
  };

  const handleStopCollection = async () => {
    dispatch(setBacCollecting(false));
    resetStream();
    setScreen("loading");

    try {
      const result = await fetchBACPrediction(cachedGreenData.current);
      setIsDrunk(result.drinking === 1);
      setProb(result.probability ?? 0);
      setScreen("gauge");
    } catch (error) {
      console.error("Prediction failed:", error);
      setScreen("idle");
      setIsDrunk(false);
      setProb(0);

      if (isAxiosError(error)) {
        let errStr = "";
        if (error.code === "ECONNABORTED") {
          errStr = "Request timed out. Please try again at a later time.";
        } else if (error.response) {
          errStr = `Server error: ${error.response.status}`;
        } else {
          errStr = `${error.message}. Please try again at a later time.`;
        }
        setErrMsg(errStr);
      }
    } finally {
      cachedGreenData.current = [];
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={styles.container}
        contentContainerStyle={styles.contentContainerStyle}
      >
        {(screen === "gauge" || screen === "idle") && (
          <GaugeView
            hasResult={screen !== "idle"}
            connectedDeviceId={connectedDevice?.id}
            isDrunk={isDrunk}
            probability={prob}
            onRetest={() => handleStartCollection()}
            errorMessage={errMsg}
          />
        )}
        {screen === "countdown" && (
          <CountdownView onComplete={handleStopCollection} />
        )}
        {screen === "loading" && <LoadingView />}
      </ScrollView>
      <ModalUi
        visible={modalVisible}
        status={modalStatus}
        onNavigate={() => {
          setModalVisible(false);
          setModalStatus("idle");

          navigation.navigate("DFUTab", {
            screen: "DFU",
          });
        }}
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
  centeredView: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  collectLabel: {
    fontFamily: FONT,
    color: Colors.infoTitleText,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginVertical: px(20),
  },
  statusLabel: {
    fontWeight: "500",
    fontFamily: FONT,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginTop: px(28),
  },
  statusMain: {
    fontFamily: FONT_BOLD,
    fontSize: fs(50),
    marginTop: 4,
    textAlign: "center",
  },
  statusSub: {
    fontFamily: FONT,
    color: Colors.infoTitleText,
    marginTop: 4,
    textAlign: "center",
  },
  statusError: {
    fontFamily: FONT,
    color: Colors.red,
    marginTop: 4,
    textAlign: "center",
  },
  loadingText: {
    color: Colors.infoTitleText,
    paddingTop: px(40),
  },
  predictionBtn: {
    width: "100%",
    marginTop: px(100),
  },
});

export default BACPredictionScreen;
