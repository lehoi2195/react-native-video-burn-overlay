# Changelog

All notable changes to this project are documented here.

## [0.0.7] - 2026-09-24

### Added

- `maxBitRate` option on `burnOverlay` and `burnLayers`: caps the video bitrate (bits/s) so the output fits an upload size limit in a single pass. Caps below 100 kbps are raised to 100 kbps.
- `setKeepScreenOn(enabled)`: keeps the screen awake so auto-lock can't background the app mid-burn; reset automatically on a JS reload.

### Changed

- iOS: both burners now run on a shared `AVAssetReader` → CPU overlay blit → `AVAssetWriter` pipeline (`VOBurnPipeline`) instead of `AVAssetExportSession` + `AVVideoCompositionCoreAnimationTool`. Overlays are pre-rendered to a bitmap and re-composited only when the visible set changes, so most frames cost a single small blit — burns are much faster.
- iOS: video is encoded at the source bitrate ×1.5 (floor 1 Mbps, ceiling 20 Mbps or the source bitrate, whichever is higher) instead of the `HighestQuality` preset, giving smaller files at the same visual quality; AAC audio is copied untouched instead of re-encoded; source frame timing is preserved (no dropped/duplicated frames).
- Android: the 24 Mbps bitrate ceiling no longer undercuts high-bitrate (e.g. 4K) sources.

### Fixed

- iOS: burns no longer fail with `-11847 Operation Interrupted` when the app backgrounds mid-burn (background task assertion), and a failed burn is retried once.
- Android: hardware decoders on some MediaTek/Unisoc devices that reject a file at `configure()`/`start()` now fall back to the platform software decoder instead of failing the burn.

## [0.0.6] - 2026-08-14

### Added

- `burnLayers(options)` — burns a stack of layers into a video at once (not a timeline), each with its own position, size, opacity, rotation, and time window. Mixes text and image layers freely.
- Tiled watermarks: any layer can repeat across the whole frame via `tile` (angle, spacing, anchor, scale, stagger for a brick pattern).
- Android native pipeline: `VideoLayerBurner`, `LayerRenderer`, `VideoTranscodeEngine` (decode/encode/mux engine shared with `burnOverlay`), `LayerTextBitmapFactory`, `OverlayLayerConfig`/parser, `GlUtil`.
- iOS native pipeline: `VideoLayerBurner.h`/`.m`.
- Example app: `burnLayers` demo screen with a live layer-stack editor, presets (logo + caption, stock watermark), and tile controls.

### Fixed

- Image layers silently missing from `burnLayers` output in debug builds — bundled `require()` assets resolve to a Metro `http://` dev-server URL, which native `decodeFile` can't read. Such sources are now downloaded to a local cache file before burning.

## [0.0.5] - 2026-08-14

### Changed

- Renamed the package from `rn-video-overlay` to `react-native-video-burn-overlay` — shorter/abbreviated `rn-` prefixes rank worse in npm search than the full `react-native-` prefix. Repo, README, and podspec URLs updated to match; git history and tags carried over unchanged.

## [0.0.4] - 2026-08-13

### Changed

- `package.json` `keywords` expanded from 3 to 23 terms for npm search discoverability (video overlay/watermark/timestamp/gps use cases, `react-native-video-overlay` for the pre-rename package name, platform/technical terms).

## [0.0.3] - 2026-08-13

### Changed

- README: added example-app screenshots, moved the "Example app" section right after "Features", and restructured several long prose paragraphs (`cropAspectRatio`, `fontSize`, `fontWeight`, example-app description) into bullet lists.

## [0.0.2] - 2026-08-12

### Fixed

- `repository`, `homepage`, and `bugs` URLs in `package.json`, `README.md`, and `VideoOverlay.podspec` now point to the package's actual repo (`lehoi2195/react-native-video-burn-overlay`) instead of a stale name from before the rename.

## [0.0.1] - 2026-08-12

Initial release.

### Added

- `burnOverlay(options)` — burns text or image cues permanently into a video's pixels via native APIs only (AVFoundation on iOS, MediaCodec + OpenGL ES on Android), no FFmpeg.
- Text cues (`lines`) with `textColor`, `strokeColor`, `strokeWidth`, `fontFamily`, `fontWeight`, `fontScale`, `fontSize`.
- Image cues (`imagePath`) for arbitrary pre-rendered overlays, e.g. via `react-native-view-shot`.
- 9 preset anchor positions or an exact `{ x, y }` coordinate, plus `marginRatio` and `opacity`.
- `cropAspectRatio` to center-crop the output to a fixed ratio, keeping a custom preview UI and the burned result in agreement.
- Example app demonstrating text/image overlays, live camera recording, and picking video from the library.
