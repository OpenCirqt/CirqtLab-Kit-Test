import Ionicons from "@expo/vector-icons/Ionicons";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Peripheral } from "react-native-ble-manager";
import { Colors } from "../../theme";
import { fs, px } from "../../utils/setSize";
import TextUi from "../common/TextUi";

interface DeviceCardProps {
  peripheral: Peripheral;
  loading?: boolean;
  connected?: boolean;
  onPress?: () => void;
}

const DeviceCard: React.FC<DeviceCardProps> = ({
  peripheral,
  loading,
  connected,
  onPress,
}) => {
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
  },
  cardConnected: {
    borderColor: Colors.primary,
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
  cardOpaque: {
    opacity: 0.6,
  },
});

export default DeviceCard;
