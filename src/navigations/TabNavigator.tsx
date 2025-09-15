import Ionicons from "@expo/vector-icons/Ionicons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigatorScreenParams } from "@react-navigation/native";
import React from "react";
import { View } from "react-native";
import { Colors } from "../theme";
import DashboardNavigator, {
  DashboardRootStackParamList,
} from "./DashboardNavigator";
import DFUNavigator, { DFURootStackParamList } from "./DFUNavigator";
import SettingsNavigator, {
  SettingsRootStackParamList,
} from "./SettingsNavigator";

export type RootTabParamList = {
  DashboardTab: NavigatorScreenParams<DashboardRootStackParamList>;
  DFUTab: NavigatorScreenParams<DFURootStackParamList>;
  SettingsTab: NavigatorScreenParams<SettingsRootStackParamList>;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

type TabType = {
  name: string;
  tabName: keyof RootTabParamList;
  screen: () => React.JSX.Element;
};

const tabs: TabType[] = [
  {
    name: "Dashboard",
    tabName: "DashboardTab",
    screen: DashboardNavigator,
  },
  {
    name: "DFU",
    tabName: "DFUTab",
    screen: DFUNavigator,
  },
  {
    name: "Settings",
    tabName: "SettingsTab",
    screen: SettingsNavigator,
  },
];

const iconBuilder = (name: string, focused: boolean) => {
  let color = focused ? Colors.primary : Colors.disabled;
  if (name === "Dashboard") {
    return (
      <Ionicons
        name={focused ? "clipboard" : "clipboard-outline"}
        size={20}
        color={color}
      />
    );
  } else if (name === "DFU") {
    return (
      <Ionicons
        name={focused ? "cloud-upload" : "cloud-upload-outline"}
        size={20}
        color={color}
      />
    );
  } else {
    return (
      <Ionicons
        name={focused ? "settings" : "settings-outline"}
        size={20}
        color={color}
      />
    );
  }
};

const TabNavigator = () => {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarLabelStyle: {
          fontWeight: 600,
          fontFamily: "Poppins-Regular",
          color: Colors.black,
        },
      }}
    >
      {tabs.map((tab) => {
        return (
          <Tab.Screen
            key={tab.name + "Navigator"}
            name={tab.tabName}
            component={tab.screen}
            options={{
              tabBarIcon: ({ focused }) => {
                return (
                  <View
                    style={{
                      width: "100%",
                      flex: 1,
                      alignItems: "center",
                      borderTopColor: focused ? Colors.primary : "#fff",
                      borderTopWidth: 2,
                      paddingTop: 3,
                    }}
                  >
                    {iconBuilder(tab.name, focused)}
                  </View>
                );
              },
              tabBarLabel: tab.name,
            }}
          />
        );
      })}
    </Tab.Navigator>
  );
};

export default TabNavigator;
