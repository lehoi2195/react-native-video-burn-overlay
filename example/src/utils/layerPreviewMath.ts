import type { TileConfig } from 'react-native-video-burn-overlay';
import { positionToFraction } from './overlayAnchor';

// Mirrors the native font-size formula: max(14, min(frameW,frameH) * 0.032) * fontScale.
const FONT_SIZE_RATIO = 0.032;
const MIN_FONT_SIZE = 14;
// Fallback used before a video is picked, when real width is unknown.
const DEFAULT_VIDEO_WIDTH = 1920;

/** Preview-space font size, scaled the same way OverlayPreview scales style.fontSize. */
export function computePreviewFontSize(
  frameWidth: number,
  frameHeight: number,
  fontSize: number | undefined,
  fontScale: number | undefined,
  sourceWidth: number | undefined
): number {
  if (fontSize !== undefined) {
    return Math.max(
      1,
      fontSize * (frameWidth / (sourceWidth ?? DEFAULT_VIDEO_WIDTH))
    );
  }
  const auto = Math.max(
    MIN_FONT_SIZE,
    Math.min(frameWidth, frameHeight) * FONT_SIZE_RATIO
  );
  return auto * (fontScale ?? 1);
}

// Caps preview tiles per axis; native's own 400 cap is separate.
const MAX_GRID_AXIS = 11;

export interface TileGridLayout {
  columns: number;
  rows: number;
  spacingXpx: number;
  spacingYpx: number;
  boxWidth: number;
  boxHeight: number;
  centerLeft: number;
  centerTop: number;
  angleDeg: number;
  staggerOffsetPx: number;
}

function clampOddAxis(value: number): number {
  const capped = Math.min(Math.max(value, 3), MAX_GRID_AXIS);
  return capped % 2 === 0 ? capped + 1 : capped;
}

/** A grid sized to cover the frame after rotation, centered on the tile's anchor point. */
export function computeTileGridLayout(
  frameWidth: number,
  frameHeight: number,
  tile: TileConfig
): TileGridLayout {
  const spacingXpx = Math.max(1, (tile.spacingX ?? 0.25) * frameWidth);
  const spacingYpx = Math.max(1, (tile.spacingY ?? 0.25) * frameWidth);
  const diagonal = Math.sqrt(frameWidth ** 2 + frameHeight ** 2);

  const columns = clampOddAxis(Math.ceil(diagonal / spacingXpx) * 2 + 1);
  const rows = clampOddAxis(Math.ceil(diagonal / spacingYpx) * 2 + 1);
  const anchorFraction = positionToFraction(tile.anchor ?? 'center');

  return {
    columns,
    rows,
    spacingXpx,
    spacingYpx,
    boxWidth: columns * spacingXpx,
    boxHeight: rows * spacingYpx,
    centerLeft: anchorFraction.x * frameWidth,
    centerTop: anchorFraction.y * frameHeight,
    angleDeg: tile.angle ?? 0,
    staggerOffsetPx: tile.stagger ? spacingXpx / 2 : 0,
  };
}
