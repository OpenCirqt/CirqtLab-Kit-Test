import Ionicons from "@expo/vector-icons/Ionicons";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import { StyleSheet, TouchableOpacity } from "react-native";
import BluetoothConnectionScreen from "../screens/BluetoothConnectionScreen";
import DFUScreen from "../screens/DFUScreen";
import DFUSettingsScreen from "../screens/DFUSettingsScreen";
import { Colors } from "../theme";
import { px } from "../utils/setSize";

export type DFURootStackParamList = {
  DFU: undefined;
  BluetoothConnection: undefined;
  DFUSettings: undefined;
};

const Stack = createNativeStackNavigator<DFURootStackParamList>();

const DFUNavigator = () => {
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
        name="DFU"
        component={DFUScreen}
        options={({ navigation }) => ({
          headerRight: () => (
            <TouchableOpacity
              onPress={() => navigation.navigate("DFUSettings")}
              style={styles.headerRightStyle}
            >
              <Ionicons name="ellipsis-vertical" size={24} color="black" />
            </TouchableOpacity>
          ),
          headerLargeTitle: true,
          headerTitle: "Firmware Upgrade",
        })}
      />
      <Stack.Screen
        name="BluetoothConnection"
        component={BluetoothConnectionScreen}
        options={{
          headerBackTitle: "",
          headerBackButtonDisplayMode: "minimal",
          headerTitle: "Connect Bluetooth Device",
          presentation: "modal",
        }}
      />
      <Stack.Screen
        name="DFUSettings"
        component={DFUSettingsScreen}
        options={{
          headerBackTitle: "",
          headerBackButtonDisplayMode: "minimal",
          headerTitle: "DFU Settings",
        }}
      />
    </Stack.Navigator>
  );
};

const styles = StyleSheet.create({
  headerRightStyle: {
    paddingRight: px(4),
  },
});

export default DFUNavigator;
