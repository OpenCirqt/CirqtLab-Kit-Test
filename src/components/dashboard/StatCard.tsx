import { Colors } from "@/src/theme";
import { px } from "@/src/utils/setSize";
import React from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import TextUi from "../common/TextUi";

interface StatCardProps {
  title: string;
  value: number | null | undefined;
  unit: string;
  style?: ViewStyle;
  decimal?: number;
  timeConversion?: boolean;
}

interface TimePart {
  value: string | number;
  unit: string;
}

/**
 * Converts a time value in seconds/minutes/hours into an array of parts.
 * - Handles decimals when < 60s
 * - Skips smaller units based on the given input unit
 * @param value - stat value
 * @param unit - time unit, "s" | "m" | "h"
 * @returns a list of TimePart (e.g. 1m, 2h)
 */
export function formatTimeParts(value?: number, unit = "s"): TimePart[] {
  if (value === undefined || !Number.isFinite(value)) return [];

  // normalize to seconds
  let totalSeconds = 0;
  switch (unit) {
    case "h":
      totalSeconds = value * 3600;
      break;
    case "m":
      totalSeconds = value * 60;
      break;
    default:
      totalSeconds = value;
  }

  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60; // can have decimals

  const parts: TimePart[] = [];

  if (unit === "h") {
    parts.push({ value: h, unit: "h" });
    if (m > 0) parts.push({ value: m, unit: "m" });
  } else if (unit === "m") {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    parts.push({ value: minutes, unit: "m" });
    if (seconds >= 1) parts.push({ value: seconds.toFixed(2), unit: "s" });
  } else {
    // unit === "s"
    if (totalSeconds < 60) {
      parts.push({ value: totalSeconds.toFixed(2), unit: "s" });
    } else {
      if (h > 0) parts.push({ value: h, unit: "h" });
      if (m > 0) parts.push({ value: m, unit: "m" });
      const sInt = Math.floor(s);
      if (sInt > 0 || parts.length === 0)
        parts.push({ value: sInt, unit: "s" });
    }
  }

  return parts;
}

const generateStatCardDisplay = (
  value?: number | null,
  decimal?: number,
  unit?: string,
  timeConversion?: boolean
) => {
  let content: React.ReactNode;

  if (timeConversion) {
    const statValue = typeof value === "number" ? value : undefined;
    const parts = formatTimeParts(statValue, unit ?? "s");
    content = parts.length ? (
      parts.map(({ value, unit }, i) => (
        <React.Fragment key={i}>
          <TextUi tag="h3" weight="bold">
            {value}
          </TextUi>
          <TextUi tag="h5" weight="medium">
            {unit}
          </TextUi>
        </React.Fragment>
      ))
    ) : (
      <>
        <TextUi tag="h3" weight="bold">
          -
        </TextUi>
        <TextUi tag="h5" weight="medium">
          {unit}
        </TextUi>
      </>
    );
  } else {
    const valueDisplay =
      typeof value === "number" ? value.toFixed(decimal ?? 0) : "-";
    content = (
      <>
        <TextUi tag="h3" weight="bold">
          {valueDisplay}
        </TextUi>
        <TextUi tag="h5" weight="medium">
          {unit}
        </TextUi>
      </>
    );
  }

  return <View style={styles.statValueContainer}>{content}</View>;
};

const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  unit,
  style,
  decimal,
  timeConversion,
}) => {
  return (
    <View style={[style, styles.statCardContainer]}>
      <TextUi tag="h6" weight="medium" style={styles.statHeader}>
        {title}
      </TextUi>
      {generateStatCardDisplay(value, decimal, unit, timeConversion)}
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
