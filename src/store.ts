import AsyncStorage from "@react-native-async-storage/async-storage";
import { combineReducers, configureStore } from "@reduxjs/toolkit";
import { TypedUseSelectorHook, useDispatch, useSelector } from "react-redux";
import {
  createTransform,
  persistReducer,
  persistStore,
  Transform,
} from "redux-persist";
import bleReducer, {
  initialState as bleInitialState,
  BleState,
} from "./features/ble/bleSlice";
import dfuReducer from "./features/dfu/dfuSlice";
import fileStorageReducer from "./features/fileStorage/fileStorageSlice";

const rootReducer = combineReducers({
  ble: bleReducer,
  dfu: dfuReducer,
  fileStorage: fileStorageReducer,
});

type RootReducerState = ReturnType<typeof rootReducer>;

type StoredBleState = Omit<BleState, "collecting" | "uploading">;

// Transform to remove "collecting" and "uploading" from bleSlice persistence
const bleTransform: Transform<
  BleState,
  StoredBleState,
  RootReducerState,
  "ble"
> = createTransform(
  // transform state being persisted
  (inboundState) => {
    const { collecting, uploading, ...rest } = inboundState;
    return rest;
  },
  // transform state being rehydrated
  (outboundState) => {
    if (!outboundState) return bleInitialState;
    return { ...outboundState, collecting: false, uploading: false }; // force reset on rehydrate
  },
  { whitelist: ["ble"] }
);

const persistConfig = {
  key: "root",
  storage: AsyncStorage,
  whitelist: ["ble", "dfu", "fileStorage"],
  transforms: [bleTransform],
};

const persistedReducer = persistReducer(persistConfig, rootReducer);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({ serializableCheck: false }),
});

export const persistor = persistStore(store);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
