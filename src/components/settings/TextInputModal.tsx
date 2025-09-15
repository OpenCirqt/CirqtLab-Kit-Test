import {
  setFilePrefix,
  setTextInputModalOpen,
} from "@/src/features/fileStorage/fileStorageSlice";
import { useAppDispatch, useAppSelector } from "@/src/store";
import { Colors } from "@/src/theme";
import { px } from "@/src/utils/setSize";
import React, { useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import ButtonUi from "../common/ButtonUi";
import TextUi from "../common/TextUi";

const TextInputModal = () => {
  const { isTextInputModalOpen, filePrefix } = useAppSelector(
    (state) => state.fileStorage
  );
  const [focused, setFocused] = useState(false);

  const dispatch = useAppDispatch();

  return (
    <Modal
      visible={isTextInputModalOpen}
      animationType="slide"
      transparent
      onRequestClose={() => dispatch(setTextInputModalOpen(false))}
    >
      {/* Backdrop */}
      <TouchableWithoutFeedback
        onPress={() => dispatch(setTextInputModalOpen(false))}
      >
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalView}>
            <TextUi
              tag="h5"
              style={[
                styles.modalInputLabel,
                {
                  color: focused ? Colors.primary : Colors.disabled,
                },
              ]}
            >
              Set Prefix
            </TextUi>
            <TextInput
              style={[
                styles.input,
                {
                  borderColor: focused ? Colors.primary : Colors.gray,
                },
              ]}
              placeholder="Type here"
              value={filePrefix}
              onChangeText={(text) => dispatch(setFilePrefix(text))}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect={false}
              importantForAutofill="no"
              keyboardType="default"
              contextMenuHidden={true}
            />
            <ButtonUi
              size="large"
              type="primary"
              onPress={() => {
                dispatch(setTextInputModalOpen(false));
              }}
            >
              Close
            </ButtonUi>
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
  modalInputLabel: {
    paddingLeft: px(18),
    paddingBottom: px(8),
  },
  input: {
    borderWidth: 1,
    width: "100%",
    borderRadius: px(36),
    padding: px(20),
    marginBottom: 20,
  },
});

export default TextInputModal;
