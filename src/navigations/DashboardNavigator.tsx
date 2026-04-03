import Ionicons from "@expo/vector-icons/Ionicons";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import { StyleSheet, TouchableOpacity } from "react-native";
import BluetoothConnectionScreen from "../screens/BluetoothConnectionScreen";
import DashboardScreen from "../screens/DashboardScreen";
import DataPointsSelection from "../screens/DataPointsSelection";
import { Colors } from "../theme";

export type DashboardRootStackParamList = {
  Dashboard: undefined;
  DataPointsSelection: undefined;
  BluetoothConnection: undefined;
};

const Stack = createNativeStackNavigator<DashboardRootStackParamList>();

const DashboardNavigator = () => {
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
        name="Dashboard"
        component={DashboardScreen}
        options={({ navigation }) => ({
          headerRight: () => (
            <TouchableOpacity
              onPress={() => navigation.navigate("DataPointsSelection")}
              style={styles.headerRightStyle}
            >
              <Ionicons name="ellipsis-vertical" size={24} color="black" />
            </TouchableOpacity>
          ),
          headerLargeTitle: true,
          headerTitle: "Dashboard",
          headerTransparent: true,
        })}
      />
      <Stack.Screen
        name="DataPointsSelection"
        component={DataPointsSelection}
        options={{
          headerBackTitle: "",
          headerBackButtonDisplayMode: "minimal",
          headerTitle: "Data Selection",
        }}
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
    </Stack.Navigator>
  );
};

const styles = StyleSheet.create({
  headerRightStyle: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
});

export default DashboardNavigator;
