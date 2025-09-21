import React from "react";
import { StyleProp, Text, TextStyle } from "react-native";
import { Colors } from "../../theme";
import { fs } from "../../utils/setSize";

const TAG_STYLES: Record<string, Partial<TextStyle>> = {
  h1: {
    fontSize: fs(40),
  },
  h2: {
    fontSize: fs(34),
  },
  h3: {
    fontSize: fs(28),
  },
  h4: {
    fontSize: fs(24),
  },
  h5: {
    fontSize: fs(20),
  },
  body: {
    fontSize: fs(14),
  },
  buttonText: {
    fontSize: fs(18),
  },
};

type TextUiProps = {
  tag: keyof typeof TAG_STYLES;
  weight?: "bold" | "medium";
  style?: StyleProp<TextStyle>;
  children: React.ReactNode;
};

const TextUi: React.FC<TextUiProps> = ({
  tag,
  weight,
  style = {},
  children,
}) => {
  const baseStyle = TAG_STYLES[tag] || TAG_STYLES.body;

  const fontWeight: TextStyle["fontWeight"] =
    baseStyle.fontWeight ??
    (weight === "bold" ? "600" : weight === "medium" ? "500" : "400");

  const fontFamily =
    weight === "bold"
      ? "Inter_600SemiBold"
      : weight === "medium"
      ? "Inter_500Medium"
      : "Inter_400Regular";

  const textStyle: TextStyle = {
    ...baseStyle,
    fontWeight,
    color: Colors.text,
    fontFamily: fontFamily,
  };

  return <Text style={[textStyle, style]}>{children}</Text>;
};

export default TextUi;
