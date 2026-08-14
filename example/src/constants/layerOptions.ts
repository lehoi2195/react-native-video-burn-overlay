import type { OverlayLayerType } from '../types';

export const ROTATION_MIN = -180;
export const ROTATION_MAX = 180;
export const ROTATION_STEP = 5;

export const TIME_SEC_MIN = 0;
export const TIME_SEC_MAX = 600;
export const TIME_SEC_STEP = 1;

export const IMAGE_LAYER_DIMENSION_MIN = 20;
export const IMAGE_LAYER_DIMENSION_MAX = 800;
export const IMAGE_LAYER_DIMENSION_STEP = 10;

export const TILE_SPACING_MIN = 0.02;
export const TILE_SPACING_MAX = 2;
export const TILE_SPACING_STEP = 0.02;

export const TILE_SCALE_MIN = 0.2;
export const TILE_SCALE_MAX = 3;
export const TILE_SCALE_STEP = 0.1;

export const DEFAULT_TILE_ANGLE = -30;
export const DEFAULT_TILE_SPACING = 0.3;
export const DEFAULT_TILE_SCALE = 1;

export interface LayerTypeOption {
  label: string;
  value: OverlayLayerType;
}

export const LAYER_TYPE_OPTIONS: readonly LayerTypeOption[] = [
  { label: 'Image', value: 'image' },
  { label: 'Text', value: 'text' },
];
