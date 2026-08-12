import {
  CachesDirectoryPath,
  copyFile,
  unlink,
} from '@dr.pogodin/react-native-fs';

/** Strips the `file://` scheme some pickers prepend — native expects a bare filesystem path. */
export function stripFileScheme(uri: string): string {
  return uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
}

/** True for Android content:// URIs, which can't be handed to native filesystem APIs like burnOverlay. */
export function isContentUri(path: string): boolean {
  return path.startsWith('content://');
}

interface PickedAsset {
  uri?: string;
  originalPath?: string;
  fileName?: string;
}

/**
 * Picks the raw, picker-returned candidate most likely to be readable — NOT a final usable path.
 * Prefers `uri` over `originalPath`: react-native-image-picker's Android implementation documents
 * `uri` as already being a copy in app-specific cache storage for images, and a `content://` URI
 * (readable via ContentResolver, the officially supported access route) for gallery video. Its
 * `originalPath`, by contrast, comes straight from the MediaStore DATA column, which for Android's
 * modern Photo Picker (the default picker on Android 13+) is a synthetic FUSE-redirect path — it
 * looks like a real filesystem path but only reliably supports reading the exact picked item.
 * Callers must still run this through `copyPickedAssetToCache` before treating it as a real path.
 */
function resolvePickedAssetSource(asset: PickedAsset): string {
  const candidate = asset.uri ?? asset.originalPath ?? '';
  return stripFileScheme(candidate);
}

/** Extracts a lowercase extension (no dot) from a path/uri/filename, or undefined if none is found. */
function extensionOf(pathOrName: string | undefined): string | undefined {
  if (!pathOrName) {
    return undefined;
  }
  const withoutQuery = pathOrName.split('?')[0] ?? pathOrName;
  const dotIndex = withoutQuery.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === withoutQuery.length - 1) {
    return undefined;
  }
  const candidate = withoutQuery.slice(dotIndex + 1);
  // Guards against content:// URIs whose last path segment is a numeric id, not a real extension.
  return /^[A-Za-z0-9]{1,5}$/.test(candidate)
    ? candidate.toLowerCase()
    : undefined;
}

/**
 * Copies a picker-returned photo/video into the app's own cache directory and returns the real,
 * app-owned path to the copy.
 *
 * WHY: react-native-image-picker can hand back a path/uri that *looks* like an ordinary,
 * directly-usable filesystem path but isn't reliably one — most notably Android's modern Photo
 * Picker, which routes `originalPath` through a synthetic FUSE redirect that only supports
 * reading the exact picked item (writing a sibling file next to it, as `outputPathFor` does,
 * fails with EFAULT) and isn't guaranteed to be reliably readable via plain native file I/O
 * either (this is also the likely cause of a black `<Video>`/`<Image>` preview). Copying the
 * bytes into a file this app created itself sidesteps all of that: from then on it's an ordinary
 * file the app fully owns, on both Android and iOS (which has its own analogous `ph://` quirks).
 */
export async function copyPickedAssetToCache(
  asset: PickedAsset,
  fallbackExtension: string
): Promise<string> {
  const source = resolvePickedAssetSource(asset);
  if (!source) {
    throw new Error('The picker did not return a usable file.');
  }

  const extension =
    extensionOf(asset.fileName) ?? extensionOf(source) ?? fallbackExtension;
  const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const destination = `${CachesDirectoryPath}/picked_${uniqueSuffix}.${extension}`;

  try {
    await copyFile(source, destination);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not access the picked file: ${message}`);
  }

  return destination;
}

/** Best-effort delete of a previously copied cache file; failures are silently ignored. */
export function deleteCachedAsset(path: string): void {
  unlink(path).catch(() => {
    // Nothing actionable — the file may already be gone, or was never created.
  });
}

/** Derives an output path in the app's cache directory, e.g. `clip.mp4` -> `<cache>/clip_burned.mp4`. */
export function outputPathFor(videoPath: string): string {
  if (isContentUri(videoPath)) {
    throw new Error(
      'This video is not accessible as a file and cannot be burned. Try picking a different video or recording one instead.'
    );
  }
  const fileName = videoPath.slice(videoPath.lastIndexOf('/') + 1);
  const dotIndex = fileName.lastIndexOf('.');
  const base = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  // Targets the cache dir explicitly rather than "next to" videoPath — defense in depth, since
  // inputs are now always app-owned cache files anyway (see copyPickedAssetToCache), but this
  // keeps outputPathFor correct even if a future source lives in a non-writable directory.
  return `${CachesDirectoryPath}/${base}_burned.mp4`;
}
