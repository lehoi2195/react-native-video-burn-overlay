import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { burnLayers, type OverlayLayer } from 'react-native-video-burn-overlay';
import LayerListEditor from '../components/layers/LayerListEditor';
import LayerStackPreview from '../components/layers/LayerStackPreview';
import PresetButtons from '../components/layers/PresetButtons';
import ResultPlayer from '../components/ResultPlayer';
import type { BurnStatus, EditableLayer } from '../types';
import { stripLayerId } from '../utils/layerFactory';
import {
  buildLogoCaptionPreset,
  buildStockWatermarkPreset,
} from '../utils/layerPresets';
import {
  copyPickedAssetToCache,
  deleteCachedAsset,
  outputPathFor,
  resolveNativeReadableSource,
} from '../utils/videoPaths';

const DEFAULT_ASPECT_RATIO = 16 / 9;

interface LayerBurnScreenProps {
  onBack: () => void;
}

/** Demo screen for burnLayers: edit a layer stack, preview it, burn it. */
export default function LayerBurnScreen({
  onBack,
}: LayerBurnScreenProps): ReactElement {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<BurnStatus>('idle');
  const [sourcePath, setSourcePath] = useState('');
  const [outputPath, setOutputPath] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [assetAspectRatio, setAssetAspectRatio] = useState<number | null>(null);
  const [assetWidth, setAssetWidth] = useState<number | null>(null);
  const [isProcessingPick, setIsProcessingPick] = useState(false);
  const [layers, setLayers] = useState<EditableLayer[]>(buildLogoCaptionPreset);

  // Lets a repeat pick delete the stale cache copy instead of leaking files.
  const previousPickedVideoPathRef = useRef<string | null>(null);

  const aspectRatio = assetAspectRatio ?? DEFAULT_ASPECT_RATIO;
  const isBurning = status === 'burning';
  const isBurnDisabled =
    !sourcePath || isBurning || isProcessingPick || layers.length === 0;

  const layerCountLabel = useMemo(() => {
    const tiled = layers.filter((layer) => layer.tile).length;
    return tiled > 0
      ? `${layers.length} layer(s), ${tiled} tiled`
      : `${layers.length} layer(s)`;
  }, [layers]);

  const pickVideo = useCallback(async (): Promise<void> => {
    const result = await launchImageLibrary({ mediaType: 'video' });
    const asset = result.assets?.[0];
    if (!asset?.uri) {
      return; // user cancelled the picker
    }

    setIsProcessingPick(true);
    setErrorMessage('');
    try {
      // Same defensive cache copy as the burnOverlay demo; raw picker paths are not writable.
      const copiedPath = await copyPickedAssetToCache(asset, 'mp4');
      if (previousPickedVideoPathRef.current) {
        deleteCachedAsset(previousPickedVideoPathRef.current);
      }
      previousPickedVideoPathRef.current = copiedPath;

      setSourcePath(copiedPath);
      setOutputPath('');
      setStatus('idle');
      setAssetAspectRatio(
        asset.width && asset.height ? asset.width / asset.height : null
      );
      setAssetWidth(asset.width ?? null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setStatus('error');
    } finally {
      setIsProcessingPick(false);
    }
  }, []);

  // Image sources may be http:// dev-server URLs; native decodes only real files.
  const resolveLayerForNative = useCallback(
    async (layer: OverlayLayer): Promise<OverlayLayer> => {
      if (layer.type !== 'image') {
        return layer;
      }
      return {
        ...layer,
        source: await resolveNativeReadableSource(layer.source),
      };
    },
    []
  );

  const handleBurn = useCallback(async (): Promise<void> => {
    if (!sourcePath) {
      return;
    }
    setErrorMessage('');
    setStatus('burning');
    try {
      const resolvedLayers = await Promise.all(
        layers.map(stripLayerId).map(resolveLayerForNative)
      );
      const resultPath = await burnLayers({
        inputPath: sourcePath,
        outputPath: outputPathFor(sourcePath),
        layers: resolvedLayers,
      });
      setOutputPath(resultPath);
      setStatus('done');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setStatus('error');
    }
  }, [sourcePath, layers, resolveLayerForNative]);

  const handleCloseResult = useCallback((): void => {
    setStatus('idle');
    setOutputPath('');
  }, []);

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.container,
          {
            paddingTop: Math.max(20, insets.top),
            paddingBottom: 20 + insets.bottom,
          },
        ]}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack}>
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>burnLayers</Text>
          <View style={styles.headerSpacer} />
        </View>

        <LayerStackPreview
          layers={layers}
          sourcePath={sourcePath}
          aspectRatio={aspectRatio}
          sourceWidth={assetWidth ?? undefined}
        />

        <Text style={styles.helperText}>
          {layerCountLabel} — drawn bottom-up, the first layer sits underneath.
        </Text>

        <PresetButtons
          onLogoCaption={() => setLayers(buildLogoCaptionPreset())}
          onStockWatermark={() => setLayers(buildStockWatermarkPreset())}
        />

        <LayerListEditor layers={layers} onLayersChange={setLayers} />

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={pickVideo}
          disabled={isBurning || isProcessingPick}
        >
          <Text style={styles.secondaryButtonText}>
            {isProcessingPick
              ? 'Copying…'
              : sourcePath
                ? 'Change video'
                : 'Pick video'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.primaryButton,
            isBurnDisabled && styles.primaryButtonDisabled,
          ]}
          onPress={handleBurn}
          disabled={isBurnDisabled}
        >
          <Text style={styles.primaryButtonText}>Burn layers</Text>
        </TouchableOpacity>

        {!sourcePath ? (
          <Text style={styles.helperText}>Pick a video to enable burning.</Text>
        ) : null}

        {status === 'error' ? (
          <Text style={styles.statusTextError}>Failed: {errorMessage}</Text>
        ) : null}
      </ScrollView>

      {isBurning ? (
        <View style={styles.burningBackdrop}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text style={styles.burningText}>Burning layers…</Text>
        </View>
      ) : null}

      <Modal
        visible={status === 'done'}
        animationType="slide"
        onRequestClose={handleCloseResult}
      >
        <View style={styles.root}>
          <View style={[styles.resultHeader, { paddingTop: 16 + insets.top }]}>
            <TouchableOpacity onPress={handleCloseResult}>
              <Text style={styles.backText}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Done</Text>
            <View style={styles.headerSpacer} />
          </View>
          <ScrollView
            contentContainerStyle={[
              styles.resultContent,
              { paddingBottom: 20 + insets.bottom },
            ]}
          >
            <Text style={styles.pathLabel}>Source:</Text>
            <Text style={styles.pathText}>{sourcePath}</Text>
            <Text style={styles.pathLabel}>Burned output:</Text>
            <Text style={styles.pathText}>{outputPath}</Text>
            <View style={styles.resultPlayerWrapper}>
              <ResultPlayer outputPath={outputPath} />
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  container: {
    flexGrow: 1,
    padding: 20,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSpacer: {
    width: 48,
  },
  backText: {
    color: '#007AFF',
    fontSize: 15,
    fontWeight: '600',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  helperText: {
    fontSize: 12,
    color: '#6C6C70',
    fontStyle: 'italic',
  },
  secondaryButton: {
    alignSelf: 'stretch',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#E5E5EA',
  },
  secondaryButtonText: {
    color: '#1C1C1E',
    fontSize: 14,
    fontWeight: '600',
  },
  primaryButton: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#007AFF',
  },
  primaryButtonDisabled: {
    opacity: 0.4,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  statusTextError: {
    fontSize: 14,
    color: '#FF3B30',
  },
  burningBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(28, 28, 30, 0.85)',
  },
  burningText: {
    marginTop: 16,
    fontSize: 15,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#C6C6C8',
    backgroundColor: '#FFFFFF',
  },
  resultContent: {
    padding: 20,
  },
  pathLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6C6C70',
    marginTop: 8,
  },
  pathText: {
    fontSize: 12,
    color: '#1C1C1E',
  },
  resultPlayerWrapper: {
    marginTop: 12,
  },
});
