import Ionicons from "@expo/vector-icons/Ionicons";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import { StyleSheet, TouchableOpacity } from "react-native";
import BluetoothConnectionScreen from "../screens/BluetoothConnectionScreen";
import DashboardScreen from "../screens/DashboardScreen";
import DataPointsSelection from "../screens/DataPointsSelection";
import { Colors } from "../theme";
import { px } from "../utils/setSize";

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
          fontFamily: "Poppins-Regular",
          fontWeight: 600,
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
    paddingRight: px(4),
  },
});

export default DashboardNavigator;
