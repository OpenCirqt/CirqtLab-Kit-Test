import React from "react";
import { StyleSheet, View } from "react-native";
import { Colors } from "../../theme";
import { fs, px } from "../../utils/setSize";
import ButtonUi from "./ButtonUi";
import TextUi from "./TextUi";

type NotificationType = "warning" | "info" | "disabled";

interface NotificationUiProps {
  type: NotificationType;
  message: string;
  buttonText: string;
  onPress: () => void;
}

const NotificationUi: React.FC<NotificationUiProps> = ({
  type,
  message,
  buttonText,
  onPress,
}) => {
  return (
    <View
      style={[
        styles.container,
        type === "warning" ? styles.warning : styles.info,
      ]}
    >
      <View style={styles.messageWrapper}>
        <TextUi
          tag="h5"
          weight="medium"
          style={[
            styles.message,
            type === "warning" ? styles.messageWarning : styles.messageInfo,
          ]}
        >
          {message}
        </TextUi>
      </View>
      <ButtonUi
        type={
          type === "disabled"
            ? "disabled"
            : type === "warning"
            ? "secondary"
            : "primary"
        }
        size="medium"
        customStyle={styles.button}
        onPress={onPress}
      >
        {buttonText}
      </ButtonUi>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    padding: px(8),
    marginBottom: px(8),
    borderRadius: px(10),
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: px(4),
    elevation: px(2), // for Android
  },
  warning: {
    backgroundColor: Colors.primary,
  },
  info: {
    backgroundColor: Colors.warmGray,
  },
  messageWrapper: {
    flex: 1,
    minWidth: 0,
    marginHorizontal: px(8),
  },
  message: {
    flexShrink: 1,
    flexWrap: "wrap",
    fontSize: fs(22),
  },
  messageWarning: {
    color: Colors.white,
  },
  messageInfo: {
    color: Colors.black,
  },
  button: {
    minWidth: px(120),
  },
});

export default NotificationUi;
