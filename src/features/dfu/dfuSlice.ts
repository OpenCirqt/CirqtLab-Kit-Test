// store/dfuSlice.js
import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface DfuState {
  prnEnabled: boolean;
  numOfPackets: number;
  disableResume: boolean;
  forceScanningLegacyDfu: boolean;
}

const initialState: DfuState = {
  prnEnabled: true,
  numOfPackets: 3,
  disableResume: true,
  forceScanningLegacyDfu: true,
};

const dfuSlice = createSlice({
  name: "dfu",
  initialState,
  reducers: {
    setPrnEnabled: (state, action: PayloadAction<boolean>) => {
      state.prnEnabled = action.payload;
    },
    setNumOfPackets: (state, action: PayloadAction<number>) => {
      state.numOfPackets = action.payload;
    },
    setDisableResume: (state, action: PayloadAction<boolean>) => {
      state.disableResume = action.payload;
    },
    setForceScanningLegacyDfu: (state, action: PayloadAction<boolean>) => {
      state.forceScanningLegacyDfu = action.payload;
    },
  },
});

export const {
  setPrnEnabled,
  setNumOfPackets,
  setDisableResume,
  setForceScanningLegacyDfu,
} = dfuSlice.actions;
export default dfuSlice.reducer;
