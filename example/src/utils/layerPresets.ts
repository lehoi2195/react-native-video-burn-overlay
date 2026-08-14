import type { EditableLayer } from '../types';
import { generateLayerId } from './layerFactory';
import { BUNDLED_LAYER_ASSETS } from './layerAssets';

/** Image topLeft plus text bottomCenter: two layers visible at once. */
export function buildLogoCaptionPreset(): EditableLayer[] {
  return [
    {
      id: generateLayerId(),
      type: 'image',
      source: BUNDLED_LAYER_ASSETS[0]!.path,
      width: 120,
      position: 'topLeft',
      marginRatio: 0.05,
      opacity: 1,
    },
    {
      id: generateLayerId(),
      type: 'text',
      text: 'Los Angeles, CA',
      position: 'bottomCenter',
      marginRatio: 0.06,
      fontColor: '#FFFFFF',
      strokeColor: '#000000',
      fontWeight: '600',
    },
  ];
}

/** Tiled diagonal text at low opacity — the classic repeated stock-photo watermark look. */
export function buildStockWatermarkPreset(): EditableLayer[] {
  return [
    {
      id: generateLayerId(),
      type: 'text',
      text: 'SAMPLE',
      opacity: 0.35,
      fontColor: '#FFFFFF',
      strokeColor: '#000000',
      fontWeight: '700',
      tile: {
        angle: -30,
        spacingX: 0.3,
        spacingY: 0.3,
        anchor: 'center',
        scale: 1,
        stagger: false,
      },
    },
  ];
}
