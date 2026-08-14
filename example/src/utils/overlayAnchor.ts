import type {
  OverlayPosition,
  OverlayPositionCoordinate,
} from 'react-native-video-burn-overlay';

export interface OverlayAnchor {
  left: number;
  top: number;
}

function isCoordinate(
  position: OverlayPosition
): position is OverlayPositionCoordinate {
  return typeof position === 'object';
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Reproduces the native anchor math so the preview lines up with the burned video frame. */
export function computeOverlayAnchor(
  position: OverlayPosition,
  frameWidth: number,
  frameHeight: number,
  contentWidth: number,
  contentHeight: number,
  marginRatio: number
): OverlayAnchor {
  if (isCoordinate(position)) {
    return {
      left: clamp01(position.x) * (frameWidth - contentWidth),
      top: clamp01(position.y) * (frameHeight - contentHeight),
    };
  }

  const marginPx = frameWidth * marginRatio;
  const isLeft =
    position === 'topLeft' ||
    position === 'centerLeft' ||
    position === 'bottomLeft';
  const isRight =
    position === 'topRight' ||
    position === 'centerRight' ||
    position === 'bottomRight';
  const isTop =
    position === 'topLeft' ||
    position === 'topCenter' ||
    position === 'topRight';
  const isBottom =
    position === 'bottomLeft' ||
    position === 'bottomCenter' ||
    position === 'bottomRight';

  let left: number;
  if (isRight) {
    left = frameWidth - marginPx - contentWidth;
  } else if (isLeft) {
    left = marginPx;
  } else {
    left = (frameWidth - contentWidth) / 2;
  }

  let top: number;
  if (isTop) {
    top = marginPx;
  } else if (isBottom) {
    top = frameHeight - marginPx - contentHeight;
  } else {
    top = (frameHeight - contentHeight) / 2;
  }

  return { left, top };
}

export interface PositionFraction {
  x: number;
  y: number;
}

const PRESET_FRACTIONS: Record<string, PositionFraction> = {
  topLeft: { x: 0, y: 0 },
  topCenter: { x: 0.5, y: 0 },
  topRight: { x: 1, y: 0 },
  centerLeft: { x: 0, y: 0.5 },
  center: { x: 0.5, y: 0.5 },
  centerRight: { x: 1, y: 0.5 },
  bottomLeft: { x: 0, y: 1 },
  bottomCenter: { x: 0.5, y: 1 },
  bottomRight: { x: 1, y: 1 },
};

/** Resolves a position to a bare point, ignoring content size. */
export function positionToFraction(
  position: OverlayPosition
): PositionFraction {
  if (isCoordinate(position)) {
    return { x: clamp01(position.x), y: clamp01(position.y) };
  }
  return PRESET_FRACTIONS[position] ?? PRESET_FRACTIONS.bottomLeft!;
}

/** Horizontal side a position resolves to, used to mirror layout details like accent bar side. */
export function getHorizontalAlign(
  position: OverlayPosition
): 'left' | 'center' | 'right' {
  if (isCoordinate(position)) {
    if (position.x < 0.4) {
      return 'left';
    }
    if (position.x > 0.6) {
      return 'right';
    }
    return 'center';
  }
  if (
    position === 'topLeft' ||
    position === 'centerLeft' ||
    position === 'bottomLeft'
  ) {
    return 'left';
  }
  if (
    position === 'topRight' ||
    position === 'centerRight' ||
    position === 'bottomRight'
  ) {
    return 'right';
  }
  return 'center';
}
