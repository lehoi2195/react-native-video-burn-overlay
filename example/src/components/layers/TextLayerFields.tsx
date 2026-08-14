import type { ReactElement } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { TextOverlayLayer } from 'react-native-video-burn-overlay';
import {
  DEFAULT_FONT_SIZE_PX,
  FONT_FAMILIES,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  FONT_SCALE_STEP,
  FONT_SIZE_PX_MAX,
  FONT_SIZE_PX_MIN,
  FONT_SIZE_PX_STEP,
  FONT_WEIGHTS,
  STROKE_COLORS,
  TEXT_COLORS,
} from '../../constants/styleOptions';
import BooleanChip from './BooleanChip';
import NumberStepperRow from './NumberStepperRow';

type TextLayerPatch = Partial<
  Pick<
    TextOverlayLayer,
    | 'text'
    | 'fontSize'
    | 'fontScale'
    | 'fontColor'
    | 'strokeColor'
    | 'strokeWidth'
    | 'fontFamily'
    | 'fontWeight'
  >
>;

interface TextLayerFieldsProps {
  layer: TextOverlayLayer;
  onChange: (patch: TextLayerPatch) => void;
}

/** Text-specific fields: content, font size/scale, colors, stroke, family, weight. */
export default function TextLayerFields({
  layer,
  onChange,
}: TextLayerFieldsProps): ReactElement {
  const fontColor = layer.fontColor ?? '#FFFFFF';
  const strokeColor = layer.strokeColor ?? '#000000';
  const isNoStroke = layer.strokeWidth === 0;
  const isFixedSize = layer.fontSize !== undefined;

  return (
    <View>
      <Text style={styles.sectionLabel}>Text</Text>
      <TextInput
        value={layer.text}
        onChangeText={(text) => onChange({ text })}
        style={styles.textInput}
        placeholder="Layer text"
        placeholderTextColor="#8E8E93"
        multiline
      />

      <Text style={styles.sectionLabel}>Font Color</Text>
      <View style={styles.chipRow}>
        {TEXT_COLORS.map((color) => (
          <TouchableOpacity
            key={color}
            onPress={() => onChange({ fontColor: color })}
            style={[
              styles.swatch,
              { backgroundColor: color },
              fontColor === color && styles.swatchSelected,
            ]}
          />
        ))}
      </View>

      <Text style={styles.sectionLabel}>Stroke Color</Text>
      <View style={styles.chipRow}>
        {STROKE_COLORS.map((color) => (
          <TouchableOpacity
            key={color}
            onPress={() =>
              onChange({ strokeColor: color, strokeWidth: undefined })
            }
            style={[
              styles.swatch,
              { backgroundColor: color },
              strokeColor === color && !isNoStroke && styles.swatchSelected,
            ]}
          />
        ))}
        <BooleanChip
          label="No Stroke"
          value={isNoStroke}
          onToggle={(next) => onChange({ strokeWidth: next ? 0 : undefined })}
        />
      </View>

      <Text style={styles.sectionLabel}>Font Family</Text>
      <View style={styles.chipRow}>
        {FONT_FAMILIES.map((font) => (
          <TouchableOpacity
            key={font.label}
            onPress={() => onChange({ fontFamily: font.value })}
            style={[
              styles.chip,
              layer.fontFamily === font.value && styles.chipSelected,
            ]}
          >
            <Text
              style={[
                styles.chipText,
                layer.fontFamily === font.value && styles.chipTextSelected,
              ]}
            >
              {font.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionLabel}>Font Weight</Text>
      <View style={styles.chipRow}>
        {FONT_WEIGHTS.map((weight) => (
          <TouchableOpacity
            key={weight.value}
            onPress={() => onChange({ fontWeight: weight.value })}
            style={[
              styles.chip,
              layer.fontWeight === weight.value && styles.chipSelected,
            ]}
          >
            <Text
              style={[
                styles.chipText,
                layer.fontWeight === weight.value && styles.chipTextSelected,
              ]}
            >
              {weight.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.headerRow}>
        <Text style={styles.sectionLabel}>
          {isFixedSize
            ? `Font Size (${Math.round(layer.fontSize!)}px)`
            : `Font Scale (${(layer.fontScale ?? 1).toFixed(1)}x)`}
        </Text>
        <TouchableOpacity
          style={styles.chip}
          onPress={() =>
            onChange({
              fontSize: isFixedSize ? undefined : DEFAULT_FONT_SIZE_PX,
              fontScale: isFixedSize ? undefined : layer.fontScale,
            })
          }
        >
          <Text style={styles.chipText}>
            {isFixedSize ? 'Use auto scale' : 'Use fixed size'}
          </Text>
        </TouchableOpacity>
      </View>
      {isFixedSize ? (
        <NumberStepperRow
          label="Font size"
          value={layer.fontSize!}
          min={FONT_SIZE_PX_MIN}
          max={FONT_SIZE_PX_MAX}
          step={FONT_SIZE_PX_STEP}
          formatValue={(v) => `${Math.round(v)}px`}
          onChange={(next) => onChange({ fontSize: next })}
        />
      ) : (
        <NumberStepperRow
          label="Font scale"
          value={layer.fontScale ?? 1}
          min={FONT_SCALE_MIN}
          max={FONT_SCALE_MAX}
          step={FONT_SCALE_STEP}
          formatValue={(v) => `${v.toFixed(1)}x`}
          onChange={(next) => onChange({ fontScale: next })}
        />
      )}

      <NumberStepperRow
        label={`Stroke Width (${layer.strokeWidth ?? 'auto'})`}
        value={layer.strokeWidth ?? 0}
        min={0}
        max={20}
        step={1}
        formatValue={(v) => `${Math.round(v)}px`}
        onChange={(next) => onChange({ strokeWidth: next })}
      />
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
  textInput: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#C6C6C8',
    backgroundColor: '#FFFFFF',
    color: '#1C1C1E',
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    minHeight: 44,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#E5E5EA',
    marginRight: 8,
    marginBottom: 8,
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
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#C6C6C8',
  },
  swatchSelected: {
    borderWidth: 3,
    borderColor: '#007AFF',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
