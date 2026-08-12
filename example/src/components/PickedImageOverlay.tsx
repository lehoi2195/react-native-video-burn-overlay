import type { ReactElement } from 'react';
import { Image, StyleSheet } from 'react-native';

interface PickedImageOverlayProps {
  /** Filesystem path or `file://` uri of the picked photo, as returned by `react-native-image-picker`. */
  uri: string;
  /** Capture box width/height in px — independent, so the box needn't be square. */
  width: number;
  height: number;
}

/** Resizes the photo via RN's Image scaling, since native composites images at original size unscaled. */
export default function PickedImageOverlay({
  uri,
  width,
  height,
}: PickedImageOverlayProps): ReactElement {
  // Android's Image requires a URI scheme — a bare cache path (from copyPickedAssetToCache) renders nothing.
  const resolvedUri = uri.includes('://') ? uri : `file://${uri}`;
  return (
    <Image
      source={{ uri: resolvedUri }}
      style={[styles.image, { width, height }]}
      resizeMode="cover"
    />
  );
}

const styles = StyleSheet.create({
  image: {
    borderRadius: 8,
  },
});
