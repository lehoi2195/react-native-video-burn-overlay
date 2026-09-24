import NativeVideoOverlay from './NativeVideoOverlay';
import type { OverlayFontWeight, OverlayPosition } from './types';

export type {
  OverlayFontWeight,
  OverlayPosition,
  OverlayPositionCoordinate,
  OverlayPositionPreset,
} from './types';

export {
  burnLayers,
  type BurnLayersOptions,
  type ImageOverlayLayer,
  type OverlayLayer,
  type TextOverlayLayer,
  type TileConfig,
} from './burnLayers';

/** A time-ranged overlay: use `lines` or `imagePath`; imagePath takes priority if both set. */
export interface OverlayCue {
  /** Start of this cue's visibility window, in seconds relative to the video's own timeline. */
  startSec: number;
  /** End of this cue's visibility window (exclusive), in seconds. */
  endSec: number;
  /** Plain text mode: one string per line, drawn top-to-bottom by native code, cheaply. */
  lines?: string[];
  /** Filesystem path to a pre-rendered PNG; native composites at its own size, no auto-scaling. */
  imagePath?: string;
}

/** Text/font/position/margin for the overlay; omitted fields fall back to native defaults. */
export interface OverlayStyle {
  /** Hex `#RRGGBB` or `#AARRGGBB`. Default `'#FFFFFF'`. `lines` mode only. */
  textColor?: string;
  /** Outline color behind fill for legibility; default `'#000000'`, set equal to textColor to hide. */
  strokeColor?: string;
  /** Outline thickness in px; 0 disables it. Defaults to an auto font-relative size. */
  strokeWidth?: number;
  /** Platform font name (iOS PostScript, Android family); unknown names silently fall back to default. */
  fontFamily?: string;
  /** Matches CSS fontWeight scale; ignored on iOS when fontFamily is set, but Android still applies. */
  fontWeight?: OverlayFontWeight;
  /** Multiplier on auto-computed font size (from video's shorter edge); ignored if fontSize is set. */
  fontScale?: number;
  /** Absolute pixel size, bypassing auto-computed sizing; fontScale is not also applied on top. */
  fontSize?: number;
  /** Named preset or exact {x,y}; marginRatio ignored for coordinates. Default `'bottomLeft'`. */
  position?: OverlayPosition;
  /** Margin from anchor edges, as a fraction of video width (0–0.5); applies to both axes. */
  marginRatio?: number;
  /** Overlay opacity: real native alpha blending against video pixels, not a JS approximation. */
  opacity?: number;
}

export interface BurnOverlayOptions {
  /** Source video path. No `file://` prefix. Never modified or deleted. */
  inputPath: string;
  /** Output video path. Must differ from `inputPath`. */
  outputPath: string;
  /** What to draw and when. */
  cues: OverlayCue[];
  /** One style for the whole call. */
  style?: OverlayStyle;
  /** Center-crops output to this width/height ratio (e.g. `3/4`); trims only, never letterboxes. */
  cropAspectRatio?: number;
  /** Video bitrate cap in bits/s, e.g. from an upload size limit; omit for no cap. */
  maxBitRate?: number;
}

/** Blocks idle auto-lock (not the power button) while enabled; turn it off when done. */
export function setKeepScreenOn(enabled: boolean): void {
  NativeVideoOverlay.setKeepScreenOn(enabled);
}

/** Burns cues (text or image) permanently into the video; source video is never modified. */
export async function burnOverlay(
  options: BurnOverlayOptions
): Promise<string> {
  const { inputPath, outputPath, cues, style, cropAspectRatio, maxBitRate } =
    options;
  // Options ride the style JSON both platforms already parse, so they need no codegen change.
  return NativeVideoOverlay.burnOverlay(
    inputPath,
    outputPath,
    JSON.stringify(cues),
    JSON.stringify({ ...(style ?? {}), cropAspectRatio, maxBitRate })
  );
}
