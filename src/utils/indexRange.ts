import { DataTypes } from "./constants";

export const SensorParameter: Record<DataTypes, number[]> = {
  [DataTypes.ACC]: [4, 5, 6],
  [DataTypes.GYRO]: [7, 8, 9],
  [DataTypes.MAG]: [10, 11, 12],
  [DataTypes.PPG_RED]: [1],
  [DataTypes.PPG_IR]: [2],
  [DataTypes.PPG_GREEN]: [3],
};

export const DataColor = ["red", "blue", "green"];

export const MaxBufferSize = 2 * 1024 * 1024 * 1024; // 512MB
