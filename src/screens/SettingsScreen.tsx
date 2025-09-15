import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as FileSystem from "expo-file-system";
import React, { useState } from "react";
import { ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import ModalUi from "../components/common/ModalUi";
import TextUi from "../components/common/TextUi";
import TextInputModal from "../components/settings/TextInputModal";
import { setTextInputModalOpen } from "../features/fileStorage/fileStorageSlice";
import { SettingsRootStackParamList } from "../navigations/SettingsNavigator";
import { useAppDispatch } from "../store";
import { Colors } from "../theme";
import { Status } from "../utils/constants";
import { fs, px } from "../utils/setSize";

type CellItem = {
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  forwardIcon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
};

type SectionType = {
  title: string;
  data: CellItem[];
};

type SettingsScreenProp = NativeStackNavigationProp<
  SettingsRootStackParamList,
  "Settings"
>;

const SettingsScreen = () => {
  const [modalVisible, setModalVisible] = useState(false);
  const [modalStatus, setModalStatus] = useState<Status>("idle");
  const [doneMessage, setDoneMessage] = useState<string | undefined>(undefined);

  const dispatch = useAppDispatch();

  const navigation = useNavigation<SettingsScreenProp>();

  const clearCache = async () => {
    setModalVisible(true);
    setModalStatus("deleting");
    try {
      const files = await FileSystem.readDirectoryAsync(
        FileSystem.cacheDirectory!
      );
      for (const file of files) {
        const fileUri = FileSystem.cacheDirectory + file;
        await FileSystem.deleteAsync(fileUri, { idempotent: true });
      }
      setDoneMessage("The cache directory was emptied.");
    } catch (err) {
      setDoneMessage(`Error: ${String(err)}`);
    } finally {
      setModalStatus("done");
    }
  };

  const DATA: SectionType[] = [
    {
      title: "Files",
      data: [
        {
          label: "File Manager",
          description: "Manage Files",
          icon: "folder-outline",
          forwardIcon: "chevron-forward-outline",
          onPress: () => navigation.navigate("FileManager"),
        },
        {
          label: "Prefix Setting",
          description: "Set export data prefix",
          icon: "download-outline",
          onPress: () => {
            dispatch(setTextInputModalOpen(true));
          },
        },
        {
          label: "Clear Cache",
          description: "Clear cached files",
          icon: "trash-outline",
          onPress: () => clearCache(),
        },
      ],
    },
  ];

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={styles.container}
      >
        {DATA.map((dataGroup) => (
          <View key={dataGroup.title} style={styles.settingGroup}>
            <TextUi tag="h3" weight="bold" style={styles.sectionTitle}>
              {dataGroup.title}
            </TextUi>
            {dataGroup.data.map((item) => (
              <TouchableOpacity
                key={item.label}
                style={styles.settingRow}
                onPress={item.onPress}
              >
                <Ionicons name={item.icon} size={36} color={Colors.primary} />
                <View style={{ flex: 1 }}>
                  <TextUi tag="h3" weight="bold">
                    {item.label}
                  </TextUi>
                  <TextUi tag="h5">{item.description}</TextUi>
                </View>
                {item.forwardIcon && (
                  <Ionicons
                    name={item.forwardIcon}
                    size={26}
                    color={Colors.disabled}
                  />
                )}
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </ScrollView>
      <TextInputModal />
      <ModalUi
        visible={modalVisible}
        status={modalStatus}
        doneMessage={doneMessage}
        onClose={() => {
          setModalVisible(false);
          setModalStatus("idle");
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.lightGray,
    padding: px(24),
  },
  settingGroup: {
    marginBottom: px(24),
  },
  sectionTitle: {
    color: Colors.primary,
    marginLeft: px(16),
    marginBottom: px(16),
    textTransform: "uppercase",
    letterSpacing: fs(1),
  },
  settingRow: {
    flexDirection: "row",
    gap: px(24),
    alignItems: "center",
    backgroundColor: Colors.white,
    paddingHorizontal: px(24),
    paddingVertical: px(24),
    borderRadius: px(12),
    marginBottom: px(16),
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: fs(4),
    elevation: fs(3), // for Android
  },
});

export default SettingsScreen;
