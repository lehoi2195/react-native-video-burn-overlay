# Changelog

All notable changes to this project are documented here.

## [0.0.3] - 2026-08-13

### Changed

- README: added example-app screenshots, moved the "Example app" section right after "Features", and restructured several long prose paragraphs (`cropAspectRatio`, `fontSize`, `fontWeight`, example-app description) into bullet lists.

## [0.0.2] - 2026-08-12

### Fixed

- `repository`, `homepage`, and `bugs` URLs in `package.json`, `README.md`, and `VideoOverlay.podspec` now point to the package's actual repo (`lehoi2195/rn-video-overlay`) instead of a stale name from before the rename.

## [0.0.1] - 2026-08-12

Initial release.

### Added

- `burnOverlay(options)` — burns text or image cues permanently into a video's pixels via native APIs only (AVFoundation on iOS, MediaCodec + OpenGL ES on Android), no FFmpeg.
- Text cues (`lines`) with `textColor`, `strokeColor`, `strokeWidth`, `fontFamily`, `fontWeight`, `fontScale`, `fontSize`.
- Image cues (`imagePath`) for arbitrary pre-rendered overlays, e.g. via `react-native-view-shot`.
- 9 preset anchor positions or an exact `{ x, y }` coordinate, plus `marginRatio` and `opacity`.
- `cropAspectRatio` to center-crop the output to a fixed ratio, keeping a custom preview UI and the burned result in agreement.
- Example app demonstrating text/image overlays, live camera recording, and picking video from the library.
