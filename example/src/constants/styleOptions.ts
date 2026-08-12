import { Platform } from 'react-native';
import type { OverlayPositionPreset } from 'rn-video-overlay';
import type { OverlayFontWeight, ResolvedOverlayStyle } from '../types';

// Seed value for the Auto-to-Fixed switch, roughly matching the auto formula's 1080p output.
export const DEFAULT_FONT_SIZE_PX = 40;

// fontSize stays undefined by default — auto/fontScale mode self-scales correctly for any video
// resolution, while a fixed fontSize is an opt-in advanced feature (see README's fontSize note).
export const DEFAULT_STYLE: ResolvedOverlayStyle = {
  textColor: '#000000',
  strokeColor: '#000000',
  fontFamily: undefined,
  fontWeight: 'normal',
  fontScale: 1,
  fontSize: undefined,
  // 0 disables the outline; strokeColor is kept as the value a stroke-color tap re-enables.
  strokeWidth: 0,
  position: 'topRight',
  marginRatio: 0.05,
  opacity: 1,
};

export const TEXT_COLORS: readonly string[] = [
  '#FFFFFF',
  '#FFD60A',
  '#00E5FF',
  '#FF453A',
  '#000000',
];

export const STROKE_COLORS: readonly string[] = [
  '#000000',
  '#FFFFFF',
  '#3A3A3C',
  '#8B0000',
];

export interface FontFamilyOption {
  label: string;
  value: string | undefined;
}

// System font names only — no bundled fonts required to run the example.
const IOS_FONT_FAMILIES: readonly FontFamilyOption[] = [
  { label: 'System Default', value: undefined },
  { label: 'Helvetica', value: 'Helvetica-Bold' },
  { label: 'Courier', value: 'Courier-Bold' },
  { label: 'Georgia', value: 'Georgia-Bold' },
  { label: 'Avenir', value: 'AvenirNext-Bold' },
];

const ANDROID_FONT_FAMILIES: readonly FontFamilyOption[] = [
  { label: 'System Default', value: undefined },
  { label: 'Sans Black', value: 'sans-serif-black' },
  { label: 'Condensed', value: 'sans-serif-condensed' },
  { label: 'Serif', value: 'serif' },
  { label: 'Monospace', value: 'monospace' },
];

export const FONT_FAMILIES: readonly FontFamilyOption[] = Platform.select({
  ios: IOS_FONT_FAMILIES,
  default: ANDROID_FONT_FAMILIES,
});

export interface FontWeightOption {
  label: string;
  value: OverlayFontWeight;
}

// Curated subset of the 100-900 scale to avoid cluttering the chip row.
export const FONT_WEIGHTS: readonly FontWeightOption[] = [
  { label: 'Light', value: '300' },
  { label: 'Normal', value: 'normal' },
  { label: 'Medium', value: '500' },
  { label: 'Semibold', value: '600' },
  { label: 'Bold', value: 'bold' },
  { label: 'Black', value: '900' },
];

export interface PositionOption {
  label: string;
  value: OverlayPositionPreset;
}

export const POSITION_OPTIONS: readonly PositionOption[] = [
  { label: 'Top Left', value: 'topLeft' },
  { label: 'Top Center', value: 'topCenter' },
  { label: 'Top Right', value: 'topRight' },
  { label: 'Middle Left', value: 'centerLeft' },
  { label: 'Center', value: 'center' },
  { label: 'Middle Right', value: 'centerRight' },
  { label: 'Bottom Left', value: 'bottomLeft' },
  { label: 'Bottom Center', value: 'bottomCenter' },
  { label: 'Bottom Right', value: 'bottomRight' },
];

export const FONT_SCALE_MIN = 0.5;
export const FONT_SCALE_MAX = 3;
export const FONT_SCALE_STEP = 0.1;

export const FONT_SIZE_PX_MIN = 12;
export const FONT_SIZE_PX_MAX = 200;
export const FONT_SIZE_PX_STEP = 2;

export const MARGIN_RATIO_MIN = 0;
export const MARGIN_RATIO_MAX = 0.5;
export const MARGIN_RATIO_STEP = 0.01;

export const COORDINATE_STEP = 0.05;

export const OPACITY_MIN = 0;
export const OPACITY_MAX = 1;
export const OPACITY_STEP = 0.05;

// Small default box; photos are captured into a fixed size regardless of actual resolution.
// Width and height are independent so the capture box needn't be square.
export const DEFAULT_IMAGE_OVERLAY_WIDTH = 30;
export const DEFAULT_IMAGE_OVERLAY_HEIGHT = 30;
export const IMAGE_OVERLAY_DIMENSION_MIN = 10;
export const IMAGE_OVERLAY_DIMENSION_MAX = 150;
export const IMAGE_OVERLAY_DIMENSION_STEP = 5;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
