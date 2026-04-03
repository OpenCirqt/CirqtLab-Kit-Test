import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { NavigationContainer } from "@react-navigation/native";
import React, { useEffect } from "react";
import { StyleSheet } from "react-native";
import BleManager from "react-native-ble-manager";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Provider } from "react-redux";
import { PersistGate } from "redux-persist/integration/react";
import TextUi from "./src/components/common/TextUi";
import { BleNotificationProvider } from "./src/contexts/BleNotificationContext";
import { FeatureFlagsProvider } from "./src/contexts/FeatureFlagsContext";
import TabNavigator from "./src/navigations/TabNavigator";
import { persistor, store } from "./src/store";

function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    BleManager.start({ showAlert: false });
  }, []);

  if (!fontsLoaded) {
    return (
      <>
        <TextUi tag="h4">Loading fonts...</TextUi>
      </>
    );
  }

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.container}>
        <Provider store={store}>
          <PersistGate loading={null} persistor={persistor}>
            <BleNotificationProvider>
              <FeatureFlagsProvider>
                <NavigationContainer>
                  <TabNavigator />
                </NavigationContainer>
              </FeatureFlagsProvider>
            </BleNotificationProvider>
          </PersistGate>
        </Provider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "white",
  },
});

export default App;
