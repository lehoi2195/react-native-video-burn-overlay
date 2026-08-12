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
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ViewShot, { type ViewShotRef } from 'react-native-view-shot';
import { burnOverlay } from 'rn-video-overlay';
import CameraRecorder, {
  FRAME_ASPECT_RATIO as RECORDER_FRAME_ASPECT_RATIO,
} from './components/CameraRecorder';
import OverlayPreview, { type Size } from './components/OverlayPreview';
import PickedImageOverlay from './components/PickedImageOverlay';
import ResultPlayer from './components/ResultPlayer';
import StyleSettingsPanel from './components/StyleSettingsPanel';
import {
  DEFAULT_IMAGE_OVERLAY_HEIGHT,
  DEFAULT_IMAGE_OVERLAY_WIDTH,
  DEFAULT_STYLE,
} from './constants/styleOptions';
import type { BurnStatus, OverlayMode } from './types';
import { buildImageCue, buildTextCue } from './utils/cueBuilders';
import {
  copyPickedAssetToCache,
  deleteCachedAsset,
  outputPathFor,
  stripFileScheme,
} from './utils/videoPaths';

const DEFAULT_ASPECT_RATIO = 16 / 9;

// A realistic timestamp/GPS/address stamp — the multi-line case this library is actually for.
const DEFAULT_OVERLAY_TEXT = [
  '20/08/2026 - 16:32',
  '34.0522488,-118.2399917',
  '255 E Temple St,',
  'Los Angeles, CA 90012',
].join('\n');

const viewShotOptions = { format: 'png' as const };

export default function App(): ReactElement {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<BurnStatus>('idle');
  const [sourcePath, setSourcePath] = useState('');
  const [outputPath, setOutputPath] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [assetAspectRatio, setAssetAspectRatio] = useState<number | null>(null);
  // Real pixel width of the source video; lets the preview scale a fixed style.fontSize correctly.
  const [assetWidth, setAssetWidth] = useState<number | null>(null);
  // Tracks the source so burn/back behavior differs for picked (reusable) vs recorded (one-off) video.
  const [videoSource, setVideoSource] = useState<'picked' | 'recorded' | null>(
    null
  );

  const [mode, setMode] = useState<OverlayMode>('text');
  const [overlayText, setOverlayText] = useState(DEFAULT_OVERLAY_TEXT);
  const [style, setStyle] = useState(DEFAULT_STYLE);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [cameraVisible, setCameraVisible] = useState(false);

  const [pickedImagePath, setPickedImagePath] = useState('');
  // Independent width/height of the capture box the picked photo resizes into.
  const [imageOverlayWidth, setImageOverlayWidth] = useState(
    DEFAULT_IMAGE_OVERLAY_WIDTH
  );
  const [imageOverlayHeight, setImageOverlayHeight] = useState(
    DEFAULT_IMAGE_OVERLAY_HEIGHT
  );

  const pickedImageViewShotRef = useRef<ViewShotRef>(null);

  // True while a picked asset is being copied into app cache storage (see pickVideo/pickImage).
  const [isProcessingPick, setIsProcessingPick] = useState(false);
  // Tracks the most recent cache copy per slot so a repeat pick can delete the stale one instead
  // of leaking files across the session; not populated for recorded video, which isn't our copy.
  const previousPickedVideoPathRef = useRef<string | null>(null);
  const previousPickedImagePathRef = useRef<string | null>(null);

  const aspectRatio = assetAspectRatio ?? DEFAULT_ASPECT_RATIO;

  const previewLines = useMemo(
    () => (mode === 'text' ? overlayText.split('\n') : []),
    [mode, overlayText]
  );

  const pickedImageSize = useMemo(
    () => ({ width: imageOverlayWidth, height: imageOverlayHeight }),
    [imageOverlayWidth, imageOverlayHeight]
  );

  // Nothing to preview until the user actually picks a photo.
  let previewCustomContent: ReactElement | undefined;
  let customContentSize: Size | undefined;
  if (mode === 'image' && pickedImagePath) {
    previewCustomContent = (
      <PickedImageOverlay
        uri={pickedImagePath}
        width={imageOverlayWidth}
        height={imageOverlayHeight}
      />
    );
    customContentSize = pickedImageSize;
  }

  const pickVideo = useCallback(async (): Promise<void> => {
    const result = await launchImageLibrary({ mediaType: 'video' });
    const asset = result.assets?.[0];
    if (!asset?.uri) {
      return; // user cancelled the picker
    }

    setIsProcessingPick(true);
    setErrorMessage('');
    try {
      // Never trust the picker's raw uri/originalPath directly: on Android's modern Photo Picker
      // (the default on Android 13+) it can be a synthetic FUSE-redirect path that looks like a
      // real file but only reliably supports reading the exact picked item — writing the sibling
      // `_burned.mp4` fails with EFAULT, and reads can silently fail too (the likely cause of a
      // black preview). Copying it into app-owned cache storage first sidesteps all of that.
      const copiedPath = await copyPickedAssetToCache(asset, 'mp4');
      if (previousPickedVideoPathRef.current) {
        deleteCachedAsset(previousPickedVideoPathRef.current);
      }
      previousPickedVideoPathRef.current = copiedPath;

      setSourcePath(copiedPath);
      setVideoSource('picked');
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

  const pickImage = useCallback(async (): Promise<void> => {
    const result = await launchImageLibrary({ mediaType: 'photo' });
    const asset = result.assets?.[0];
    if (!asset?.uri) {
      return; // user cancelled the picker
    }

    setIsProcessingPick(true);
    setErrorMessage('');
    try {
      // Same defensive copy as pickVideo — see its comment for why the raw picker path isn't safe.
      const copiedPath = await copyPickedAssetToCache(asset, 'jpg');
      if (previousPickedImagePathRef.current) {
        deleteCachedAsset(previousPickedImagePathRef.current);
      }
      previousPickedImagePathRef.current = copiedPath;
      setPickedImagePath(copiedPath);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setStatus('error');
    } finally {
      setIsProcessingPick(false);
    }
  }, []);

  // Extracted burn logic so handleRecorded can trigger it without waiting on stale sourcePath state.
  const runBurn = useCallback(
    async (path: string, cropAspectRatio?: number): Promise<void> => {
      setErrorMessage('');
      setStatus('burning');

      try {
        if (mode === 'image' && !pickedImagePath) {
          throw new Error('Pick a photo first.');
        }

        const cue =
          mode === 'text'
            ? buildTextCue(overlayText)
            : await buildImageCue(pickedImageViewShotRef);

        const resultPath = await burnOverlay({
          inputPath: path,
          outputPath: outputPathFor(path),
          cues: [cue],
          cropAspectRatio,
          style: {
            textColor: style.textColor,
            strokeColor: style.strokeColor,
            fontFamily: style.fontFamily,
            fontScale: style.fontScale,
            fontSize: style.fontSize,
            strokeWidth: style.strokeWidth,
            fontWeight: style.fontWeight,
            position: style.position,
            marginRatio: style.marginRatio,
            opacity: style.opacity,
          },
        });
        setOutputPath(resultPath);
        setStatus('done');
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
        setStatus('error');
      }
    },
    [mode, overlayText, style, pickedImagePath]
  );

  const handleRecorded = useCallback(
    (path: string, resolution: Size): void => {
      setCameraVisible(false);
      const resolvedPath = stripFileScheme(path);
      setSourcePath(resolvedPath);
      setVideoSource('recorded');
      setOutputPath('');
      setErrorMessage('');
      setStatus('idle');
      // Cropping to the recorder's fixed frame, so the result matches what was composed.
      setAssetAspectRatio(RECORDER_FRAME_ASPECT_RATIO);
      setAssetWidth(
        Math.round(resolution.height * RECORDER_FRAME_ASPECT_RATIO)
      );
      // Auto-burn right away; record flow shouldn't need a manual tap, runBurn reports its own failures.
      runBurn(resolvedPath, RECORDER_FRAME_ASPECT_RATIO).catch(() => {
        // runBurn already reports failures via setErrorMessage/setStatus.
      });
    },
    [runBurn]
  );

  const handleBurn = useCallback(async (): Promise<void> => {
    if (!sourcePath) {
      return;
    }
    return runBurn(sourcePath);
  }, [sourcePath, runBurn]);

  // Returns to config; picked video keeps state to re-burn, recorded video resets everything.
  const handleCloseResult = useCallback((): void => {
    if (videoSource === 'recorded') {
      setSourcePath('');
      setOutputPath('');
      setErrorMessage('');
      setAssetAspectRatio(null);
      setAssetWidth(null);
      setVideoSource(null);
      setStyle(DEFAULT_STYLE);
      setMode('text');
      setOverlayText(DEFAULT_OVERLAY_TEXT);
      setPickedImagePath('');
      setImageOverlayWidth(DEFAULT_IMAGE_OVERLAY_WIDTH);
      setImageOverlayHeight(DEFAULT_IMAGE_OVERLAY_HEIGHT);
      setStatus('idle');
      return;
    }

    // `outputPath` is cleared since it's stale until the next burn finishes.
    setStatus('idle');
    setOutputPath('');
  }, [videoSource]);

  const isBurning = status === 'burning';
  const isMissingPickedImage = mode === 'image' && !pickedImagePath;
  const isBurnDisabled =
    !sourcePath ||
    isBurning ||
    isProcessingPick ||
    videoSource !== 'picked' ||
    isMissingPickedImage;

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
        <Text style={styles.title}>react-native-video-overlay</Text>

        <OverlayPreview
          aspectRatio={aspectRatio}
          lines={previewLines}
          style={style}
          customContent={previewCustomContent}
          customContentSize={customContentSize}
          sourcePath={sourcePath}
          sourceWidth={assetWidth ?? undefined}
        />

        <View style={styles.modeRow}>
          <TouchableOpacity
            onPress={() => setMode('text')}
            style={[
              styles.modeButton,
              mode === 'text' && styles.topLevelModeButtonSelected,
            ]}
          >
            <Text
              style={[
                styles.modeButtonText,
                mode === 'text' && styles.modeButtonTextSelected,
              ]}
            >
              Text overlay
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setMode('image')}
            style={[
              styles.modeButton,
              mode === 'image' && styles.topLevelModeButtonSelected,
            ]}
          >
            <Text
              style={[
                styles.modeButtonText,
                mode === 'image' && styles.modeButtonTextSelected,
              ]}
            >
              Image overlay
            </Text>
          </TouchableOpacity>
        </View>

        {mode === 'text' ? (
          <TextInput
            value={overlayText}
            style={[styles.textInput, styles.textInputMultiline]}
            onChangeText={setOverlayText}
            placeholder="Overlay message"
            placeholderTextColor="#8E8E93"
            multiline
          />
        ) : (
          <>
            <TouchableOpacity
              style={styles.imagePickButton}
              onPress={pickImage}
              disabled={isBurning || isProcessingPick}
            >
              <Text style={styles.secondaryButtonText}>
                {pickedImagePath
                  ? 'Change image overlay'
                  : 'Pick image overlay'}
              </Text>
            </TouchableOpacity>
            <Text style={styles.helperText}>
              {isProcessingPick
                ? 'Copying picked photo…'
                : pickedImagePath
                  ? `Resized to ${imageOverlayWidth}×${imageOverlayHeight}px and burned in as the overlay.`
                  : 'Pick a photo from your device to use as the overlay.'}
            </Text>
          </>
        )}

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => setSettingsVisible(true)}
          >
            <Text style={styles.secondaryButtonText}>Customize style</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={pickVideo}
            disabled={isBurning || isProcessingPick}
          >
            <Text style={styles.secondaryButtonText}>
              {isProcessingPick ? 'Copying…' : 'Pick video'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => setCameraVisible(true)}
            disabled={isBurning || isProcessingPick}
          >
            <Text style={styles.secondaryButtonText}>Record video</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[
            styles.primaryButton,
            isBurnDisabled && styles.primaryButtonDisabled,
          ]}
          onPress={handleBurn}
          disabled={isBurnDisabled}
        >
          <Text style={styles.primaryButtonText}>Processing overlay</Text>
        </TouchableOpacity>

        {status === 'error' ? (
          <View style={styles.statusBlock}>
            <Text style={styles.statusTextError}>Failed: {errorMessage}</Text>
          </View>
        ) : null}
      </ScrollView>

      {/* A plain overlay, not a Modal: iOS cannot present one while another is dismissing. */}
      {isBurning ? (
        <View style={styles.burningBackdrop}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text style={styles.burningText}>Burning overlay…</Text>
        </View>
      ) : null}

      {/* Separate full-screen result screen so playback/save don't compete with settings controls. */}
      <Modal
        visible={status === 'done'}
        animationType="slide"
        onRequestClose={handleCloseResult}
      >
        <View style={styles.resultScreen}>
          <View style={[styles.resultHeader, { paddingTop: 16 + insets.top }]}>
            <TouchableOpacity onPress={handleCloseResult}>
              <Text style={styles.resultCloseText}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={styles.resultTitle}>Done</Text>
            <View style={styles.resultHeaderSpacer} />
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

      <StyleSettingsPanel
        visible={settingsVisible}
        mode={mode}
        style={style}
        onChange={setStyle}
        onClose={() => setSettingsVisible(false)}
        imageOverlayWidth={imageOverlayWidth}
        imageOverlayHeight={imageOverlayHeight}
        onImageOverlayWidthChange={setImageOverlayWidth}
        onImageOverlayHeightChange={setImageOverlayHeight}
      />

      <CameraRecorder
        visible={cameraVisible}
        onClose={() => setCameraVisible(false)}
        onRecorded={handleRecorded}
        style={style}
        onStyleChange={setStyle}
        previewLines={previewLines}
        previewCustomContent={previewCustomContent}
        previewCustomContentSize={customContentSize}
      />

      {/* Off-screen; capture() reads current layout live, so size changes apply automatically. */}
      <View
        style={[
          styles.offscreenCapture,
          { width: imageOverlayWidth, height: imageOverlayHeight },
        ]}
        pointerEvents="none"
      >
        <ViewShot ref={pickedImageViewShotRef} options={viewShotOptions}>
          {pickedImagePath ? (
            <PickedImageOverlay
              uri={pickedImagePath}
              width={imageOverlayWidth}
              height={imageOverlayHeight}
            />
          ) : (
            <View
              style={{ width: imageOverlayWidth, height: imageOverlayHeight }}
            />
          )}
        </ViewShot>
      </View>
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
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#E5E5EA',
  },
  modeButtonSelected: {
    backgroundColor: '#007AFF',
  },
  // Distinct accent (vs. the #007AFF used everywhere else) so the top-level Text/Image toggle
  // reads as its own section rather than blending in with the other action buttons.
  topLevelModeButtonSelected: {
    backgroundColor: '#AF52DE',
  },
  modeButtonText: {
    color: '#1C1C1E',
    fontSize: 13,
    fontWeight: '600',
  },
  modeButtonTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  textInput: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#C6C6C8',
    backgroundColor: '#FFFFFF',
    color: '#1C1C1E',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  textInputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  helperText: {
    fontSize: 12,
    color: '#6C6C70',
    fontStyle: 'italic',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  secondaryButton: {
    flex: 1,
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
  // Same look as secondaryButton, but this button sits alone in the ScrollView's column flow
  // (not inside a flexDirection: 'row' actionRow), so flex: 1 would grow it to fill all
  // remaining vertical space instead of sharing a row's width — alignSelf: 'stretch' keeps the
  // full-width look without that.
  imagePickButton: {
    alignSelf: 'stretch',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#E5E5EA',
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
  statusBlock: {
    marginTop: 12,
  },
  statusTextError: {
    fontSize: 14,
    color: '#FF3B30',
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
  // Absolute rather than flex: it sits over the root view instead of being presented.
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
  resultScreen: {
    flex: 1,
    backgroundColor: '#F2F2F7',
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
  resultCloseText: {
    color: '#007AFF',
    fontSize: 15,
    fontWeight: '600',
  },
  resultTitle: {
    color: '#1C1C1E',
    fontSize: 16,
    fontWeight: '600',
  },
  resultHeaderSpacer: {
    width: 48,
  },
  resultContent: {
    padding: 20,
  },
  offscreenCapture: {
    position: 'absolute',
    left: -1000,
    top: 0,
  },
});
