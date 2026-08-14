import type { ReactElement } from 'react';
import { View } from 'react-native';
import type { EditableLayer } from '../../types';
import { computeTileGridLayout } from '../../utils/layerPreviewMath';
import LayerVisual from './LayerVisual';

interface FrameSize {
  width: number;
  height: number;
}

interface TiledLayerOverlayProps {
  layer: EditableLayer;
  frameSize: FrameSize;
  sourceWidth: number | undefined;
}

/** Repeats the layer across the frame in a rotated grid, approximating the native tile shader. */
export default function TiledLayerOverlay({
  layer,
  frameSize,
  sourceWidth,
}: TiledLayerOverlayProps): ReactElement | null {
  if (!layer.tile) {
    return null;
  }
  const grid = computeTileGridLayout(
    frameSize.width,
    frameSize.height,
    layer.tile
  );
  const scale = layer.tile.scale ?? 1;

  const items = [];
  // Native indexes rows from the anchor row outward and never offsets it.
  const centerRow = (grid.rows - 1) / 2;
  for (let row = 0; row < grid.rows; row += 1) {
    const rowFromCenter = row - centerRow;
    const isStaggeredRow = ((rowFromCenter % 2) + 2) % 2 === 1;
    for (let col = 0; col < grid.columns; col += 1) {
      const staggerX = isStaggeredRow ? grid.staggerOffsetPx : 0;
      items.push(
        <View
          key={`${row}-${col}`}
          style={{
            position: 'absolute',
            left: col * grid.spacingXpx + staggerX,
            top: row * grid.spacingYpx,
            transform: [{ rotate: `${layer.rotation ?? 0}deg` }],
          }}
        >
          <LayerVisual
            layer={layer}
            frameSize={frameSize}
            sourceWidth={sourceWidth}
            scaleMultiplier={scale}
          />
        </View>
      );
    }
  }

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: grid.centerLeft - grid.boxWidth / 2,
        top: grid.centerTop - grid.boxHeight / 2,
        width: grid.boxWidth,
        height: grid.boxHeight,
        opacity: layer.opacity ?? 1,
        transform: [{ rotate: `${grid.angleDeg}deg` }],
      }}
    >
      {items}
    </View>
  );
}
