import { useCallback, useState, type ReactElement } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import type { ImageOverlayLayer } from 'react-native-video-burn-overlay';
import {
  IMAGE_LAYER_DIMENSION_MAX,
  IMAGE_LAYER_DIMENSION_MIN,
  IMAGE_LAYER_DIMENSION_STEP,
} from '../../constants/layerOptions';
import { BUNDLED_LAYER_ASSETS } from '../../utils/layerAssets';
import { copyPickedAssetToCache } from '../../utils/videoPaths';
import NumberStepperRow from './NumberStepperRow';

type ImageLayerPatch = Partial<
  Pick<ImageOverlayLayer, 'source' | 'width' | 'height'>
>;

interface ImageLayerFieldsProps {
  layer: ImageOverlayLayer;
  onChange: (patch: ImageLayerPatch) => void;
}

/** Image-specific fields: source (bundled or picked), width, height. */
export default function ImageLayerFields({
  layer,
  onChange,
}: ImageLayerFieldsProps): ReactElement {
  const [isPicking, setIsPicking] = useState(false);
  const [pickError, setPickError] = useState('');
  const width = layer.width ?? 160;
  const height = layer.height;

  const pickFromLibrary = useCallback(async (): Promise<void> => {
    const result = await launchImageLibrary({ mediaType: 'photo' });
    const asset = result.assets?.[0];
    if (!asset?.uri) {
      return; // user cancelled the picker
    }
    setIsPicking(true);
    setPickError('');
    try {
      const copiedPath = await copyPickedAssetToCache(asset, 'jpg');
      onChange({ source: copiedPath });
    } catch (error) {
      setPickError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsPicking(false);
    }
  }, [onChange]);

  const handlePickPress = useCallback((): void => {
    pickFromLibrary().catch(() => {
      // pickFromLibrary already reports failures via setPickError.
    });
  }, [pickFromLibrary]);

  return (
    <View>
      <Text style={styles.sectionLabel}>Source</Text>
      <View style={styles.chipRow}>
        {BUNDLED_LAYER_ASSETS.map((asset) => (
          <TouchableOpacity
            key={asset.path}
            onPress={() => onChange({ source: asset.path })}
            style={[
              styles.chip,
              layer.source === asset.path && styles.chipSelected,
            ]}
          >
            <Text
              style={[
                styles.chipText,
                layer.source === asset.path && styles.chipTextSelected,
              ]}
            >
              {asset.label}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={styles.chip}
          onPress={handlePickPress}
          disabled={isPicking}
        >
          <Text style={styles.chipText}>
            {isPicking ? 'Copying…' : 'Pick from library'}
          </Text>
        </TouchableOpacity>
      </View>
      {pickError ? <Text style={styles.errorText}>{pickError}</Text> : null}

      <NumberStepperRow
        label={`Width (${Math.round(width)}px)`}
        value={width}
        min={IMAGE_LAYER_DIMENSION_MIN}
        max={IMAGE_LAYER_DIMENSION_MAX}
        step={IMAGE_LAYER_DIMENSION_STEP}
        formatValue={(v) => `${Math.round(v)}px`}
        onChange={(next) => onChange({ width: next })}
      />

      <View style={styles.heightHeader}>
        <Text style={styles.sectionLabel}>
          {height === undefined
            ? 'Height (auto)'
            : `Height (${Math.round(height)}px)`}
        </Text>
        <TouchableOpacity
          style={styles.chip}
          onPress={() =>
            onChange({ height: height === undefined ? width : undefined })
          }
        >
          <Text style={styles.chipText}>
            {height === undefined ? 'Set height' : 'Use auto height'}
          </Text>
        </TouchableOpacity>
      </View>
      {height !== undefined ? (
        <NumberStepperRow
          label="Height"
          value={height}
          min={IMAGE_LAYER_DIMENSION_MIN}
          max={IMAGE_LAYER_DIMENSION_MAX}
          step={IMAGE_LAYER_DIMENSION_STEP}
          formatValue={(v) => `${Math.round(v)}px`}
          onChange={(next) => onChange({ height: next })}
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
  errorText: {
    fontSize: 12,
    color: '#FF3B30',
    marginBottom: 6,
  },
  heightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
