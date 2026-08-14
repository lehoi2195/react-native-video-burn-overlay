import { useCallback, useState, type ReactElement } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import type { EditableLayer } from '../../types';
import { computeOverlayAnchor } from '../../utils/overlayAnchor';
import LayerVisual from './LayerVisual';

interface FrameSize {
  width: number;
  height: number;
}

const ZERO: FrameSize = { width: 0, height: 0 };

interface SingleLayerOverlayProps {
  layer: EditableLayer;
  frameSize: FrameSize;
  sourceWidth: number | undefined;
}

/** Positions one non-tiled layer at its resolved anchor, with its own opacity and rotation. */
export default function SingleLayerOverlay({
  layer,
  frameSize,
  sourceWidth,
}: SingleLayerOverlayProps): ReactElement {
  const [contentSize, setContentSize] = useState<FrameSize>(ZERO);

  const handleLayout = useCallback((event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout;
    setContentSize((previous) =>
      previous.width === width && previous.height === height
        ? previous
        : { width, height }
    );
  }, []);

  const isReady = frameSize.width > 0 && contentSize.width > 0;
  const anchor = computeOverlayAnchor(
    layer.position ?? 'bottomLeft',
    frameSize.width,
    frameSize.height,
    contentSize.width,
    contentSize.height,
    layer.marginRatio ?? 0.05
  );

  return (
    <View
      onLayout={handleLayout}
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: anchor.left,
        top: anchor.top,
        opacity: isReady ? (layer.opacity ?? 1) : 0,
        transform: [{ rotate: `${layer.rotation ?? 0}deg` }],
      }}
    >
      <LayerVisual
        layer={layer}
        frameSize={frameSize}
        sourceWidth={sourceWidth}
      />
    </View>
  );
}
