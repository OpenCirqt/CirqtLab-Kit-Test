import { Colors } from "@/src/theme";
import { px } from "@/src/utils/setSize";
import React from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import TextUi from "../common/TextUi";

interface StatCardProps {
  title: string;
  value: number;
  unit: string;
  style?: ViewStyle;
  decimal?: number;
}

const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  unit,
  style,
  decimal,
}) => {
  return (
    <View style={[style, styles.statCardContainer]}>
      <TextUi tag="h6" weight="medium" style={styles.statHeader}>
        {title}
      </TextUi>
      <View style={styles.statValueContainer}>
        <TextUi tag="h2" weight="medium">
          {decimal ? value.toFixed(decimal) : value}
        </TextUi>
        <TextUi tag="h4" weight="medium">
          {unit}
        </TextUi>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  statCardContainer: {
    borderRadius: px(8),
    backgroundColor: Colors.warmGray,
    padding: px(8),
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: px(4),
    elevation: px(2), // for Android
  },
  statHeader: {
    color: Colors.infoTitleText,
  },
  statValueContainer: {
    flexDirection: "row",
    gap: px(4),
    alignItems: "baseline",
  },
});

export default StatCard;
