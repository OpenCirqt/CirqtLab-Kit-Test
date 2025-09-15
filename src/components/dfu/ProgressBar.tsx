import { Colors } from "@/src/theme";
import { fs, px } from "@/src/utils/setSize";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

interface PorgressBarProps {
  progress: number;
}

const ProgressBar: React.FC<PorgressBarProps> = ({ progress }) => {
  return (
    <View style={styles.container}>
      <View style={styles.progressBarBackground}>
        <View
          style={[
            styles.progressBarFill,
            {
              width: `${progress}%`,
            },
          ]}
        />
      </View>
      <Text
        style={[
          styles.progressText,
          {
            right: `${100 - progress - 5}%`,
          },
        ]}
      >
        {progress}%
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: px(36),
    marginHorizontal: px(16),
  },
  progressBarBackground: {
    height: px(20),
    backgroundColor: Colors.white,
    borderRadius: fs(10),
    overflow: "hidden",
    justifyContent: "center",
  },
  progressBarFill: {
    ...StyleSheet.absoluteFillObject,
    height: "100%",
    backgroundColor: Colors.primary,
  },
  progressText: {
    position: "absolute",
    color: Colors.primary,
    fontWeight: "bold",
    top: px(-28),
    fontSize: fs(15),
  },
});

export default ProgressBar;
