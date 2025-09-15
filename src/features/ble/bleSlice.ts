// redux/bleSlice.ts
import { DataTypes } from "@/src/utils/constants";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { Peripheral } from "react-native-ble-manager";

export interface BleState {
  peripheral: Peripheral | null;
  selectedDataPoints: DataTypes[];
  autoReconnect: boolean;
  collecting: boolean;
  uploading: boolean;
}

export const initialState: BleState = {
  peripheral: null,
  selectedDataPoints: [DataTypes.ACC, DataTypes.PPG_RED],
  autoReconnect: false,
  collecting: false,
  uploading: false,
};

export const bleSlice = createSlice({
  name: "ble",
  initialState,
  reducers: {
    setPeripheral(state, action: PayloadAction<Peripheral | null>) {
      state.peripheral = action.payload;
    },
    clearPeripheral(state) {
      state.peripheral = null;
    },
    setSelectedDataPoints(state, action: PayloadAction<DataTypes>) {
      const dataPoint = action.payload;

      if (state.selectedDataPoints.includes(dataPoint)) return;

      state.selectedDataPoints = [...state.selectedDataPoints, dataPoint].slice(
        -2
      );
    },
    clearSelectedDataPoints(state) {
      state.selectedDataPoints = [];
    },
    setAutoConnect(state, action: PayloadAction<boolean>) {
      state.autoReconnect = action.payload;
    },
    setDefaultDataPointsSelection(state) {
      state.selectedDataPoints = [DataTypes.ACC, DataTypes.PPG_RED];
    },
    setCollecting(state, action: PayloadAction<boolean>) {
      state.collecting = action.payload;
    },
    setUploading(state, action: PayloadAction<boolean>) {
      state.uploading = action.payload;
    },
  },
});

export const {
  setPeripheral,
  clearPeripheral,
  setAutoConnect,
  setSelectedDataPoints,
  setDefaultDataPointsSelection,
  setCollecting,
  setUploading,
} = bleSlice.actions;
export default bleSlice.reducer;
