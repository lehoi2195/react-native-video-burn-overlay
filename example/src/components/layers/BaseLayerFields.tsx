import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { EditableLayer } from '../../types';
import {
  MARGIN_RATIO_MAX,
  MARGIN_RATIO_MIN,
  MARGIN_RATIO_STEP,
  OPACITY_MAX,
  OPACITY_MIN,
  OPACITY_STEP,
} from '../../constants/styleOptions';
import {
  ROTATION_MAX,
  ROTATION_MIN,
  ROTATION_STEP,
  TIME_SEC_MAX,
  TIME_SEC_MIN,
  TIME_SEC_STEP,
} from '../../constants/layerOptions';
import BooleanChip from './BooleanChip';
import NumberStepperRow from './NumberStepperRow';
import PositionPicker from './PositionPicker';

type BaseLayerPatch = Partial<
  Pick<
    EditableLayer,
    'position' | 'marginRatio' | 'opacity' | 'rotation' | 'startSec' | 'endSec'
  >
>;

interface BaseLayerFieldsProps {
  layer: EditableLayer;
  onChange: (patch: BaseLayerPatch) => void;
}

/** Fields every layer shares: position, opacity, rotation, marginRatio, time window. */
export default function BaseLayerFields({
  layer,
  onChange,
}: BaseLayerFieldsProps): ReactElement {
  const position = layer.position ?? 'bottomLeft';
  const opacity = layer.opacity ?? 1;
  const rotation = layer.rotation ?? 0;
  const marginRatio = layer.marginRatio ?? 0.05;
  const startSec = layer.startSec ?? 0;
  const hasEndSec = layer.endSec !== undefined;

  return (
    <View>
      <Text style={styles.sectionLabel}>Position</Text>
      <PositionPicker
        value={position}
        onChange={(next) => onChange({ position: next })}
      />

      <NumberStepperRow
        label={`Opacity (${Math.round(opacity * 100)}%)`}
        value={opacity}
        min={OPACITY_MIN}
        max={OPACITY_MAX}
        step={OPACITY_STEP}
        formatValue={(v) => `${Math.round(v * 100)}%`}
        onChange={(next) => onChange({ opacity: next })}
      />

      <NumberStepperRow
        label={`Rotation (${Math.round(rotation)}°)`}
        value={rotation}
        min={ROTATION_MIN}
        max={ROTATION_MAX}
        step={ROTATION_STEP}
        formatValue={(v) => `${Math.round(v)}°`}
        onChange={(next) => onChange({ rotation: next })}
      />

      <NumberStepperRow
        label={`Margin (${Math.round(marginRatio * 100)}%)`}
        value={marginRatio}
        min={MARGIN_RATIO_MIN}
        max={MARGIN_RATIO_MAX}
        step={MARGIN_RATIO_STEP}
        formatValue={(v) => `${Math.round(v * 100)}%`}
        onChange={(next) => onChange({ marginRatio: next })}
      />

      <NumberStepperRow
        label={`Start (${startSec}s)`}
        value={startSec}
        min={TIME_SEC_MIN}
        max={TIME_SEC_MAX}
        step={TIME_SEC_STEP}
        formatValue={(v) => `${Math.round(v)}s`}
        onChange={(next) => onChange({ startSec: next })}
      />

      <View style={styles.endSecHeader}>
        <Text style={styles.sectionLabel}>
          {hasEndSec ? `End (${layer.endSec}s)` : 'End (whole video)'}
        </Text>
        <BooleanChip
          label={hasEndSec ? 'Whole video' : 'Set end time'}
          value={hasEndSec}
          onToggle={(next) =>
            onChange({ endSec: next ? startSec + 5 : undefined })
          }
        />
      </View>
      {hasEndSec ? (
        <NumberStepperRow
          label="End time"
          value={layer.endSec!}
          min={TIME_SEC_MIN}
          max={TIME_SEC_MAX}
          step={TIME_SEC_STEP}
          formatValue={(v) => `${Math.round(v)}s`}
          onChange={(next) => onChange({ endSec: next })}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    color: '#6C6C70',
    fontSize: 12,
    marginTop: 10,
    marginBottom: 6,
  },
  endSecHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
