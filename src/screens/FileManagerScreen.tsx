import Ionicons from "@expo/vector-icons/Ionicons";
import { useIsFocused } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as FileSystem from "expo-file-system";
import { useNavigation } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Share from "react-native-share";
import { zip } from "react-native-zip-archive";
import ModalUi from "../components/common/ModalUi";
import TextUi from "../components/common/TextUi";
import { SettingsRootStackParamList } from "../navigations/SettingsNavigator";
import { Colors } from "../theme";
import { Status } from "../utils/constants";
import { fs, px } from "../utils/setSize";

type SettingsScreenProp = NativeStackNavigationProp<
  SettingsRootStackParamList,
  "FileManager"
>;

interface FileItem {
  name: string;
  uri: string;
  isDirectory: boolean;
  size?: number;
  lastModified?: number;
  fileCount?: number;
}

const formatSize = (size?: number) => {
  if (size === undefined) return "N/A";
  return (size / (1024 * 1024)).toFixed(2) + " MB";
};

const formatDate = (time?: number) => {
  if (!time) return "";
  const date = new Date(time * 1000);
  return `Last Modified: ${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
};

const FileManagerScreen = () => {
  const insets = useSafeAreaInsets();

  const navigation = useNavigation<SettingsScreenProp>();

  const rootPath = FileSystem.documentDirectory || "";

  const [currentPath, setCurrentPath] = useState<string>(rootPath);
  const [items, setItems] = useState<FileItem[]>([]);
  const [selectionMode, setSelectionMode] = useState<boolean>(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  const [modalVisible, setModalVisible] = useState<boolean>(false);
  const [modalStatus, setModalStatus] = useState<Status>("idle");
  const [doneMessage, setDoneMessage] = useState<string | undefined>(undefined);
  const [toBeShared, setToBeShared] = useState<boolean>(false);
  const [exportingFileId, setExportingFileId] = useState<string>("");

  const isFocused = useIsFocused();
  const prevPathRef = useRef<string>("");

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current; // X translation

  const pathParts = currentPath
    .replace(rootPath, "")
    .split("/")
    .filter(Boolean);

  const loadDirectory = async (path: string) => {
    try {
      const dirItems = await FileSystem.readDirectoryAsync(path);
      const itemDetails = await Promise.all(
        dirItems.map(async (name) => {
          const uri = path + name + (name.includes(".") ? "" : "/");
          const info = await FileSystem.getInfoAsync(uri, {
            size: true,
          });
          let count: number | undefined;

          const fileInfo: FileItem = {
            name,
            uri,
            isDirectory: info.isDirectory ?? false,
          };

          if (info.isDirectory) {
            try {
              const subItems = await FileSystem.readDirectoryAsync(uri);
              count = subItems.length;
            } catch {
              count = 0;
            }
            fileInfo.fileCount = count;
          }

          if (info.exists) {
            fileInfo.size = info.size;
            fileInfo.lastModified = info.modificationTime;
          }
          return fileInfo;
        })
      );
      // Sort directories first, then files, both by last modified descending
      itemDetails.sort((a, b) => {
        // Directories first
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;

        // Sort by modificationTime descending
        return (b.lastModified ?? 0) - (a.lastModified ?? 0);
      });

      setItems(itemDetails);
    } catch (err) {
      Alert.alert("Error", String(err));
    }
  };

  const enterDirectory = (item: FileItem) => {
    if (item.isDirectory && !selectionMode) {
      setCurrentPath(item.uri);
    }
  };

  const jumpToBreadcrumb = (index: number) => {
    if (selectionMode) return;

    const newPath =
      index === -1
        ? rootPath
        : rootPath + pathParts.slice(0, index + 1).join("/") + "/";
    setCurrentPath(newPath);
  };

  // no need for now based on the current design
  // const goUpOneLevel = () => {
  // 	if (currentPath === rootPath) return;
  // 	const parts = currentPath
  // 		.replace(rootPath, "")
  // 		.split("/")
  // 		.filter(Boolean);
  // 	parts.pop();
  // 	const newPath =
  // 		parts.length === 0 ? rootPath : rootPath + parts.join("/") + "/";
  // 	setCurrentPath(newPath);
  // };

  const toggleSelect = (uri: string) => {
    setSelectedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(uri)) {
        newSet.delete(uri);
        if (newSet.size === 0) {
          setSelectionMode(false);
        }
      } else {
        newSet.add(uri);
      }
      return newSet;
    });
  };

  const handleLongPress = (item: FileItem) => {
    setSelectionMode(true);
    setSelectedItems(new Set([item.uri]));
  };

  const resetSelectedItems = () => {
    setSelectedItems(new Set());
    setSelectionMode(false);
  };

  const handleItemDelete = () => {
    setModalVisible(true);
    setModalStatus("undeleted");
  };

  const handleShare = async (item: FileItem) => {
    setExportingFileId(item.uri);
    setToBeShared(true);
    try {
      if (item.isDirectory) {
        const zipPath = `${item.uri}${item.name}.zip`;
        await zip(item.uri, zipPath);
        await Share.open({
          url: zipPath,
          type: "application/zip",
          failOnCancel: false,
        });
      } else {
        await Share.open({
          url: item.uri,
          filename: `${item.name}.csv`,
          type: "text/csv",
          failOnCancel: false,
        });
      }
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      await FileSystem.deleteAsync(`${item.uri}${item.name}.zip`, {
        idempotent: true,
      });
      setExportingFileId("");
      setToBeShared(false);
    }
  };

  const deleteSelectedItems = async () => {
    try {
      setModalStatus("deleting");
      for (const uri of selectedItems) {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      }
      resetSelectedItems();
      loadDirectory(currentPath);
      setDoneMessage(
        `Selected Director(ies) and/or File(s) have been successfully deleted.`
      );
    } catch (err) {
      setDoneMessage(`Error: ${String(err)}`);
    } finally {
      setModalStatus("done");
    }
  };

  useEffect(() => {
    const animateAndLoad = async () => {
      const goingDeeper =
        prevPathRef.current && currentPath.startsWith(prevPathRef.current);

      // fade out + slide
      await new Promise((resolve) => {
        Animated.parallel([
          Animated.timing(fadeAnim, {
            toValue: 0,
            duration: 150,
            easing: Easing.ease,
            useNativeDriver: true,
          }),
          Animated.timing(slideAnim, {
            toValue: goingDeeper ? -50 : 50, // slide old view left/right
            duration: 150,
            useNativeDriver: true,
          }),
        ]).start(() => resolve(null));
      });

      // load directory
      await loadDirectory(currentPath);

      // reset position for new content
      slideAnim.setValue(goingDeeper ? 50 : -50);

      // fade in + slide into place
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          easing: Easing.ease,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 200,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start();
    };

    const regularLoad = async () => {
      // load directory
      await loadDirectory(currentPath);
    };

    const pathChanged = currentPath !== prevPathRef.current;

    // if path changed and screen focused, trigger animations and load dirs and files
    if (pathChanged && isFocused) {
      animateAndLoad();
    } else {
      regularLoad();
    }

    prevPathRef.current = currentPath;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath, isFocused]);

  const renderItem = ({ item }: { item: FileItem }) => (
    <TouchableOpacity
      style={styles.fileItemWrapper}
      onPress={() =>
        selectionMode ? toggleSelect(item.uri) : enterDirectory(item)
      }
      onLongPress={() => handleLongPress(item)}
    >
      {selectionMode && (
        <Ionicons
          name={
            selectedItems.has(item.uri) ? "checkmark-circle" : "ellipse-outline"
          }
          size={24}
          color={
            selectedItems.has(item.uri) ? Colors.secondary : Colors.disabled
          }
          style={{ marginRight: 8 }}
        />
      )}
      <View style={styles.fileItem}>
        <Ionicons
          name={item.isDirectory ? "folder" : "document"}
          size={36}
          color={item.isDirectory ? Colors.yellow : Colors.tertiary}
          style={{ marginRight: 8 }}
        />
        <View style={{ flexShrink: 1, flex: 1 }}>
          <TextUi tag="h4" weight="bold">
            {item.name}
          </TextUi>
          <TextUi tag="h5">
            {item.isDirectory
              ? `${item.fileCount ?? 0} item${
                  item.fileCount && item.fileCount > 1 ? "s" : ""
                }`
              : `${formatSize(item.size)}`}
          </TextUi>
          <TextUi tag="h5">
            {item.lastModified ? `${formatDate(item.lastModified)}` : ""}
          </TextUi>
        </View>
        <TouchableOpacity
          onPress={() =>
            selectionMode ? toggleSelect(item.uri) : handleShare(item)
          }
        >
          {toBeShared && item.uri === exportingFileId ? (
            <ActivityIndicator size={40} />
          ) : (
            <Ionicons name="share-outline" size={28} color={Colors.tertiary} />
          )}
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View
        style={[styles.fileManagerHeaderContainer, { paddingTop: insets.top }]}
      >
        <TouchableOpacity
          style={styles.fileManagerHeaderBackButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons
            name="chevron-back-outline"
            size={32}
            color={Colors.white}
          ></Ionicons>
        </TouchableOpacity>
        <TextUi tag="h1" weight="bold" style={styles.fileManagerHeaderTitle}>
          File Manager
        </TextUi>
        <View style={styles.fileManagerBreadcrumb}>
          <TouchableOpacity
            onPress={() => jumpToBreadcrumb(-1)}
            style={styles.fileDir}
          >
            <TextUi
              tag="h4"
              weight="medium"
              style={styles.fileManagerBreadcrumbText}
            >
              Root
            </TextUi>
          </TouchableOpacity>

          {pathParts.map((part, idx) => (
            <View key={idx} style={styles.fileManagerBreadcrumb}>
              <TextUi
                tag="h4"
                weight="medium"
                style={styles.fileManagerBreadcrumbText}
              >
                &nbsp;/&nbsp;
              </TextUi>
              <TouchableOpacity
                onPress={() => jumpToBreadcrumb(idx)}
                style={styles.fileDir}
              >
                <TextUi
                  tag="h4"
                  weight="medium"
                  style={styles.fileManagerBreadcrumbText}
                >
                  {part}
                </TextUi>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.fileManagerToolbarWrapper}>
        <View style={styles.fileManagerToolbar}>
          {selectionMode ? (
            <>
              <TouchableOpacity
                style={styles.fileSelected}
                onPress={() => resetSelectedItems()}
              >
                <Ionicons
                  name="close-outline"
                  size={24}
                  color={Colors.black}
                ></Ionicons>
                <TextUi tag="h3" weight="medium">
                  {selectedItems.size}
                </TextUi>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleItemDelete}>
                <Ionicons
                  name="trash-outline"
                  size={28}
                  color={Colors.red}
                ></Ionicons>
              </TouchableOpacity>
            </>
          ) : (
            <TextUi tag="h4">
              {items.length} item{items.length > 1 ? "s" : ""}
            </TextUi>
          )}
        </View>
      </View>
      <Animated.View
        style={{
          flex: 1,
          opacity: fadeAnim,
          transform: [{ translateX: slideAnim }],
        }}
      >
        <FlatList
          data={items}
          keyExtractor={(item) => item.uri}
          renderItem={renderItem}
        />
      </Animated.View>
      <ModalUi
        visible={modalVisible}
        status={modalStatus}
        doneMessage={doneMessage}
        onClose={() => {
          setModalVisible(false);
          setModalStatus("idle");
        }}
        onDelete={() => {
          deleteSelectedItems();
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.lightGray,
  },
  fileManagerHeaderContainer: {
    backgroundColor: Colors.primary,
    color: Colors.white,
    padding: px(24),
  },
  fileManagerHeaderBackButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.white,
    alignSelf: "flex-start",
    borderRadius: px(8),
  },
  fileManagerHeaderTitle: {
    color: Colors.white,
    paddingVertical: px(24),
  },
  fileManagerBreadcrumb: {
    flexDirection: "row",
    alignItems: "center",
  },
  fileManagerBreadcrumbText: {
    color: Colors.white,
  },
  fileItemWrapper: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: px(8),
    marginHorizontal: px(24),
    gap: fs(16),
  },
  fileItem: {
    flex: 1,
    flexDirection: "row",
    gap: px(16),
    alignItems: "center",
    backgroundColor: Colors.white,
    paddingHorizontal: px(24),
    paddingVertical: px(24),
    borderRadius: px(12),
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: fs(4),
    elevation: fs(3), // for Android
  },
  fileManagerToolbarWrapper: {
    backgroundColor: Colors.primary,
  },
  fileManagerToolbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopLeftRadius: px(24),
    borderTopRightRadius: px(24),
    backgroundColor: Colors.lightGray,

    paddingHorizontal: px(24),
    height: px(90),
  },
  fileSelected: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.warmGray,
    borderRadius: px(24),
    paddingVertical: px(4),
    paddingHorizontal: px(16),
  },
  fileDir: {
    paddingVertical: px(8),
    paddingHorizontal: px(12),
    borderRadius: px(12),
    backgroundColor: Colors.tertiary,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: fs(4),
    elevation: fs(3), // for Android
  },
});

export default FileManagerScreen;
