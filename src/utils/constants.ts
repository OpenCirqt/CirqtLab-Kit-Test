export const SERVER_URL = "http://127.0.0.1:8080";

export enum DataTypes {
  ACC = "acc",
  GYRO = "gyro",
  MAG = "mag",
  PPG_RED = "ppg:red",
  PPG_IR = "ppg:ir",
  PPG_GREEN = "ppg:green",
}

export const dataTypesList = [
  DataTypes.ACC,
  DataTypes.GYRO,
  DataTypes.MAG,
  DataTypes.PPG_RED,
  DataTypes.PPG_IR,
  DataTypes.PPG_GREEN,
];

export type Status =
  | "idle"
  | "unsaved"
  | "saving"
  | "done"
  | "undeleted"
  | "deleting"
  | "collecting"
  | "uploading"
  | "loading";
