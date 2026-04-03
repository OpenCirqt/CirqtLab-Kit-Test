import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import BACPredictionScreen from "../screens/BACPredictionScreen";
import { Colors } from "../theme";

export type BACRootStackParamList = {
  BAC: undefined;
};

const Stack = createNativeStackNavigator<BACRootStackParamList>();

const BACNavigator = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerBackTitle: "",
        headerTitleStyle: {
          fontFamily: "Inter_600SemiBold",
        },
        headerTintColor: Colors.black,
      }}
    >
      <Stack.Screen
        name="BAC"
        component={BACPredictionScreen}
        options={{
          headerLargeTitle: true,
          headerTitle: "BAC Prediction",
          headerTransparent: true,
        }}
      />
    </Stack.Navigator>
  );
};

export default BACNavigator;
