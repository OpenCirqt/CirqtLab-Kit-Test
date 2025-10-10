import { Colors } from "@/src/theme";
import { Status } from "@/src/utils/constants";
import { px } from "@/src/utils/setSize";
import Ionicons from "@expo/vector-icons/Ionicons";
import React, { useEffect } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import ButtonUi from "./ButtonUi";
import TextUi from "./TextUi";

interface ModalUiProps {
  visible: boolean;
  status: Status;
  doneMessage?: string;
  onClose?: () => void;
  onSave?: () => void;
  onContinue?: () => void;
  onDelete?: () => void;
  onNavigate?: () => void;
}

const ModalUi: React.FC<ModalUiProps> = ({
  visible,
  status,
  doneMessage,
  onClose,
  onSave,
  onContinue,
  onDelete,
  onNavigate,
}) => {
  const rotation = useSharedValue(0);

  // spinner animation
  useEffect(() => {
    if (status === "saving" || status === "loading") {
      rotation.value = withRepeat(
        withTiming(360, { duration: 1000, easing: Easing.linear }),
        -1,
        false
      );
    } else {
      rotation.value = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      {/* Backdrop */}
      <TouchableWithoutFeedback
        onPress={status === "done" ? onClose : undefined}
      >
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : "height"} // iOS uses "padding", Android "height"
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalView}>
            {(status === "saving" || status === "deleting") && (
              <>
                <Animated.View style={[styles.spinner, animatedStyle]} />
                <TextUi tag="h4" weight="medium" style={styles.modalText}>
                  {status.charAt(0).toUpperCase() + status.slice(1)} data...
                </TextUi>
              </>
            )}
            {status === "loading" && (
              <>
                <Animated.View style={[styles.spinner, animatedStyle]} />
                <TextUi tag="h4" weight="medium" style={styles.modalText}>
                  Processing...
                </TextUi>
              </>
            )}
            {status === "done" && (
              <>
                <TextUi tag="h4" weight="medium" style={styles.modalText}>
                  {doneMessage}
                </TextUi>
                <ButtonUi size="large" type="primary" onPress={onClose}>
                  Close
                </ButtonUi>
              </>
            )}

            {status === "unsaved" && (
              <>
                <TextUi tag="h4" weight="medium" style={styles.modalText}>
                  Your collected data has not been saved. Would you like to save
                  it?
                </TextUi>

                <ButtonUi size="large" type="warning" onPress={onContinue}>
                  Continue anyway
                </ButtonUi>
                <ButtonUi size="large" type="primary" onPress={onSave}>
                  Save
                </ButtonUi>
              </>
            )}
            {status === "undeleted" && (
              <>
                <TextUi tag="h4" weight="medium" style={styles.modalText}>
                  Are you sure to delete the selected directories and/or files?
                </TextUi>

                <ButtonUi size="large" type="warning" onPress={onDelete}>
                  Delete
                </ButtonUi>
                <ButtonUi size="large" type="primary" onPress={onClose}>
                  Cancel
                </ButtonUi>
              </>
            )}

            {status === "collecting" && (
              <>
                <Ionicons
                  name="warning-outline"
                  size={50}
                  color={Colors.yellow}
                  style={{ alignSelf: "center" }}
                />
                <TextUi tag="h4" weight="medium" style={styles.modalText}>
                  Sorry, you cannot perform firmware upgrade while collecting
                  sensor data. Please stop data collection to continue.
                </TextUi>
                <ButtonUi size="large" type="warning" onPress={onNavigate}>
                  Back to Dashboard
                </ButtonUi>
              </>
            )}
            {status === "uploading" && (
              <>
                <Ionicons
                  name="warning-outline"
                  size={50}
                  color={Colors.red}
                  style={{ alignSelf: "center" }}
                />
                <TextUi tag="h4" weight="medium" style={styles.modalText}>
                  Sorry, you cannot collect sensor data or disconnect device
                  while performing firmware upgrade. Hang tight.
                </TextUi>
                <ButtonUi size="large" type="warning" onPress={onNavigate}>
                  Back to DFU
                </ButtonUi>
              </>
            )}
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
    justifyContent: "center",
    alignItems: "center",
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
  modalText: {
    padding: px(20),
    textAlign: "center",
    flexShrink: 1,
  },
  spinner: {
    alignSelf: "center",
    width: px(80),
    height: px(80),
    borderWidth: px(8),
    borderColor: Colors.primary,
    borderTopColor: "transparent",
    borderRadius: px(40),
    marginBottom: px(16),
  },
  modalWarning: {
    flexDirection: "row",
    alignItems: "center",
  },
});

export default ModalUi;
