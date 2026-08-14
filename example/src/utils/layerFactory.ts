import type { OverlayLayer } from 'react-native-video-burn-overlay';
import type { EditableLayer, OverlayLayerType } from '../types';
import { BUNDLED_LAYER_ASSETS } from './layerAssets';

/** Short unique id for list keys; not used by the native side at all. */
export function generateLayerId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function blankImageLayer(): OverlayLayer {
  return {
    type: 'image',
    source: BUNDLED_LAYER_ASSETS[0]!.path,
    width: 160,
  };
}

function blankTextLayer(): OverlayLayer {
  return {
    type: 'text',
    text: 'New layer',
  };
}

/** A fresh layer of the given type, with no position/opacity/tile overrides yet. */
export function createBlankLayer(type: OverlayLayerType): EditableLayer {
  const base = type === 'image' ? blankImageLayer() : blankTextLayer();
  return { ...base, id: generateLayerId() };
}

/** Switches a layer's type, keeping shared base fields and dropping type-specific ones. */
export function switchLayerType(
  layer: EditableLayer,
  type: OverlayLayerType
): EditableLayer {
  if (layer.type === type) {
    return layer;
  }
  const shared = {
    position: layer.position,
    marginRatio: layer.marginRatio,
    opacity: layer.opacity,
    rotation: layer.rotation,
    startSec: layer.startSec,
    endSec: layer.endSec,
    tile: layer.tile,
  };
  const fresh = type === 'image' ? blankImageLayer() : blankTextLayer();
  return { ...shared, ...fresh, id: layer.id };
}

/** Drops the local editor id, leaving a plain `OverlayLayer` ready for `burnLayers`. */
export function stripLayerId(layer: EditableLayer): OverlayLayer {
  const plain: OverlayLayer =
    layer.type === 'image' ? { ...layer } : { ...layer };
  const withoutId = plain as OverlayLayer & { id?: string };
  delete withoutId.id;
  return withoutId;
}
