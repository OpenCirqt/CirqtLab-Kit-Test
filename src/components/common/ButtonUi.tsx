import React from "react";
import { Pressable, StyleProp, StyleSheet, TextStyle, ViewStyle } from "react-native";
import { Colors } from "../../theme";
import { fs } from "../../utils/setSize";
import TextUi from "./TextUi";

type ButtonType = "primary" | "secondary" | "disabled" | "warning";
type ButtonSize = "small" | "medium" | "large";

type ButtonUiProps = {
  type: ButtonType;
  size: ButtonSize;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  children: React.ReactNode;
};

const SIZE_MAP: Record<ButtonSize, number> = {
  small: fs(10),
  medium: fs(13),
  large: fs(16),
};

const BUTTON_STYLE_MAP: Record<
  ButtonType,
  {
    default: ViewStyle;
    pressed?: ViewStyle;
    textDefault: TextStyle;
    textPressed?: TextStyle;
  }
> = {
  disabled: {
    default: { backgroundColor: Colors.disabled },
    textDefault: { color: Colors.disabledText },
  },
  primary: {
    default: { backgroundColor: Colors.primary },
    pressed: { backgroundColor: Colors.tertiary },
    textDefault: { color: Colors.white },
    textPressed: { color: Colors.white },
  },
  secondary: {
    default: {
      backgroundColor: Colors.white,
      borderColor: Colors.secondary,
      borderWidth: 2,
    },
    pressed: {
      backgroundColor: Colors.secondary,
      borderColor: Colors.secondary,
      borderWidth: 2,
    },
    textDefault: { color: Colors.secondary },
    textPressed: { color: Colors.white },
  },
  warning: {
    default: { backgroundColor: Colors.red },
    pressed: { backgroundColor: Colors.lightRed },
    textDefault: { color: Colors.white },
    textPressed: { color: Colors.white },
  },
};

const ButtonUi: React.FC<ButtonUiProps> = ({
  type,
  size,
  style = {},
  onPress,
  children,
}) => {
  const padding = SIZE_MAP[size] ?? SIZE_MAP.medium;
  const stylesForType = BUTTON_STYLE_MAP[type];

  const baseButtonStyle: ViewStyle = {
    paddingHorizontal: fs(18),
    paddingVertical: padding,
    borderRadius: padding + fs(18),
    borderWidth: 2,
    borderColor: "transparent",
  };

  const baseTextStyle: TextStyle = {
    fontFamily: "Inter_500Medium",
  };

  return (
    <Pressable
      disabled={type === "disabled"}
      onPress={onPress}
      style={({ pressed }) => [
        baseButtonStyle,
        styles.button,
        stylesForType.default,
        pressed && stylesForType.pressed,
        style,
      ]}
    >
      {({ pressed }) => (
        <TextUi
          tag={
            size === "small" ? "buttonText" : size === "medium" ? "h5" : "h4"
          }
          style={[
            baseTextStyle,
            styles.buttonText,
            stylesForType.textDefault,
            pressed && stylesForType.textPressed,
          ]}
        >
          {children}
        </TextUi>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  button: {
    marginVertical: fs(8),
  },
  buttonText: {
    alignSelf: "center",
  },
});

export default ButtonUi;
