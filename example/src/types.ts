import type { OverlayPosition } from '@rx/react-native-video-overlay';

/** Lifecycle of the `burnOverlay` call driving the status UI in `App`. */
export type BurnStatus = 'idle' | 'burning' | 'done' | 'error';

/** Which `OverlayCue` field the demo burns: plain `lines` text or a captured `imagePath` PNG. */
export type OverlayMode = 'text' | 'image';

/** Fully-resolved style values the panel edits live; every field is concrete, not optional. */
/** Mirrors `OverlayStyle['fontWeight']` — the CSS/React Native numeric weight scale, `'bold'` an alias for `'700'`. */
export type OverlayFontWeight =
  | 'normal'
  | 'bold'
  | '100'
  | '200'
  | '300'
  | '400'
  | '500'
  | '600'
  | '700'
  | '800'
  | '900';

export interface ResolvedOverlayStyle {
  textColor: string;
  strokeColor: string;
  fontFamily: string | undefined;
  fontWeight: OverlayFontWeight;
  fontScale: number;
  /** Absolute pixel size, overriding fontScale entirely when set; undefined keeps default behavior. */
  fontSize: number | undefined;
  /** Outline thickness in px; 0 disables it, undefined keeps the native auto default. */
  strokeWidth: number | undefined;
  position: OverlayPosition;
  marginRatio: number;
  /** Applies to both text and image cues. 0–1, default 1 (fully visible). */
  opacity: number;
}
