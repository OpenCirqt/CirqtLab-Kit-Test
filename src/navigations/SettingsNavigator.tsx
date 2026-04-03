import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import FileManagerScreen from "../screens/FileManagerScreen";
import SettingsScreen from "../screens/SettingsScreen";
import { Colors } from "../theme";

export type SettingsRootStackParamList = {
  Settings: undefined;
  FileManager: undefined;
};

const Stack = createNativeStackNavigator<SettingsRootStackParamList>();

const SettingsNavigator = () => {
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
        name="Settings"
        component={SettingsScreen}
        options={{
          headerLargeTitle: true,
          headerTransparent: true,
        }}
      />
      <Stack.Screen
        name="FileManager"
        component={FileManagerScreen}
        options={{
          headerShown: false,
        }}
      />
    </Stack.Navigator>
  );
};

export default SettingsNavigator;
