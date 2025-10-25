import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import ButtonUi from "../components/common/ButtonUi";
import TextUi from "../components/common/TextUi";
import {
  setDefaultDataPointsSelection,
  setSelectedDataPoints,
} from "../features/ble/bleSlice";
import { useAppDispatch, useAppSelector } from "../store";
import { Colors } from "../theme";
import { DataTypes } from "../utils/constants";
import { px } from "../utils/setSize";

const DataPointsSelection = () => {
  const selectedDataPoints = useAppSelector(
    (state) => state.ble.selectedDataPoints
  );
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (selectedDataPoints.length === 0) {
      dispatch(setDefaultDataPointsSelection());
    }
  }, [dispatch, selectedDataPoints]);

  return (
    <View style={styles.dataSelectionContainer}>
      <View style={styles.dataSelectionSection}>
        <TextUi tag="h3" weight="bold" style={styles.sectionHeader}>
          IMU Sensor
        </TextUi>
        <View style={styles.imuContainer}>
          <ButtonUi
            type={
              selectedDataPoints.includes(DataTypes.ACC)
                ? "primary"
                : "secondary"
            }
            size="large"
            style={styles.dataPoint}
            onPress={() => dispatch(setSelectedDataPoints(DataTypes.ACC))}
          >
            Acc
          </ButtonUi>
          <ButtonUi
            type={
              selectedDataPoints.includes(DataTypes.GYRO)
                ? "primary"
                : "secondary"
            }
            size="large"
            style={styles.dataPoint}
            onPress={() => dispatch(setSelectedDataPoints(DataTypes.GYRO))}
          >
            Gyro
          </ButtonUi>
          <ButtonUi
            type={
              selectedDataPoints.includes(DataTypes.MAG)
                ? "primary"
                : "secondary"
            }
            size="large"
            style={styles.dataPoint}
            onPress={() => dispatch(setSelectedDataPoints(DataTypes.MAG))}
          >
            Mag
          </ButtonUi>
        </View>
      </View>
      <View style={styles.dataSelectionSection}>
        <TextUi tag="h3" weight="bold" style={styles.sectionHeader}>
          PPG Sensor
        </TextUi>
        <View style={styles.imuContainer}>
          <ButtonUi
            type={
              selectedDataPoints.includes(DataTypes.PPG_RED)
                ? "primary"
                : "secondary"
            }
            size="large"
            style={styles.dataPoint}
            onPress={() => dispatch(setSelectedDataPoints(DataTypes.PPG_RED))}
          >
            Red
          </ButtonUi>
          <ButtonUi
            type={
              selectedDataPoints.includes(DataTypes.PPG_IR)
                ? "primary"
                : "secondary"
            }
            size="large"
            style={styles.dataPoint}
            onPress={() => dispatch(setSelectedDataPoints(DataTypes.PPG_IR))}
          >
            IR
          </ButtonUi>
          <ButtonUi
            type={
              selectedDataPoints.includes(DataTypes.PPG_GREEN)
                ? "primary"
                : "secondary"
            }
            size="large"
            style={styles.dataPoint}
            onPress={() => dispatch(setSelectedDataPoints(DataTypes.PPG_GREEN))}
          >
            Green
          </ButtonUi>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  dataSelectionContainer: {
    flex: 1,
    backgroundColor: Colors.lightGray,
  },
  dataSelectionSection: {
    padding: px(20),
    margin: px(16),
    borderRadius: px(20),
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: px(4),
    elevation: px(2), // for Android
    backgroundColor: Colors.white,
  },
  sectionHeader: {
    paddingBottom: px(24),
  },
  imuContainer: {
    flexDirection: "row",
    gap: px(8),
  },
  dataPoint: {
    flex: 1,
  },
});

export default DataPointsSelection;
