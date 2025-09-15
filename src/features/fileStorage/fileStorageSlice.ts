// redux/fileStorageSlice.ts
import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface FileStorageState {
  filePrefix: string;
  isTextInputModalOpen: boolean;
}

const initialState: FileStorageState = {
  filePrefix: "",
  isTextInputModalOpen: false,
};

export const fileStorageSlice = createSlice({
  name: "fileStorage",
  initialState,
  reducers: {
    setFilePrefix(state, action: PayloadAction<string>) {
      state.filePrefix = action.payload;
    },
    clearFilePrefix(state) {
      state.filePrefix = "";
    },
    setTextInputModalOpen(state, action: PayloadAction<boolean>) {
      state.isTextInputModalOpen = action.payload;
    },
  },
});

export const { setFilePrefix, clearFilePrefix, setTextInputModalOpen } =
  fileStorageSlice.actions;
export default fileStorageSlice.reducer;
