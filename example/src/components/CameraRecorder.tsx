import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  Linking,
  Modal,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Camera,
  CommonResolutions,
  useCameraDevice,
  useCameraPermission,
  useMicrophonePermission,
  useVideoOutput,
  type CameraDevice,
  type CameraRef,
  type Recorder,
  type Size as VideoResolution,
  type TorchMode,
} from 'react-native-vision-camera';
import type { OverlayCue } from 'react-native-video-burn-overlay';
import { clamp, TEXT_COLORS } from '../constants/styleOptions';
import type { ResolvedOverlayStyle } from '../types';
import { buildLocationStampCues } from '../utils/cueBuilders';
import { useLocationStamp } from '../utils/useLocationStamp';
import OverlayPreview, { type Size } from './OverlayPreview';
import StyleSettingsPanel from './StyleSettingsPanel';

/** Screen background; the status bar is painted the same so there's no seam at the top edge. */
const SCREEN_BACKGROUND = '#141B2A';

// StyleSettingsPanel needs image-overlay props; this screen never uses image mode.
const NOOP_IMAGE_OVERLAY_DIMENSION = 30;
function noop(): void {}

/** Additive step per tap of the zoom +/- buttons. */
const ZOOM_STEP = 0.5;

/** How often the recording elapsed-time badge re-renders while recording. */
const RECORDING_TIMER_TICK_MS = 1000;

/** How long to withhold torch commands after the session becomes active before trusting it's ready. */
const TORCH_READY_BUFFER_MS = 500;

/** Caps the long edge so the demo burn stays fast instead of chasing 4K/8K capture modes. */
const MAX_LONG_EDGE = 1920;

/** Fixed by design: the viewfinder is always a 3:4 portrait frame at full device width. */
export const FRAME_ASPECT_RATIO = 3 / 4;

interface CameraRecorderProps {
  visible: boolean;
  onClose: () => void;
  /** Path, real pixel size, and the per-second location-stamp cues already built for it. */
  onRecorded: (path: string, resolution: Size, cues: OverlayCue[]) => void;
  /** Overlay style state owned by `App`; only the text color is editable from here. */
  style: ResolvedOverlayStyle;
  onStyleChange: (next: ResolvedOverlayStyle) => void;
}

/** Formats a whole-second duration as `MM:SS`, e.g. `65` -> `"01:05"`. */
function formatElapsedTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// CameraX cancels pending zoom/torch ops on every session rebind; nothing failed.
function isBenignCancellation(message: string): boolean {
  return /OperationCanceledException|Camera is not active/i.test(message);
}

/** Keeps a native stack trace from flooding the banner; only the first line names the failure. */
function firstLineOf(message: string): string {
  return message.split('\n')[0] ?? message;
}

function longEdge(size: VideoResolution): number {
  return Math.max(size.width, size.height);
}

function shortEdge(size: VideoResolution): number {
  return Math.min(size.width, size.height);
}

// No ratio preference: an unsupported ratio silently upgrades to a much larger mode.
function pickTargetResolution(
  device: CameraDevice | undefined
): VideoResolution {
  if (device == null) {
    return CommonResolutions.FHD_16_9;
  }
  const withinCap = device
    .getSupportedResolutions('video')
    .filter((size) => longEdge(size) <= MAX_LONG_EDGE);
  if (withinCap.length === 0) {
    return CommonResolutions.FHD_16_9;
  }
  return withinCap.reduce((a, b) => (longEdge(a) >= longEdge(b) ? a : b));
}

/** Full-screen camera recorder; feeds the same sourcePath state as pickVideo so it's treated identically. */
export default function CameraRecorder({
  visible,
  onClose,
  onRecorded,
  style,
  onStyleChange,
}: CameraRecorderProps): ReactElement {
  const insets = useSafeAreaInsets();
  // Translucent status bar (edge-to-edge) means content now renders under it on both platforms.
  const topInset = insets.top;
  const [cameraPosition, setCameraPosition] = useState<'back' | 'front'>(
    'back'
  );
  const device = useCameraDevice(cameraPosition);

  const {
    hasPermission: hasCameraPermission,
    canRequestPermission: canRequestCameraPermission,
    requestPermission: requestCameraPermission,
  } = useCameraPermission();
  const {
    hasPermission: hasMicrophonePermission,
    canRequestPermission: canRequestMicrophonePermission,
    requestPermission: requestMicrophonePermission,
  } = useMicrophonePermission();

  const targetResolution = useMemo(
    () => pickTargetResolution(device),
    [device]
  );

  // Audio is always recorded alongside video, so both permissions are required first.
  const videoOutput = useVideoOutput({
    enableAudio: true,
    targetResolution,
  });

  // What the session actually settled on, which drives the preview's font scaling.
  const [actualResolution, setActualResolution] =
    useState<VideoResolution | null>(null);
  // Capture rarely matches the fixed frame; App's cropAspectRatio realigns the output.
  const recordedResolution = actualResolution ?? targetResolution;
  const captureRatio =
    shortEdge(recordedResolution) / longEdge(recordedResolution);

  const [frameSize, setFrameSize] = useState<Size>({ width: 0, height: 0 });

  const handleFrameLayout = useCallback((event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout;
    setFrameSize({ width, height });
  }, []);

  // Preview streams the full sensor while recording crops it, so show only what gets recorded.
  const cameraCoverStyle = useMemo(() => {
    const { width, height } = frameSize;
    if (width <= 0 || height <= 0) {
      return styles.cameraFill;
    }
    return captureRatio > width / height
      ? { width: height * captureRatio, height }
      : { width, height: width / captureRatio };
  }, [frameSize, captureRatio]);

  const locationStamp = useLocationStamp();

  const cameraRef = useRef<CameraRef>(null);
  const recorderRef = useRef<Recorder | null>(null);
  const startedAtRef = useRef<Date | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [torchOn, setTorchOn] = useState(false);
  // True only once CameraSession has started; controlling torch before then crashes on Android.
  const [isCameraActive, setIsCameraActive] = useState(false);
  // True only after isCameraActive has settled for TORCH_READY_BUFFER_MS.
  const [isTorchReady, setIsTorchReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  // Whole seconds elapsed, shown as the MM:SS badge; resets to 0 every new recording.
  const [recordingElapsedSec, setRecordingElapsedSec] = useState(0);
  const [settingsVisible, setSettingsVisible] = useState(false);

  // requestPermission()'s resolved boolean, captured directly instead of relying on the reactive hasPermission.
  const [manuallyGrantedCamera, setManuallyGrantedCamera] = useState(false);
  const [manuallyGrantedMicrophone, setManuallyGrantedMicrophone] =
    useState(false);

  // Reset transient state every time the recorder sheet is (re)opened.
  useEffect(() => {
    if (visible) {
      setIsRecording(false);
      setIsStarting(false);
      setErrorMessage('');
      setTorchOn(false);
      setIsCameraActive(false);
      setIsTorchReady(false);
      setActualResolution(null);
      setSettingsVisible(false);
      setZoom((previous) =>
        device ? clamp(previous, device.minZoom, device.maxZoom) : previous
      );
    }
  }, [visible, device]);

  // Edge-to-edge (targetSdk 36) ignores setBackgroundColor; translucent lets root's own dark bg show through.
  useEffect(() => {
    if (!visible) return;
    StatusBar.setBarStyle('light-content');
    if (Platform.OS === 'android') {
      StatusBar.setTranslucent(true);
    }
    return () => {
      StatusBar.setBarStyle('dark-content');
      if (Platform.OS === 'android') {
        StatusBar.setTranslucent(false);
      }
    };
  }, [visible]);

  // Tracks a start timestamp, not a counter, so elapsed time stays accurate under JS-thread delays.
  useEffect(() => {
    if (!isRecording) {
      setRecordingElapsedSec(0);
      return;
    }
    const startedAt = Date.now();
    setRecordingElapsedSec(0);
    const interval = setInterval(() => {
      setRecordingElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, RECORDING_TIMER_TICK_MS);
    return () => clearInterval(interval);
  }, [isRecording]);

  const hasAllPermissions =
    (hasCameraPermission || manuallyGrantedCamera) &&
    (hasMicrophonePermission || manuallyGrantedMicrophone);
  const canRequestAnyPermission =
    canRequestCameraPermission || canRequestMicrophonePermission;

  // hasPermission only re-syncs on AppState foreground; capture the resolved boolean directly instead.
  const requestPermissions = useCallback((): void => {
    if (!hasCameraPermission && canRequestCameraPermission) {
      requestCameraPermission()
        .then(setManuallyGrantedCamera)
        .catch(() => {
          // Nothing actionable — the gate screen simply stays up.
        });
    }
    if (!hasMicrophonePermission && canRequestMicrophonePermission) {
      requestMicrophonePermission()
        .then(setManuallyGrantedMicrophone)
        .catch(() => {
          // Nothing actionable — the gate screen simply stays up.
        });
    }
  }, [
    hasCameraPermission,
    canRequestCameraPermission,
    requestCameraPermission,
    hasMicrophonePermission,
    canRequestMicrophonePermission,
    requestMicrophonePermission,
  ]);

  const startRecording = useCallback(async (): Promise<void> => {
    setErrorMessage('');
    setIsStarting(true);
    const startedAt = new Date();
    startedAtRef.current = startedAt;
    locationStamp.start(startedAt);
    try {
      const recorder = await videoOutput.createRecorder({});
      recorderRef.current = recorder;
      await recorder.startRecording(
        (filePath) => {
          recorderRef.current = null;
          setIsRecording(false);
          const samples = locationStamp.stop();
          const cues = buildLocationStampCues(
            samples,
            startedAtRef.current ?? startedAt,
            locationStamp.addressLines
          );
          // Re-read rather than reuse state, so the size reported up is the one just recorded at.
          const finalSize = videoOutput.currentResolution ?? targetResolution;
          onRecorded(
            filePath,
            { width: shortEdge(finalSize), height: longEdge(finalSize) },
            cues
          );
        },
        (error) => {
          recorderRef.current = null;
          setIsRecording(false);
          locationStamp.stop();
          setErrorMessage(firstLineOf(error.message));
        }
      );
      setIsRecording(true);
    } catch (error) {
      locationStamp.stop();
      setErrorMessage(
        firstLineOf(error instanceof Error ? error.message : String(error))
      );
    } finally {
      setIsStarting(false);
    }
  }, [videoOutput, onRecorded, targetResolution, locationStamp]);

  const stopRecording = useCallback(async (): Promise<void> => {
    try {
      await recorderRef.current?.stopRecording();
    } catch (error) {
      setErrorMessage(
        firstLineOf(error instanceof Error ? error.message : String(error))
      );
    }
  }, []);

  const handleRecordPress = useCallback((): void => {
    if (isRecording) {
      stopRecording().catch(() => {
        // stopRecording already reports failures via setErrorMessage.
      });
    } else {
      startRecording().catch(() => {
        // startRecording already reports failures via setErrorMessage.
      });
    }
  }, [isRecording, startRecording, stopRecording]);

  const handleClose = useCallback((): void => {
    if (isRecording && recorderRef.current) {
      recorderRef.current.cancelRecording().catch(() => {
        // Best-effort cleanup; nothing to surface since the sheet is closing anyway.
      });
      recorderRef.current = null;
      setIsRecording(false);
    }
    onClose();
  }, [isRecording, onClose]);

  const handleRequestAccess = useCallback((): void => {
    requestPermissions();
  }, [requestPermissions]);

  const handleOpenSettings = useCallback((): void => {
    Linking.openSettings().catch(() => {
      // Nothing actionable if the OS can't open Settings.
    });
  }, []);

  const handleCameraStarted = useCallback((): void => {
    setIsCameraActive(true);
    // currentResolution stays undefined until the output is attached to a running session.
    setActualResolution(videoOutput.currentResolution ?? null);
  }, [videoOutput]);

  const handleCameraStopped = useCallback((): void => {
    setIsCameraActive(false);
    setIsTorchReady(false);
    setActualResolution(null);
  }, []);

  const handleCameraError = useCallback((error: Error): void => {
    if (isBenignCancellation(error.message)) {
      return; // A rebind cancelled a pending control op; the session itself is fine.
    }
    setErrorMessage(firstLineOf(error.message));
    // Session may no longer be running after an error; don't leave torch control enabled.
    setIsCameraActive(false);
    setIsTorchReady(false);
    setActualResolution(null);
  }, []);

  const toggleTorch = useCallback((): void => {
    setTorchOn((previous) => !previous);
  }, []);

  const toggleCameraPosition = useCallback((): void => {
    // Swapping devices rebinds the session, so drop torch and the now-stale negotiated size.
    setTorchOn(false);
    setIsCameraActive(false);
    setActualResolution(null);
    setCameraPosition((previous) => (previous === 'back' ? 'front' : 'back'));
  }, []);

  const handleTextColorChange = useCallback(
    (textColor: string): void => {
      onStyleChange({ ...style, textColor });
    },
    [onStyleChange, style]
  );

  const zoomIn = useCallback((): void => {
    if (!device) return;
    setZoom((previous) =>
      clamp(previous + ZOOM_STEP, device.minZoom, device.maxZoom)
    );
  }, [device]);

  const zoomOut = useCallback((): void => {
    if (!device) return;
    setZoom((previous) =>
      clamp(previous - ZOOM_STEP, device.minZoom, device.maxZoom)
    );
  }, [device]);

  // Torch before camera is active crashes natively; force off until onStarted.
  const effectiveTorchMode: TorchMode =
    isCameraActive && isTorchReady && torchOn ? 'on' : 'off';

  useEffect(() => {
    setIsTorchReady(false);
    if (!isCameraActive) return;
    const timeout = setTimeout(
      () => setIsTorchReady(true),
      TORCH_READY_BUFFER_MS
    );
    return () => clearTimeout(timeout);
  }, [isCameraActive]);

  useEffect(() => {
    const controller = cameraRef.current?.controller;
    if (controller == null) return;
    controller.setTorchMode(effectiveTorchMode).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (isBenignCancellation(message)) {
        return; // A rebind cancelled the torch push; the next one will land.
      }
      if (effectiveTorchMode === 'on') {
        // Only surface a failure when the user wanted torch on; a failed off-push isn't actionable.
        setErrorMessage(firstLineOf(message));
        setTorchOn(false);
      }
    });
  }, [effectiveTorchMode]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        {!hasAllPermissions ? (
          <View style={styles.gate}>
            <Text style={styles.gateTitle}>Camera access needed</Text>
            <Text style={styles.gateText}>
              {canRequestAnyPermission
                ? 'Grant camera and microphone access to record a video for the overlay demo.'
                : 'Camera or microphone access was denied. Enable both in Settings to record video.'}
            </Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={
                canRequestAnyPermission
                  ? handleRequestAccess
                  : handleOpenSettings
              }
            >
              <Text style={styles.primaryButtonText}>
                {canRequestAnyPermission ? 'Grant access' : 'Open Settings'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleClose}
            >
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : device == null ? (
          <View style={styles.gate}>
            <Text style={styles.gateTitle}>No camera found</Text>
            <Text style={styles.gateText}>
              This device does not expose a back camera to record from.
            </Text>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleClose}
            >
              <Text style={styles.secondaryButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={[styles.topBar, { paddingTop: 12 + topInset }]}>
              <TouchableOpacity
                style={styles.topBarButton}
                onPress={handleClose}
              >
                <Text style={styles.topBarIcon}>‹</Text>
              </TouchableOpacity>
              <Text style={styles.topBarTitle}>Record video</Text>
              <TouchableOpacity
                style={styles.topBarButton}
                onPress={() => setSettingsVisible(true)}
              >
                <Text style={styles.settingsIcon}>⚙️</Text>
              </TouchableOpacity>
            </View>

            {errorMessage ? (
              <TouchableOpacity
                style={styles.errorBanner}
                onPress={() => setErrorMessage('')}
              >
                {/* Capped and tap-to-dismiss; a native stack trace would otherwise eat the screen. */}
                <Text style={styles.errorBannerText} numberOfLines={3}>
                  {errorMessage}
                </Text>
              </TouchableOpacity>
            ) : null}

            {/* Fixed 3:4 full-width, so composition stays identical across devices. */}
            <View style={styles.viewfinderWrap}>
              <View style={styles.viewfinder} onLayout={handleFrameLayout}>
                <OverlayPreview
                  aspectRatio={FRAME_ASPECT_RATIO}
                  lines={locationStamp.previewLines}
                  style={style}
                  sourceWidth={shortEdge(recordedResolution)}
                  frameStyle={styles.viewfinderFrame}
                  backgroundContent={
                    <View style={styles.cameraCoverWrap}>
                      <View style={cameraCoverStyle}>
                        <Camera
                          ref={cameraRef}
                          style={StyleSheet.absoluteFill}
                          device={device}
                          isActive={visible}
                          outputs={[videoOutput]}
                          zoom={isCameraActive ? zoom : undefined}
                          onStarted={handleCameraStarted}
                          onStopped={handleCameraStopped}
                          onError={handleCameraError}
                        />
                      </View>
                    </View>
                  }
                />
              </View>

              {isRecording ? (
                <View style={styles.recordingBadge}>
                  <Text style={styles.recordingBadgeText}>
                    {formatElapsedTime(recordingElapsedSec)}
                  </Text>
                </View>
              ) : null}

              {device.maxZoom > device.minZoom ? (
                <View style={styles.zoomRow}>
                  <TouchableOpacity
                    style={[
                      styles.zoomButton,
                      zoom <= device.minZoom && styles.zoomButtonDisabled,
                    ]}
                    onPress={zoomOut}
                    disabled={zoom <= device.minZoom}
                  >
                    <Text style={styles.zoomButtonText}>−</Text>
                  </TouchableOpacity>
                  <Text style={styles.zoomLabel}>{zoom.toFixed(1)}×</Text>
                  <TouchableOpacity
                    style={[
                      styles.zoomButton,
                      zoom >= device.maxZoom && styles.zoomButtonDisabled,
                    ]}
                    onPress={zoomIn}
                    disabled={zoom >= device.maxZoom}
                  >
                    <Text style={styles.zoomButtonText}>+</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>

            <View style={[styles.controls, { paddingBottom: insets.bottom }]}>
              <View style={styles.colorRow}>
                {TEXT_COLORS.map((color) => (
                  <TouchableOpacity
                    key={color}
                    style={[
                      styles.swatch,
                      { backgroundColor: color },
                      style.textColor === color && styles.swatchSelected,
                    ]}
                    onPress={() => handleTextColorChange(color)}
                  />
                ))}
              </View>

              <View style={styles.recordRow}>
                <View style={styles.recordRowSlot}>
                  <TouchableOpacity
                    style={styles.flashButton}
                    onPress={toggleTorch}
                    disabled={!device.hasTorch || !isCameraActive}
                  >
                    <Text
                      style={[
                        styles.flashButtonText,
                        (!device.hasTorch || !isCameraActive) &&
                          styles.topBarIconDisabled,
                      ]}
                    >
                      {torchOn ? '⚡️' : '⚡'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  style={styles.recordButtonOuter}
                  onPress={handleRecordPress}
                  disabled={isStarting}
                >
                  <View
                    style={[
                      styles.recordButtonInner,
                      isRecording && styles.recordButtonInnerActive,
                    ]}
                  />
                </TouchableOpacity>
                <View style={styles.recordRowSlot}>
                  {/* Hidden mid-recording: swapping devices would tear down the active recorder. */}
                  {isRecording ? null : (
                    <TouchableOpacity
                      style={styles.flipButton}
                      onPress={toggleCameraPosition}
                    >
                      <Text style={styles.flipButtonText}>⟳</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>

            <StyleSettingsPanel
              visible={settingsVisible}
              mode="text"
              style={style}
              onChange={onStyleChange}
              onClose={() => setSettingsVisible(false)}
              imageOverlayWidth={NOOP_IMAGE_OVERLAY_DIMENSION}
              imageOverlayHeight={NOOP_IMAGE_OVERLAY_DIMENSION}
              onImageOverlayWidthChange={noop}
              onImageOverlayHeightChange={noop}
            />
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: SCREEN_BACKGROUND,
  },
  gate: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    gap: 12,
    backgroundColor: '#F2F2F7',
  },
  gateTitle: {
    color: '#1C1C1E',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  gateText: {
    color: '#6C6C70',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 12,
  },
  primaryButton: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#007AFF',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  topBarButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // translateY corrects the glyph sitting visibly low within its touch target.
  topBarIcon: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '600',
    transform: [{ translateY: -2 }],
  },
  settingsIcon: {
    fontSize: 22,
  },
  topBarIconDisabled: {
    opacity: 0.3,
  },
  topBarTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  // Absorbs slack and clips the frame when short, so controls are never pushed over it.
  viewfinderWrap: {
    flex: 1,
    justifyContent: 'flex-start',
    overflow: 'hidden',
  },
  viewfinder: {
    width: '100%',
    aspectRatio: FRAME_ASPECT_RATIO,
  },
  // Centres the oversized camera view so the crop is symmetric, then clips it.
  cameraCoverWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  cameraFill: {
    width: '100%',
    height: '100%',
  },
  // Drops OverlayPreview's card chrome — a camera feed reads as full-bleed, not as a widget.
  viewfinderFrame: {
    borderRadius: 0,
    borderWidth: 0,
    backgroundColor: '#000000',
  },
  zoomRow: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  zoomButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20, 27, 42, 0.7)',
  },
  zoomButtonDisabled: {
    opacity: 0.3,
  },
  zoomButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    lineHeight: 20,
    fontWeight: '700',
  },
  zoomLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    minWidth: 36,
    textAlign: 'center',
  },
  recordingBadge: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#FF3B30',
  },
  recordingBadgeText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  errorBanner: {
    marginHorizontal: 20,
    marginBottom: 8,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255, 69, 58, 0.9)',
  },
  errorBannerText: {
    color: '#FFFFFF',
    fontSize: 12,
  },
  // Natural height and never shrinks, so its content can't spill onto the frame.
  controls: {
    flexShrink: 0,
    alignItems: 'center',
    paddingTop: 16,
    gap: 16,
    backgroundColor: SCREEN_BACKGROUND,
  },
  colorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  swatchSelected: {
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  // Equal side slots keep the record button dead-centre whether or not the flip button shows.
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    paddingHorizontal: 24,
  },
  recordRowSlot: {
    flex: 1,
    alignItems: 'center',
  },
  flipButton: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  flipButtonText: {
    color: '#FFFFFF',
    fontSize: 30,
    transform: [{ translateY: -1 }],
  },
  flashButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  flashButtonText: {
    fontSize: 22,
  },
  recordButtonOuter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FF3B30',
  },
  recordButtonInnerActive: {
    width: 28,
    height: 28,
    borderRadius: 6,
  },
});
