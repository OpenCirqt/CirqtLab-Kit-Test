import { DataTypes } from "./constants";

export const SensorParameter: Record<DataTypes, number[]> = {
  [DataTypes.ACC]: [3, 4, 5],
  [DataTypes.GYRO]: [6, 7, 8],
  [DataTypes.MAG]: [9, 10, 11],
  [DataTypes.PPG_RED]: [0],
  [DataTypes.PPG_IR]: [1],
  [DataTypes.PPG_GREEN]: [2],
};

export const DataColor = ["red", "blue", "green"];

export const MaxBufferSize = 2 * 1024 * 1024 * 1024; // 512MB
