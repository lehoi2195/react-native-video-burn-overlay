import type { ReactElement } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type {
  OverlayPosition,
  OverlayPositionCoordinate,
} from 'react-native-video-burn-overlay';
import {
  COORDINATE_STEP,
  POSITION_OPTIONS,
  clamp,
} from '../../constants/styleOptions';
import NumberStepperRow from './NumberStepperRow';

const DEFAULT_COORDINATE: OverlayPositionCoordinate = { x: 0.5, y: 0.5 };

interface PositionPickerProps {
  value: OverlayPosition;
  onChange: (next: OverlayPosition) => void;
}

/** All 9 presets plus custom {x,y}; reused for both layer.position and tile.anchor. */
export default function PositionPicker({
  value,
  onChange,
}: PositionPickerProps): ReactElement {
  const isCustom = typeof value === 'object';
  const coordinate = isCustom ? value : DEFAULT_COORDINATE;

  return (
    <View>
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={[styles.chip, isCustom && styles.chipSelected]}
          onPress={() => onChange(isCustom ? 'bottomLeft' : DEFAULT_COORDINATE)}
        >
          <Text style={[styles.chipText, isCustom && styles.chipTextSelected]}>
            Custom X/Y
          </Text>
        </TouchableOpacity>
      </View>

      {isCustom ? (
        <View>
          <NumberStepperRow
            label={`X: ${coordinate.x.toFixed(2)}`}
            value={coordinate.x}
            min={0}
            max={1}
            step={COORDINATE_STEP}
            formatValue={(v) => v.toFixed(2)}
            onChange={(x) => onChange({ ...coordinate, x: clamp(x, 0, 1) })}
          />
          <NumberStepperRow
            label={`Y: ${coordinate.y.toFixed(2)}`}
            value={coordinate.y}
            min={0}
            max={1}
            step={COORDINATE_STEP}
            formatValue={(v) => v.toFixed(2)}
            onChange={(y) => onChange({ ...coordinate, y: clamp(y, 0, 1) })}
          />
        </View>
      ) : (
        <View style={styles.grid}>
          {POSITION_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.value}
              onPress={() => onChange(option.value)}
              style={[
                styles.gridButton,
                value === option.value && styles.chipSelected,
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  value === option.value && styles.chipTextSelected,
                ]}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 8,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#E5E5EA',
  },
  chipSelected: {
    backgroundColor: '#007AFF',
  },
  chipText: {
    color: '#1C1C1E',
    fontSize: 13,
  },
  chipTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  gridButton: {
    width: '31%',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#E5E5EA',
    marginBottom: 8,
  },
});
