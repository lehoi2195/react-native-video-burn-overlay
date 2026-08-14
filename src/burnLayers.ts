import NativeVideoOverlay from './NativeVideoOverlay';
import type { OverlayFontWeight, OverlayPosition } from './types';

/** Repeats one layer across the whole frame, like a stock-photo watermark. */
export interface TileConfig {
  /** Rotation of the whole lattice, degrees clockwise; -30 gives the classic diagonal look. */
  angle?: number;
  /** Horizontal step between tile origins, as a fraction of frame width. Clamped 0.02–2. */
  spacingX?: number;
  /** Vertical step, also a fraction of frame WIDTH, so tiles stay square-ish on any aspect. */
  spacingY?: number;
  /** Where the origin tile sits; the grid expands outward from it. Default `'center'`. */
  anchor?: OverlayPosition;
  /** Size multiplier per tile, on top of width/height or fontSize. Clamped 0.05–10. */
  scale?: number;
  /** Offsets every other row by half a step, giving a brick pattern. */
  stagger?: boolean;
}

/** Fields every layer shares, regardless of type. */
interface BaseOverlayLayer {
  /** Named preset or exact {x,y}; ignored entirely when `tile` is set. Default `'bottomLeft'`. */
  position?: OverlayPosition;
  /** Margin from anchor edges, 0–0.5 of width; ignored for tiles. */
  marginRatio?: number;
  /** This layer's own alpha, independent of every other layer. Clamped 0–1. */
  opacity?: number;
  /** Degrees clockwise about the layer's own centre. Composes with `tile.angle`. */
  rotation?: number;
  /** When this layer becomes visible, in seconds. Default 0. */
  startSec?: number;
  /** When it stops being visible (exclusive). Defaults to the video's own duration. */
  endSec?: number;
  /** Repeat this layer across the frame instead of placing it once. */
  tile?: TileConfig;
}

/** An image layer; the file is decoded once up front, not per frame. */
export interface ImageOverlayLayer extends BaseOverlayLayer {
  type: 'image';
  /** Filesystem path to a PNG/JPG, no `file://`. Decode failure skips the layer, burn still succeeds. */
  source: string;
  /** Target width in output-frame pixels; omit to use the image's own pixel width. */
  width?: number;
  /** Omit to derive from `width` keeping aspect; setting both stretches the image deliberately. */
  height?: number;
}

/** A text layer; carries its own font styling rather than sharing one global style. */
export interface TextOverlayLayer extends BaseOverlayLayer {
  type: 'text';
  /** `\n` splits into lines drawn top-to-bottom; an empty string skips the layer. */
  text: string;
  /** Absolute pixel size, bypassing auto sizing; wins over `fontScale`. */
  fontSize?: number;
  /** Multiplier on the auto size computed from the frame's shorter edge. Clamped 0.5–3. */
  fontScale?: number;
  /** Hex `#RRGGBB` or `#AARRGGBB`. Default `'#FFFFFF'`. */
  fontColor?: string;
  /** Outline behind the fill for legibility; match `fontColor` to hide it. */
  strokeColor?: string;
  /** Outline thickness in px; 0 disables it entirely. */
  strokeWidth?: number;
  /** Platform font name; unknown names silently fall back to the default. */
  fontFamily?: string;
  /** CSS-style weight; ignored on iOS when fontFamily is set, but Android still applies it. */
  fontWeight?: OverlayFontWeight;
}

/** One entry in the layer stack, discriminated by `type`. */
export type OverlayLayer = ImageOverlayLayer | TextOverlayLayer;

export interface BurnLayersOptions {
  /** Source video path. No `file://` prefix. Never modified or deleted. */
  inputPath: string;
  /** Output video path. Must differ from `inputPath`. */
  outputPath: string;
  /** Drawn in array order: index 0 is bottom, last is top. */
  layers: OverlayLayer[];
  /** Center-crops the output to this width/height ratio; only ever trims, never letterboxes. */
  cropAspectRatio?: number;
}

/** Burns a stack of layers visible at once, each with its own position and style. */
export async function burnLayers(options: BurnLayersOptions): Promise<string> {
  const { inputPath, outputPath, layers, cropAspectRatio } = options;
  if (layers.length === 0) {
    throw new Error('burnLayers: `layers` must not be empty');
  }
  return NativeVideoOverlay.burnLayers(
    inputPath,
    outputPath,
    JSON.stringify(layers),
    JSON.stringify({ cropAspectRatio })
  );
}
