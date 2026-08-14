import { Image } from 'react-native';
import { stripFileScheme } from './videoPaths';

export interface BundledLayerAsset {
  label: string;
  path: string;
}

// require() (not import) sidesteps needing a `declare module '*.png'` ambient type.
function resolveBundledPath(moduleId: number): string {
  const resolved = Image.resolveAssetSource(moduleId);
  return resolved ? stripFileScheme(resolved.uri) : '';
}

/** Bundled sample images usable as image-layer `source` in the burnLayers demo. */
export const BUNDLED_LAYER_ASSETS: readonly BundledLayerAsset[] = [
  {
    label: 'Demo Logo',
    path: resolveBundledPath(require('../assest/demo.png')),
  },
  {
    label: 'Demo Logo 2',
    path: resolveBundledPath(require('../assest/demo2.png')),
  },
];
