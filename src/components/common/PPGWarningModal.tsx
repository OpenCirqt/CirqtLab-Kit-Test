import { Colors } from "@/src/theme";
import { px } from "@/src/utils/setSize";
import Ionicons from "@expo/vector-icons/Ionicons";
import React, { useEffect, useState } from "react";
import {
  Modal,
  StyleSheet,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import ButtonUi from "./ButtonUi";
import TextUi from "./TextUi";

interface PPGWarningModalProps {
  visible: boolean;
  onAccept: () => void;
  onCancel: () => void;
}

const PPGWarningModal: React.FC<PPGWarningModalProps> = ({
  visible,
  onAccept,
  onCancel,
}) => {
  const [countdown, setCountdown] = useState(3);
  const [canAccept, setCanAccept] = useState(false);

  useEffect(() => {
    if (visible) {
      setCountdown(5);
      setCanAccept(false);

      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            setCanAccept(true);
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [visible]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onCancel}
    >
      {/* Backdrop */}
      <TouchableWithoutFeedback onPress={onCancel}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>
      <View style={styles.container}>
        <View style={styles.modalView}>
          <Ionicons
            name="warning"
            size={64}
            color={Colors.red}
            style={styles.icon}
          />
          <TextUi tag="h2" weight="bold" style={styles.title}>
            IMPORTANT DISCLAIMER
          </TextUi>
          <View style={styles.warningBox}>
            <TextUi tag="h4" weight="medium" style={styles.warningText}>
              The PPG analysis results (Heart Rate and SpO2) are for
              DEMONSTRATION and ALGORITHM SHOWCASE purposes ONLY.
            </TextUi>
            <TextUi tag="h4" weight="bold" style={styles.warningTextBold}>
              NOT FOR MEDICAL USE
            </TextUi>
            <TextUi tag="h5" weight="medium" style={styles.disclaimerText}>
              These readings should not be used for medical diagnosis,
              treatment, or health decisions. Consult a healthcare professional
              for medical advice. All data displayed in this app
              does not give any analysis or recommendations.
            </TextUi>
            <TextUi tag="h5" weight="medium" style={styles.disclaimerText}>
              By proceeding, you acknowledge and accept this disclaimer. 
            </TextUi>
          </View>
          <View style={styles.buttonContainer}>
            <ButtonUi
              size="large"
              type={canAccept ? "primary" : "disabled"}
              onPress={canAccept ? onAccept : undefined}
              style={styles.button}
            >
              {canAccept ? "I Understand" : `Wait ${countdown}s`}
            </ButtonUi>
            <ButtonUi
              size="large"
              type="secondary"
              onPress={onCancel}
              style={styles.button}
            >
              Cancel
            </ButtonUi>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  modalView: {
    width: "85%",
    maxWidth: 500,
    backgroundColor: "white",
    padding: px(24),
    borderRadius: px(16),
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  icon: {
    alignSelf: "center",
    marginBottom: px(12),
  },
  title: {
    textAlign: "center",
    color: Colors.red,
    marginBottom: px(16),
  },
  warningBox: {
    backgroundColor: "#FFF3CD",
    borderWidth: 2,
    borderColor: "#FFC107",
    borderRadius: px(8),
    padding: px(16),
    marginBottom: px(20),
  },
  warningText: {
    textAlign: "center",
    color: "#856404",
    marginBottom: px(12),
  },
  warningTextBold: {
    textAlign: "center",
    color: Colors.red,
    marginBottom: px(12),
    fontSize: px(18),
  },
  disclaimerText: {
    textAlign: "center",
    color: "#856404",
  },
  buttonContainer: {
    gap: px(12),
  },
  button: {
    width: "100%",
  },
});

export default PPGWarningModal;
