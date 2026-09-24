import {
  CachesDirectoryPath,
  copyFile,
  downloadFile,
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

/** Picks the most-readable raw picker path (`uri` over FUSE `originalPath`); still copy it to cache. */
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
  // Guards against content:// URIs whose last segment is a numeric id, not an extension.
  return /^[A-Za-z0-9]{1,5}$/.test(candidate)
    ? candidate.toLowerCase()
    : undefined;
}

/** Copies a picked photo/video into app-owned cache, avoiding picker FUSE/ph:// path quirks. */
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

// Caches per-URL downloads so repeat burns don't refetch the same bundled dev-server asset.
const remoteAssetCache = new Map<string, Promise<string>>();

// Debug bundled assets resolve to an http:// dev-server URL, unreadable by native decodeFile.
export async function resolveNativeReadableSource(
  source: string
): Promise<string> {
  if (!source.startsWith('http://') && !source.startsWith('https://')) {
    return source;
  }
  const cached = remoteAssetCache.get(source);
  if (cached) {
    return cached;
  }
  const extension = extensionOf(source) ?? 'png';
  const destination = `${CachesDirectoryPath}/bundled_${hashCode(source)}.${extension}`;
  const promise = downloadFile({ fromUrl: source, toFile: destination })
    .promise.then(() => destination)
    .catch((error: unknown) => {
      remoteAssetCache.delete(source);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not download bundled layer asset: ${message}`);
    });
  remoteAssetCache.set(source, promise);
  return promise;
}

/** Cheap deterministic string hash, for a stable per-URL cache filename. */
function hashCode(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
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
  // Target the cache dir, not videoPath's folder, in case a source dir is read-only.
  return `${CachesDirectoryPath}/${base}_burned.mp4`;
}
