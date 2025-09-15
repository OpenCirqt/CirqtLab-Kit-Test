import { NavigationContainer } from "@react-navigation/native";
import React, { useEffect } from "react";
import { Alert, PermissionsAndroid, Platform, StyleSheet } from "react-native";
import BleManager from "react-native-ble-manager";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Provider } from "react-redux";
import { PersistGate } from "redux-persist/integration/react";
import TabNavigator from "./src/navigations/TabNavigator";
import { persistor, store } from "./src/store";

function App() {
  useEffect(() => {
    initBLE();
  }, []);

  const initBLE = async () => {
    try {
      if (Platform.OS === "android") {
        const result = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
          PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
          PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
        ]);
        if (result) {
          console.debug("User accepts Bluetooth permissions");
        } else {
          console.error("User refuses Bluetooth permissions");
          Alert.alert(
            "Accept Permissions",
            "You have to accept Bluetooth permissions to use this app"
          );
          return;
        }
      }
      await BleManager.start({ showAlert: true });
      console.log("BLE started");
    } catch (error) {
      console.log(error);
      Alert.alert("Error", "Cannot start BLE");
    }
  };

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.container}>
        <Provider store={store}>
          <PersistGate loading={null} persistor={persistor}>
            <NavigationContainer>
              <TabNavigator />
            </NavigationContainer>
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
