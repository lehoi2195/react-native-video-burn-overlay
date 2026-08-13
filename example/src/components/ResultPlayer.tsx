import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  ActivityIndicator,
  Image,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import FileViewer from 'react-native-file-viewer';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import { useVideoThumbnail } from '../utils/useVideoThumbnail';

interface ResultPlayerProps {
  /** Filesystem path (no `file://` scheme) of the burned output video. */
  outputPath: string;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** How long the "Saved!" confirmation stays up before reverting to idle. */
const SAVED_BADGE_DURATION_MS = 3000;

/** Plays the burned output with a Save-to-Camera-Roll action; rendered only once burnOverlay finishes. */
export default function ResultPlayer({
  outputPath,
}: ResultPlayerProps): ReactElement {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState('');
  const [openError, setOpenError] = useState('');
  const savedBadgeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const thumbnailUri = useVideoThumbnail(outputPath);

  // Clear the pending revert-to-idle timer if the component unmounts mid-countdown.
  useEffect(() => {
    return () => {
      if (savedBadgeTimeoutRef.current) {
        clearTimeout(savedBadgeTimeoutRef.current);
      }
    };
  }, []);

  // API 29+ needs no storage permission; WRITE_EXTERNAL_STORAGE is manifest-capped at API 28.
  const ensureAndroidGalleryPermission =
    useCallback(async (): Promise<boolean> => {
      if (Platform.OS !== 'android' || Platform.Version >= 29) {
        return true;
      }

      const permission = PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE;
      if (await PermissionsAndroid.check(permission)) {
        return true;
      }

      const result = await PermissionsAndroid.request(permission);
      return result === PermissionsAndroid.RESULTS.GRANTED;
    }, []);

  const saveToCameraRoll = useCallback(async (): Promise<void> => {
    setSaveStatus('saving');
    setSaveError('');
    try {
      const granted = await ensureAndroidGalleryPermission();
      if (!granted) {
        throw new Error('Gallery permission was denied.');
      }

      // album must be explicit ''; omitting it lets iOS build an NSPredicate with nil, crashing.
      await CameraRoll.saveAsset(`file://${outputPath}`, {
        type: 'video',
        album: '',
      });

      setSaveStatus('saved');
      savedBadgeTimeoutRef.current = setTimeout(() => {
        setSaveStatus('idle');
      }, SAVED_BADGE_DURATION_MS);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
      setSaveStatus('error');
    }
  }, [outputPath, ensureAndroidGalleryPermission]);

  const handleSavePress = useCallback((): void => {
    saveToCameraRoll().catch(() => {
      // saveToCameraRoll already reports failures via setSaveStatus/setSaveError.
    });
  }, [saveToCameraRoll]);

  const handleOpenPress = useCallback((): void => {
    setOpenError('');
    // ACTION_VIEW, not a share sheet — players register for view, not send.
    FileViewer.open(outputPath, { showOpenWithDialog: true }).catch(
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        // Rejects on user dismiss too — only surface real failures.
        if (!/cancel|dismiss/i.test(message)) {
          setOpenError(message);
        }
      }
    );
  }, [outputPath]);

  const isSaving = saveStatus === 'saving';

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.player}
        onPress={handleOpenPress}
        activeOpacity={0.8}
      >
        {thumbnailUri ? (
          <Image
            source={{ uri: thumbnailUri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        ) : null}
        <View style={styles.playBadge}>
          <Text style={styles.playBadgeText}>▶ Open in video player</Text>
        </View>
      </TouchableOpacity>

      {openError ? (
        <Text style={styles.errorText}>Failed to open: {openError}</Text>
      ) : null}

      <TouchableOpacity
        style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
        onPress={handleSavePress}
        disabled={isSaving}
      >
        {isSaving ? (
          <ActivityIndicator size="small" color="#1C1C1E" />
        ) : (
          <Text
            style={[
              styles.saveButtonText,
              saveStatus === 'saved' && styles.saveButtonTextSaved,
            ]}
          >
            {saveStatus === 'saved' ? 'Saved!' : 'Save to Camera Roll'}
          </Text>
        )}
      </TouchableOpacity>

      {saveStatus === 'error' ? (
        <Text style={styles.errorText}>Failed to save: {saveError}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
    marginTop: 4,
  },
  player: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 10,
    backgroundColor: '#1C1C1E',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  playBadge: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  playBadgeText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  saveButton: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E5E5EA',
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#1C1C1E',
    fontSize: 14,
    fontWeight: '600',
  },
  saveButtonTextSaved: {
    color: '#34C759',
  },
  errorText: {
    fontSize: 12,
    color: '#FF3B30',
  },
});
