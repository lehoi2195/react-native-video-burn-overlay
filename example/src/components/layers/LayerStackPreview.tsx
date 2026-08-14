import { useCallback, useState, type ReactElement } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import type { EditableLayer } from '../../types';
import SingleLayerOverlay from './SingleLayerOverlay';
import TiledLayerOverlay from './TiledLayerOverlay';
import VideoFrame from './VideoFrame';

interface FrameSize {
  width: number;
  height: number;
}

const ZERO: FrameSize = { width: 0, height: 0 };

interface LayerStackPreviewProps {
  layers: EditableLayer[];
  sourcePath: string;
  aspectRatio: number;
  sourceWidth: number | undefined;
}

/** Renders the whole layer stack over a video thumbnail, bottom layer first. */
export default function LayerStackPreview({
  layers,
  sourcePath,
  aspectRatio,
  sourceWidth,
}: LayerStackPreviewProps): ReactElement {
  const [frameSize, setFrameSize] = useState<FrameSize>(ZERO);

  const handleFrameLayout = useCallback((event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout;
    setFrameSize({ width, height });
  }, []);

  return (
    <VideoFrame
      aspectRatio={aspectRatio}
      sourcePath={sourcePath}
      onFrameLayout={handleFrameLayout}
    >
      <View style={styles.fill} pointerEvents="none">
        {layers.map((layer) =>
          layer.tile ? (
            <TiledLayerOverlay
              key={layer.id}
              layer={layer}
              frameSize={frameSize}
              sourceWidth={sourceWidth}
            />
          ) : (
            <SingleLayerOverlay
              key={layer.id}
              layer={layer}
              frameSize={frameSize}
              sourceWidth={sourceWidth}
            />
          )
        )}
      </View>
    </VideoFrame>
  );
}

const styles = StyleSheet.create({
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
