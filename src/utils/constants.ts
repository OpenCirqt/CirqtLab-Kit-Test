export const SERVER_URL = "http://127.0.0.1:8080";

export enum DataTypes {
  ACC = "acc",
  GYRO = "gyro",
  MAG = "mag",
  PPG_RED = "red",
  PPG_IR = "ir",
  PPG_GREEN = "green",
}

export const dataTypesList = [
  DataTypes.ACC,
  DataTypes.GYRO,
  DataTypes.MAG,
  DataTypes.PPG_RED,
  DataTypes.PPG_IR,
  DataTypes.PPG_GREEN,
];

export enum DataTypeCategory {
  IMU = "IMU",
  PPG = "PPG",
}

export const dataTypeToCategory: Record<DataTypes, DataTypeCategory> = {
  [DataTypes.ACC]: DataTypeCategory.IMU,
  [DataTypes.GYRO]: DataTypeCategory.IMU,
  [DataTypes.MAG]: DataTypeCategory.IMU,
  [DataTypes.PPG_RED]: DataTypeCategory.PPG,
  [DataTypes.PPG_IR]: DataTypeCategory.PPG,
  [DataTypes.PPG_GREEN]: DataTypeCategory.PPG,
};

export type Status =
  | "idle"
  | "unsaved"
  | "saving"
  | "done"
  | "undeleted"
  | "deleting"
  | "collecting"
  | "uploading"
  | "bacCollecting"
  | "loading"
  | "overflowing";
