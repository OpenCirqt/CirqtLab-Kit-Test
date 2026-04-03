import Ionicons from "@expo/vector-icons/Ionicons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigatorScreenParams } from "@react-navigation/native";
import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { useFeatureFlags } from "../contexts/FeatureFlagsContext";
import { Colors } from "../theme";
import BACNavigator, { BACRootStackParamList } from "./BACNavigator";
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
  BACTab: NavigatorScreenParams<BACRootStackParamList>;
  SettingsTab: NavigatorScreenParams<SettingsRootStackParamList>;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

type TabConfig = {
  label: string;
  tabName: keyof RootTabParamList;
  screen: () => React.JSX.Element;
  icon: IoniconName;
  iconFocused: IoniconName;
};

type TabIconProps = {
  icon: IoniconName;
  iconFocused: IoniconName;
  focused: boolean;
};

const TabIcon = ({ icon, iconFocused, focused }: TabIconProps) => (
  <View
    style={[
      styles.iconContainer,
      { borderTopColor: focused ? Colors.primary : Colors.white },
    ]}
  >
    <Ionicons
      name={focused ? iconFocused : icon}
      size={20}
      color={focused ? Colors.primary : Colors.disabled}
    />
  </View>
);

const TabNavigator = () => {
  const { useExperimentalFeatures } = useFeatureFlags();

  const TAB_CONFIGS = useMemo(
    (): TabConfig[] => [
      {
        label: "Dashboard",
        tabName: "DashboardTab",
        screen: DashboardNavigator,
        icon: "clipboard-outline",
        iconFocused: "clipboard",
      },
      {
        label: "DFU",
        tabName: "DFUTab",
        screen: DFUNavigator,
        icon: "cloud-upload-outline",
        iconFocused: "cloud-upload",
      },
      ...(useExperimentalFeatures
        ? [
            {
              label: "BAC",
              tabName: "BACTab",
              screen: BACNavigator,
              icon: "cafe-outline",
              iconFocused: "cafe",
            } satisfies TabConfig,
          ]
        : []),
      {
        label: "Settings",
        tabName: "SettingsTab",
        screen: SettingsNavigator,
        icon: "settings-outline",
        iconFocused: "settings",
      },
    ],
    [useExperimentalFeatures],
  );

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarLabelStyle: styles.tabBarLabel,
      }}
    >
      {TAB_CONFIGS.map(({ label, tabName, screen, icon, iconFocused }) => (
        <Tab.Screen
          key={`${label}Navigator`}
          name={tabName}
          component={screen}
          options={{
            tabBarLabel: label,
            tabBarIcon: ({ focused }) => (
              <TabIcon
                icon={icon}
                iconFocused={iconFocused}
                focused={focused}
              />
            ),
          }}
        />
      ))}
    </Tab.Navigator>
  );
};

const styles = StyleSheet.create({
  iconContainer: {
    width: "100%",
    flex: 1,
    alignItems: "center",
    borderTopWidth: 2,
    paddingTop: 3,
  },
  tabBarLabel: {
    fontFamily: "Inter_500Medium",
    color: Colors.black,
  },
});

export default TabNavigator;
