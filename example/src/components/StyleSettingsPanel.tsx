import type { ReactElement } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { OverlayPositionCoordinate } from '@rx/react-native-video-overlay';
import type { OverlayMode, ResolvedOverlayStyle } from '../types';
import {
  COORDINATE_STEP,
  DEFAULT_FONT_SIZE_PX,
  FONT_FAMILIES,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  FONT_SCALE_STEP,
  FONT_SIZE_PX_MAX,
  FONT_SIZE_PX_MIN,
  FONT_SIZE_PX_STEP,
  FONT_WEIGHTS,
  IMAGE_OVERLAY_DIMENSION_MAX,
  IMAGE_OVERLAY_DIMENSION_MIN,
  IMAGE_OVERLAY_DIMENSION_STEP,
  MARGIN_RATIO_MAX,
  MARGIN_RATIO_MIN,
  MARGIN_RATIO_STEP,
  OPACITY_MAX,
  OPACITY_MIN,
  OPACITY_STEP,
  POSITION_OPTIONS,
  STROKE_COLORS,
  TEXT_COLORS,
  clamp,
} from '../constants/styleOptions';

const DEFAULT_COORDINATE: OverlayPositionCoordinate = { x: 0.5, y: 0.5 };
const PRESET_ON_REVERT = 'bottomLeft';

// Precomputed once so the swatch style prop never gets a fresh inline object per render.
const TEXT_SWATCH_STYLES = TEXT_COLORS.map((color) => ({
  backgroundColor: color,
}));
const STROKE_SWATCH_STYLES = STROKE_COLORS.map((color) => ({
  backgroundColor: color,
}));

interface StyleSettingsPanelProps {
  visible: boolean;
  /** Which control set to render; text-only controls are hidden in image mode (no effect there). */
  mode: OverlayMode;
  style: ResolvedOverlayStyle;
  onChange: (next: ResolvedOverlayStyle) => void;
  onClose: () => void;
  /** `'image'` mode only — the picked-photo capture box size (see `PickedImageOverlay`). */
  imageOverlayWidth: number;
  imageOverlayHeight: number;
  onImageOverlayWidthChange: (next: number) => void;
  onImageOverlayHeightChange: (next: number) => void;
}

export default function StyleSettingsPanel({
  visible,
  mode,
  style,
  onChange,
  onClose,
  imageOverlayWidth,
  imageOverlayHeight,
  onImageOverlayWidthChange,
  onImageOverlayHeightChange,
}: StyleSettingsPanelProps): ReactElement {
  const insets = useSafeAreaInsets();
  const patch = (partial: Partial<ResolvedOverlayStyle>): void =>
    onChange({ ...style, ...partial });

  const isCustomPosition = typeof style.position === 'object';
  const coordinate: OverlayPositionCoordinate = isCustomPosition
    ? (style.position as OverlayPositionCoordinate)
    : DEFAULT_COORDINATE;
  const isNoStroke = style.strokeWidth === 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Overlay Settings</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.doneText}>Done</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={[
              styles.content,
              { paddingBottom: 32 + insets.bottom },
            ]}
          >
            {mode === 'text' ? (
              <>
                <Text style={styles.sectionLabel}>Text Color</Text>
                <View style={styles.swatchRow}>
                  {TEXT_COLORS.map((color, index) => (
                    <TouchableOpacity
                      key={color}
                      onPress={() => patch({ textColor: color })}
                      style={[
                        styles.swatch,
                        TEXT_SWATCH_STYLES[index],
                        style.textColor === color && styles.swatchSelected,
                      ]}
                    />
                  ))}
                </View>

                <Text style={styles.sectionLabel}>Stroke Color</Text>
                <View style={styles.swatchRow}>
                  {STROKE_COLORS.map((color, index) => (
                    <TouchableOpacity
                      key={color}
                      // Picking a color re-enables the stroke if "No Stroke" was active.
                      onPress={() =>
                        patch({ strokeColor: color, strokeWidth: undefined })
                      }
                      style={[
                        styles.swatch,
                        STROKE_SWATCH_STYLES[index],
                        style.strokeColor === color &&
                          !isNoStroke &&
                          styles.swatchSelected,
                      ]}
                    />
                  ))}
                  <TouchableOpacity
                    onPress={() =>
                      patch({ strokeWidth: isNoStroke ? undefined : 0 })
                    }
                    style={[styles.chip, isNoStroke && styles.chipSelected]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        isNoStroke && styles.chipTextSelected,
                      ]}
                    >
                      No Stroke
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.sectionLabel}>Font Family</Text>
                <View style={styles.chipRow}>
                  {FONT_FAMILIES.map((font) => (
                    <TouchableOpacity
                      key={font.label}
                      onPress={() => patch({ fontFamily: font.value })}
                      style={[
                        styles.chip,
                        style.fontFamily === font.value && styles.chipSelected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          style.fontFamily === font.value &&
                            styles.chipTextSelected,
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
                      onPress={() => patch({ fontWeight: weight.value })}
                      style={[
                        styles.chip,
                        style.fontWeight === weight.value &&
                          styles.chipSelected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          style.fontWeight === weight.value &&
                            styles.chipTextSelected,
                        ]}
                      >
                        {weight.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={styles.positionHeaderRow}>
                  <Text style={styles.sectionLabel}>
                    {style.fontSize === undefined
                      ? `Font Scale (${style.fontScale.toFixed(1)}x)`
                      : `Font Size (${Math.round(style.fontSize)}px)`}
                  </Text>
                  <TouchableOpacity
                    style={styles.chip}
                    onPress={() =>
                      patch({
                        // Switching to fixed seeds fontSize with a default; switching back to auto clears it entirely.
                        fontSize:
                          style.fontSize === undefined
                            ? DEFAULT_FONT_SIZE_PX
                            : undefined,
                      })
                    }
                  >
                    <Text style={styles.chipText}>
                      {style.fontSize === undefined
                        ? 'Use fixed size'
                        : 'Use auto scale'}
                    </Text>
                  </TouchableOpacity>
                </View>
                {style.fontSize === undefined ? (
                  <View style={styles.stepperRow}>
                    <TouchableOpacity
                      style={styles.stepperButton}
                      onPress={() =>
                        patch({
                          fontScale: clamp(
                            style.fontScale - FONT_SCALE_STEP,
                            FONT_SCALE_MIN,
                            FONT_SCALE_MAX
                          ),
                        })
                      }
                    >
                      <Text style={styles.stepperText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.stepperValue}>
                      {style.fontScale.toFixed(1)}x
                    </Text>
                    <TouchableOpacity
                      style={styles.stepperButton}
                      onPress={() =>
                        patch({
                          fontScale: clamp(
                            style.fontScale + FONT_SCALE_STEP,
                            FONT_SCALE_MIN,
                            FONT_SCALE_MAX
                          ),
                        })
                      }
                    >
                      <Text style={styles.stepperText}>+</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.stepperRow}>
                    <TouchableOpacity
                      style={styles.stepperButton}
                      onPress={() =>
                        patch({
                          fontSize: clamp(
                            style.fontSize! - FONT_SIZE_PX_STEP,
                            FONT_SIZE_PX_MIN,
                            FONT_SIZE_PX_MAX
                          ),
                        })
                      }
                    >
                      <Text style={styles.stepperText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.stepperValue}>
                      {Math.round(style.fontSize)}px
                    </Text>
                    <TouchableOpacity
                      style={styles.stepperButton}
                      onPress={() =>
                        patch({
                          fontSize: clamp(
                            style.fontSize! + FONT_SIZE_PX_STEP,
                            FONT_SIZE_PX_MIN,
                            FONT_SIZE_PX_MAX
                          ),
                        })
                      }
                    >
                      <Text style={styles.stepperText}>+</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            ) : (
              <>
                <Text style={styles.sectionLabel}>
                  Overlay Width ({Math.round(imageOverlayWidth)}px)
                </Text>
                <View style={styles.stepperRow}>
                  <TouchableOpacity
                    style={styles.stepperButton}
                    onPress={() =>
                      onImageOverlayWidthChange(
                        clamp(
                          imageOverlayWidth - IMAGE_OVERLAY_DIMENSION_STEP,
                          IMAGE_OVERLAY_DIMENSION_MIN,
                          IMAGE_OVERLAY_DIMENSION_MAX
                        )
                      )
                    }
                  >
                    <Text style={styles.stepperText}>−</Text>
                  </TouchableOpacity>
                  <Text style={styles.stepperValue}>
                    {Math.round(imageOverlayWidth)}px
                  </Text>
                  <TouchableOpacity
                    style={styles.stepperButton}
                    onPress={() =>
                      onImageOverlayWidthChange(
                        clamp(
                          imageOverlayWidth + IMAGE_OVERLAY_DIMENSION_STEP,
                          IMAGE_OVERLAY_DIMENSION_MIN,
                          IMAGE_OVERLAY_DIMENSION_MAX
                        )
                      )
                    }
                  >
                    <Text style={styles.stepperText}>+</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.sectionLabel}>
                  Overlay Height ({Math.round(imageOverlayHeight)}px)
                </Text>
                <View style={styles.stepperRow}>
                  <TouchableOpacity
                    style={styles.stepperButton}
                    onPress={() =>
                      onImageOverlayHeightChange(
                        clamp(
                          imageOverlayHeight - IMAGE_OVERLAY_DIMENSION_STEP,
                          IMAGE_OVERLAY_DIMENSION_MIN,
                          IMAGE_OVERLAY_DIMENSION_MAX
                        )
                      )
                    }
                  >
                    <Text style={styles.stepperText}>−</Text>
                  </TouchableOpacity>
                  <Text style={styles.stepperValue}>
                    {Math.round(imageOverlayHeight)}px
                  </Text>
                  <TouchableOpacity
                    style={styles.stepperButton}
                    onPress={() =>
                      onImageOverlayHeightChange(
                        clamp(
                          imageOverlayHeight + IMAGE_OVERLAY_DIMENSION_STEP,
                          IMAGE_OVERLAY_DIMENSION_MIN,
                          IMAGE_OVERLAY_DIMENSION_MAX
                        )
                      )
                    }
                  >
                    <Text style={styles.stepperText}>+</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            <Text style={styles.sectionLabel}>
              Opacity ({Math.round(style.opacity * 100)}%)
            </Text>
            <View style={styles.stepperRow}>
              <TouchableOpacity
                style={styles.stepperButton}
                onPress={() =>
                  patch({
                    opacity: clamp(
                      style.opacity - OPACITY_STEP,
                      OPACITY_MIN,
                      OPACITY_MAX
                    ),
                  })
                }
              >
                <Text style={styles.stepperText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.stepperValue}>
                {Math.round(style.opacity * 100)}%
              </Text>
              <TouchableOpacity
                style={styles.stepperButton}
                onPress={() =>
                  patch({
                    opacity: clamp(
                      style.opacity + OPACITY_STEP,
                      OPACITY_MIN,
                      OPACITY_MAX
                    ),
                  })
                }
              >
                <Text style={styles.stepperText}>+</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionLabel}>
              Margin ({Math.round(style.marginRatio * 100)}%)
            </Text>
            <View style={styles.stepperRow}>
              <TouchableOpacity
                style={styles.stepperButton}
                onPress={() =>
                  patch({
                    marginRatio: clamp(
                      style.marginRatio - MARGIN_RATIO_STEP,
                      MARGIN_RATIO_MIN,
                      MARGIN_RATIO_MAX
                    ),
                  })
                }
              >
                <Text style={styles.stepperText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.stepperValue}>
                {Math.round(style.marginRatio * 100)}%
              </Text>
              <TouchableOpacity
                style={styles.stepperButton}
                onPress={() =>
                  patch({
                    marginRatio: clamp(
                      style.marginRatio + MARGIN_RATIO_STEP,
                      MARGIN_RATIO_MIN,
                      MARGIN_RATIO_MAX
                    ),
                  })
                }
              >
                <Text style={styles.stepperText}>+</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.positionHeaderRow}>
              <Text style={styles.sectionLabel}>Position</Text>
              <TouchableOpacity
                style={[styles.chip, isCustomPosition && styles.chipSelected]}
                onPress={() =>
                  patch({
                    position: isCustomPosition
                      ? PRESET_ON_REVERT
                      : DEFAULT_COORDINATE,
                  })
                }
              >
                <Text
                  style={[
                    styles.chipText,
                    isCustomPosition && styles.chipTextSelected,
                  ]}
                >
                  Custom X/Y
                </Text>
              </TouchableOpacity>
            </View>

            {isCustomPosition ? (
              <View>
                <Text style={styles.coordinateLabel}>
                  X: {coordinate.x.toFixed(2)}
                </Text>
                <View style={styles.stepperRow}>
                  <TouchableOpacity
                    style={styles.stepperButton}
                    onPress={() =>
                      patch({
                        position: {
                          ...coordinate,
                          x: clamp(coordinate.x - COORDINATE_STEP, 0, 1),
                        },
                      })
                    }
                  >
                    <Text style={styles.stepperText}>−</Text>
                  </TouchableOpacity>
                  <Text style={styles.stepperValue}>
                    {coordinate.x.toFixed(2)}
                  </Text>
                  <TouchableOpacity
                    style={styles.stepperButton}
                    onPress={() =>
                      patch({
                        position: {
                          ...coordinate,
                          x: clamp(coordinate.x + COORDINATE_STEP, 0, 1),
                        },
                      })
                    }
                  >
                    <Text style={styles.stepperText}>+</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.coordinateLabel}>
                  Y: {coordinate.y.toFixed(2)}
                </Text>
                <View style={styles.stepperRow}>
                  <TouchableOpacity
                    style={styles.stepperButton}
                    onPress={() =>
                      patch({
                        position: {
                          ...coordinate,
                          y: clamp(coordinate.y - COORDINATE_STEP, 0, 1),
                        },
                      })
                    }
                  >
                    <Text style={styles.stepperText}>−</Text>
                  </TouchableOpacity>
                  <Text style={styles.stepperValue}>
                    {coordinate.y.toFixed(2)}
                  </Text>
                  <TouchableOpacity
                    style={styles.stepperButton}
                    onPress={() =>
                      patch({
                        position: {
                          ...coordinate,
                          y: clamp(coordinate.y + COORDINATE_STEP, 0, 1),
                        },
                      })
                    }
                  >
                    <Text style={styles.stepperText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.positionGrid}>
                {POSITION_OPTIONS.map((option) => (
                  <TouchableOpacity
                    key={option.value}
                    onPress={() => patch({ position: option.value })}
                    style={[
                      styles.positionButton,
                      style.position === option.value && styles.chipSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        style.position === option.value &&
                          styles.chipTextSelected,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  sheet: {
    maxHeight: '75%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#C6C6C8',
  },
  title: {
    color: '#1C1C1E',
    fontSize: 16,
    fontWeight: '600',
  },
  doneText: {
    color: '#007AFF',
    fontSize: 15,
    fontWeight: '600',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  sectionLabel: {
    color: '#6C6C70',
    fontSize: 13,
    marginTop: 16,
    marginBottom: 8,
  },
  positionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  swatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#C6C6C8',
  },
  swatchSelected: {
    borderWidth: 3,
    borderColor: '#007AFF',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepperButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E5E5EA',
  },
  stepperText: {
    color: '#1C1C1E',
    fontSize: 20,
    lineHeight: 22,
  },
  stepperValue: {
    color: '#1C1C1E',
    fontSize: 15,
    width: 72,
    textAlign: 'center',
  },
  coordinateLabel: {
    color: '#6C6C70',
    fontSize: 12,
    marginBottom: 4,
  },
  positionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  positionButton: {
    width: '31%',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#E5E5EA',
    marginBottom: 8,
  },
});
