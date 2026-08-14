import type { ReactElement, ReactNode } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useVideoThumbnail } from '../../utils/useVideoThumbnail';

interface VideoFrameProps {
  aspectRatio: number;
  sourcePath: string;
  onFrameLayout: (event: LayoutChangeEvent) => void;
  children?: ReactNode;
}

/** Bordered preview frame showing a video thumbnail, clipping absolutely-positioned children. */
export default function VideoFrame({
  aspectRatio,
  sourcePath,
  onFrameLayout,
  children,
}: VideoFrameProps): ReactElement {
  const thumbnailUri = useVideoThumbnail(sourcePath);

  return (
    <View style={[styles.frame, { aspectRatio }]} onLayout={onFrameLayout}>
      {thumbnailUri ? (
        <Image
          source={{ uri: thumbnailUri }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      ) : (
        <Text style={styles.hintText}>Video frame preview</Text>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#C6C6C8',
    backgroundColor: '#E5E5EA',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  hintText: {
    color: '#8E8E93',
    fontSize: 13,
  },
});
