import Ionicons from "@expo/vector-icons/Ionicons";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Peripheral } from "react-native-ble-manager";
import { BatteryPowerState, DeviceInformation } from "../../features/ble/bleSlice";
import { Colors } from "../../theme";
import { fs, px } from "../../utils/setSize";
import TextUi from "../common/TextUi";

interface DeviceCardProps {
  peripheral: Peripheral;
  loading?: boolean;
  connected?: boolean;
  batteryLevel?: number | null;
  batteryPowerState?: BatteryPowerState | null;
  deviceInformation?: DeviceInformation | null;
  onPress?: () => void;
}

const DeviceCard: React.FC<DeviceCardProps> = ({
  peripheral,
  loading,
  connected,
  batteryLevel,
  batteryPowerState,
  deviceInformation,
  onPress,
}) => {
  // Determine battery icon based on level and power state
  const getBatteryIcon = () => {
    if (batteryPowerState?.charging) {
      return "battery-charging";
    }
    if (!batteryLevel) return "battery-charging";
    if (batteryLevel > 75) return "battery-full";
    if (batteryLevel > 50) return "battery-half";
    if (batteryLevel > 25) return "battery-half";
    return "battery-dead";
  };

  const getBatteryColor = () => {
    if (batteryPowerState?.charging) return Colors.systemBlue;
    if (!batteryLevel) return Colors.infoTitleText;
    if (batteryLevel > 20) return Colors.secondary;
    return Colors.red;
  };
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        connected && styles.cardConnected,
        pressed && styles.cardOpaque,
      ]}
      disabled={loading} // disable press when loading
    >
      {/* Battery indicator in top right corner */}
      {connected && batteryLevel !== null && batteryLevel !== undefined && (
        <View style={styles.batteryCorner}>
          <Ionicons
            name={getBatteryIcon()}
            size={20}
            color={getBatteryColor()}
          />
          <TextUi style={styles.batteryPercentage} tag="h6">
            {batteryLevel}%
          </TextUi>
        </View>
      )}

      <Ionicons
        name="hardware-chip-outline"
        size={30}
        color={Colors.black}
        style={styles.iconLeft}
      />

      <View style={styles.labelGroup}>
        <TextUi weight="medium" tag="h4">
          {peripheral.name ?? ""}
        </TextUi>
        <TextUi style={styles.description} tag="h5">
          id: {peripheral.id}
        </TextUi>

        {/* Device Information - Firmware, Hardware, Software Revisions */}
        {connected && deviceInformation && (
          <View style={styles.infoRow}>
            {deviceInformation.firmwareRevision && (
              <>
                <Ionicons
                  name="build-outline"
                  size={14}
                  color={Colors.infoTitleText}
                />
                <TextUi style={styles.description} tag="h5">
                  FW: {deviceInformation.firmwareRevision}
                </TextUi>
              </>
            )}
            {deviceInformation.hardwareRevision && (
              <>
                <Ionicons
                  name="hardware-chip-outline"
                  size={14}
                  color={Colors.infoTitleText}
                  style={styles.infoIconSpacing}
                />
                <TextUi style={styles.description} tag="h5">
                  HW: {deviceInformation.hardwareRevision}
                </TextUi>
              </>
            )}
            {deviceInformation.softwareRevision && (
              <>
                <Ionicons
                  name="code-slash-outline"
                  size={14}
                  color={Colors.infoTitleText}
                  style={styles.infoIconSpacing}
                />
                <TextUi style={styles.description} tag="h5">
                  SW: {deviceInformation.softwareRevision}
                </TextUi>
              </>
            )}
          </View>
        )}

        <TextUi style={styles.description} tag="h5">
          RSSI: {peripheral.rssi}
        </TextUi>
      </View>

      {loading ? (
        <ActivityIndicator
          size="small"
          color={Colors.black}
          style={styles.iconRight}
        />
      ) : connected ? (
        <Ionicons
          name="checkmark"
          size={28}
          color={Colors.secondary}
          style={styles.iconRight}
        />
      ) : (
        <View style={styles.iconRight} /> // empty space to keep layout
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: px(12),
    paddingHorizontal: px(24),
    paddingVertical: px(18),
    borderWidth: px(2),
    borderColor: Colors.white,
    borderRadius: px(12),
    marginVertical: px(6),
    backgroundColor: Colors.white,
    position: "relative",
  },
  cardConnected: {
    borderColor: Colors.primary,
  },
  batteryCorner: {
    position: "absolute",
    top: px(8),
    right: px(8),
    flexDirection: "row",
    alignItems: "center",
    gap: px(4),
    backgroundColor: Colors.lightGray,
    paddingHorizontal: px(8),
    paddingVertical: px(4),
    borderRadius: px(8),
  },
  batteryPercentage: {
    color: Colors.text,
    fontSize: fs(10),
    fontWeight: "600",
  },
  iconLeft: {
    marginRight: fs(12),
  },
  iconRight: {
    flexShrink: 0,
    width: px(40),
  },
  labelGroup: {
    flexShrink: 1,
    flex: 1,
  },
  description: {
    color: Colors.infoTitleText
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: px(4),
    marginTop: px(2),
  },
  infoIcon: {
    marginRight: px(2),
  },
  infoIconSpacing: {
    marginLeft: px(8),
  },
  cardOpaque: {
    opacity: 0.6,
  },
});

export default DeviceCard;
