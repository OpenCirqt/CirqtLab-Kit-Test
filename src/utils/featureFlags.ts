import { Platform } from "react-native";

// determines whether to bring addtional features per platform
const featureFlags = {
  useExperimentalFeatures: Platform.OS === "android" || Platform.OS === "ios",
};

export default featureFlags;
