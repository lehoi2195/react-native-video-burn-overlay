import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TileConfig } from 'react-native-video-burn-overlay';
import {
  DEFAULT_TILE_ANGLE,
  DEFAULT_TILE_SCALE,
  DEFAULT_TILE_SPACING,
  ROTATION_MAX,
  ROTATION_MIN,
  ROTATION_STEP,
  TILE_SCALE_MAX,
  TILE_SCALE_MIN,
  TILE_SCALE_STEP,
  TILE_SPACING_MAX,
  TILE_SPACING_MIN,
  TILE_SPACING_STEP,
} from '../../constants/layerOptions';
import BooleanChip from './BooleanChip';
import NumberStepperRow from './NumberStepperRow';
import PositionPicker from './PositionPicker';

interface TileFieldsProps {
  tile: TileConfig | undefined;
  onTileChange: (next: TileConfig | undefined) => void;
}

const DEFAULT_TILE: TileConfig = {
  angle: DEFAULT_TILE_ANGLE,
  spacingX: DEFAULT_TILE_SPACING,
  spacingY: DEFAULT_TILE_SPACING,
  anchor: 'center',
  scale: DEFAULT_TILE_SCALE,
  stagger: false,
};

/** Tile on/off toggle plus angle/spacingX/spacingY/anchor/scale/stagger when enabled. */
export default function TileFields({
  tile,
  onTileChange,
}: TileFieldsProps): ReactElement {
  const isTiled = tile !== undefined;

  const patch = (partial: Partial<TileConfig>): void => {
    onTileChange({ ...DEFAULT_TILE, ...tile, ...partial });
  };

  return (
    <View>
      <View style={styles.headerRow}>
        <Text style={styles.sectionLabel}>Tile (repeat watermark)</Text>
        <BooleanChip
          label={isTiled ? 'Tiled' : 'Single'}
          value={isTiled}
          onToggle={(next) => onTileChange(next ? DEFAULT_TILE : undefined)}
        />
      </View>

      {isTiled ? (
        <View>
          <NumberStepperRow
            label={`Angle (${Math.round(tile.angle ?? 0)}°)`}
            value={tile.angle ?? 0}
            min={ROTATION_MIN}
            max={ROTATION_MAX}
            step={ROTATION_STEP}
            formatValue={(v) => `${Math.round(v)}°`}
            onChange={(next) => patch({ angle: next })}
          />

          <NumberStepperRow
            label={`Spacing X (${(tile.spacingX ?? 0.25).toFixed(2)})`}
            value={tile.spacingX ?? 0.25}
            min={TILE_SPACING_MIN}
            max={TILE_SPACING_MAX}
            step={TILE_SPACING_STEP}
            formatValue={(v) => v.toFixed(2)}
            onChange={(next) => patch({ spacingX: next })}
          />

          <NumberStepperRow
            label={`Spacing Y (${(tile.spacingY ?? 0.25).toFixed(2)})`}
            value={tile.spacingY ?? 0.25}
            min={TILE_SPACING_MIN}
            max={TILE_SPACING_MAX}
            step={TILE_SPACING_STEP}
            formatValue={(v) => v.toFixed(2)}
            onChange={(next) => patch({ spacingY: next })}
          />

          <NumberStepperRow
            label={`Scale (${(tile.scale ?? 1).toFixed(1)}x)`}
            value={tile.scale ?? 1}
            min={TILE_SCALE_MIN}
            max={TILE_SCALE_MAX}
            step={TILE_SCALE_STEP}
            formatValue={(v) => `${v.toFixed(1)}x`}
            onChange={(next) => patch({ scale: next })}
          />

          <View style={styles.staggerRow}>
            <BooleanChip
              label="Stagger rows"
              value={tile.stagger ?? false}
              onToggle={(next) => patch({ stagger: next })}
            />
          </View>

          <Text style={styles.sectionLabel}>Grid anchor</Text>
          <PositionPicker
            value={tile.anchor ?? 'center'}
            onChange={(next) => patch({ anchor: next })}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  sectionLabel: {
    color: '#6C6C70',
    fontSize: 12,
    marginBottom: 6,
  },
  staggerRow: {
    marginTop: 6,
  },
});
