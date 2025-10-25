import { Colors } from "@/src/theme";
import { px } from "@/src/utils/setSize";
import React from "react";
import { StyleSheet, Text, View, ViewStyle } from "react-native";

interface NumberCircleProps {
  number: number;
  size?: number;
  color?: string;
  style?: ViewStyle;
}

const NumberCircle: React.FC<NumberCircleProps> = ({
  number,
  size = px(54),
  color = Colors.primary,
  style,
}) => {
  return (
    <View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: color,
        },
        style,
      ]}
    >
      <Text
        style={[
          styles.number,
          {
            color,
            fontSize: size / 2,
          },
        ]}
      >
        {number}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  circle: {
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.white,
    borderWidth: px(2),
  },
  number: {
    fontWeight: "bold",
  },
});

export default NumberCircle;
