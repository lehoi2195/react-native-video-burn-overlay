import type { ReactElement } from 'react';
import { Image, Text } from 'react-native';
import type { EditableLayer } from '../../types';
import { computePreviewFontSize } from '../../utils/layerPreviewMath';

interface FrameSize {
  width: number;
  height: number;
}

interface LayerVisualProps {
  layer: EditableLayer;
  frameSize: FrameSize;
  sourceWidth: number | undefined;
  /** Extra multiplier on top of the layer's own size, applied per-tile when tiled. */
  scaleMultiplier?: number;
}

function resolveUri(path: string): string {
  return path.includes('://') ? path : `file://${path}`;
}

const FALLBACK_IMAGE_SIZE = 80;

/** Pixel content of one layer: image bitmap or styled text, unpositioned. */
export default function LayerVisual({
  layer,
  frameSize,
  sourceWidth,
  scaleMultiplier = 1,
}: LayerVisualProps): ReactElement {
  if (layer.type === 'image') {
    const width = (layer.width ?? FALLBACK_IMAGE_SIZE) * scaleMultiplier;
    const height = (layer.height ?? width) * scaleMultiplier;
    return (
      <Image
        source={{ uri: resolveUri(layer.source) }}
        style={{ width, height }}
        resizeMode={layer.height !== undefined ? 'stretch' : 'cover'}
      />
    );
  }

  const fontSize =
    computePreviewFontSize(
      frameSize.width,
      frameSize.height,
      layer.fontSize,
      layer.fontScale,
      sourceWidth
    ) * scaleMultiplier;
  const strokeWidth = layer.strokeWidth ?? fontSize * 0.06;

  return (
    <Text
      allowFontScaling={false}
      numberOfLines={1}
      style={{
        fontSize,
        color: layer.fontColor ?? '#FFFFFF',
        fontFamily: layer.fontFamily,
        fontWeight: layer.fontWeight,
        textShadowColor: layer.strokeColor ?? '#000000',
        textShadowRadius: strokeWidth === 0 ? 0 : Math.max(1, strokeWidth),
        textShadowOffset: { width: 0, height: 0 },
      }}
    >
      {layer.text || ' '}
    </Text>
  );
}
