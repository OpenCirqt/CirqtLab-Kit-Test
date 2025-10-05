import { Colors } from "@/src/theme";
import { fs, px } from "@/src/utils/setSize";
import React from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import ButtonUi from "./ButtonUi";
import TextUi from "./TextUi";

interface PermissionModalUiProps {
  visible: boolean;
  bleState?: string;
  locationState?: string;
  onClose?: () => void;
  onOpenSettings?: () => void;
}

const PermissionModalUi: React.FC<PermissionModalUiProps> = ({
  visible,
  bleState,
  locationState,
  onClose,
  onOpenSettings,
}) => {
  console.log(visible);
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      {/* Backdrop */}
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : "height"} // iOS uses "padding", Android "height"
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalView}>
            <View style={styles.modalHeader}>
              <TextUi tag="h4" weight="bold" style={styles.modalHeaderText}>
                Permissions Required
              </TextUi>
            </View>
            <>
              {bleState !== "on" && (
                <View style={styles.modalBulletRow}>
                  <View style={styles.modalBullet}></View>
                  <TextUi tag="h4" style={styles.modalText}>
                    Turn on Bluetooth and allow the app to access it.
                  </TextUi>
                </View>
              )}
              {locationState !== "READY" && (
                <View style={styles.modalBulletRow}>
                  <View style={styles.modalBullet}></View>
                  <TextUi tag="h4" style={styles.modalText}>
                    Turn on Location Services and grant location access.
                  </TextUi>
                </View>
              )}
              <TextUi
                tag="h4"
                style={[styles.modalText, styles.modalClosingText]}
              >
                This lets us connect to nearby devices and give you real-time
                updates.
              </TextUi>
              <ButtonUi size="large" type="primary" onPress={onOpenSettings}>
                Open Settings
              </ButtonUi>
              <ButtonUi size="large" type="secondary" onPress={onClose}>
                Close
              </ButtonUi>
            </>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)", // semi-transparent backdrop
  },
  keyboardView: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  modalView: {
    width: "80%",
    backgroundColor: "white",
    padding: px(28),
    borderRadius: px(24),
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  modalHeader: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    padding: px(4),
  },
  modalHeaderText: {
    fontSize: fs(26),
    paddingBottom: px(20),
    paddingHorizontal: px(10),
  },
  modalText: {
    flexShrink: 1,
  },
  modalClosingText: {
    paddingVertical: px(20),
    paddingHorizontal: px(8),
  },
  modalBulletRow: {
    flexDirection: "row",
    paddingVertical: px(10),
    gap: px(16),
  },
  modalBullet: {
    width: px(10),
    height: "100%",
    backgroundColor: Colors.primary,
  },
});

export default PermissionModalUi;
