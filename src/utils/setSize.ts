import { Dimensions, PixelRatio } from "react-native";

const fontScale = PixelRatio.getFontScale();

const pixelRatio = PixelRatio.get();

const defaultPixel = 2;

const w2 = 750 / defaultPixel;
const h2 = 1334 / defaultPixel;

const scale = Math.min(
  Dimensions.get("window").height / w2,
  Dimensions.get("window").width / h2
);

const fs = (size: number) => {
  let _size = Math.round(((size * scale + 0.5) * pixelRatio) / fontScale);
  return _size / pixelRatio;
};

const scaleSize = (size: number) => {
  let _size = Math.round(size * scale + 0.5);
  return _size;
};

const px = (size: number) => {
  return Math.floor(scaleSize(size));
};

export { fs, px, scaleSize };

