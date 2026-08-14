/** One of the 9 named preset positions (3x3 grid) an overlay can anchor to. */
export type OverlayPositionPreset =
  | 'topLeft'
  | 'topCenter'
  | 'topRight'
  | 'centerLeft'
  | 'center'
  | 'centerRight'
  | 'bottomLeft'
  | 'bottomCenter'
  | 'bottomRight';

/** Exact 0-1 coordinate placement, bypassing marginRatio; (0,0) top-left, (1,1) bottom-right. */
export interface OverlayPositionCoordinate {
  x: number;
  y: number;
}

/** Which corner/edge/center the overlay anchors to, or an exact `{x,y}` coordinate. */
export type OverlayPosition = OverlayPositionPreset | OverlayPositionCoordinate;

/** Matches the CSS fontWeight scale; `'normal'` maps to 400 and `'bold'` to 700. */
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
