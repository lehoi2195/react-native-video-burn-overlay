# `burnLayers` — Multi-Overlay Layer Stack + Tiled Watermark

Spec for a **new, additive** burn API. The existing `burnOverlay` (cue timeline, one
active content block, one global style) is **frozen** — no behavior changes, no signature
changes, no removal.

## 1. Why a new API

`burnOverlay` models a **timeline**: at any timestamp exactly one cue is active, and every
cue shares one global `OverlayStyle` (one position, one opacity, one font). It cannot draw
a logo top-left *and* a caption bottom-center simultaneously, because both the native
renderers resolve a single active cue per frame.

`burnLayers` models a **layer stack**: N independent layers, each with its own type,
position, size, opacity, rotation, and optional time window, all composited onto the same
frame. Plus a `tile` mode that repeats one layer across the whole frame (stock-photo
watermark).

## 2. Public TypeScript API

```ts
burnLayers(options: BurnLayersOptions): Promise<string>
```

### 2.1 `BurnLayersOptions`

| Field | Type | Default | Notes |
|---|---|---|---|
| `inputPath` | `string` | required | Source video path, no `file://`. Never modified. |
| `outputPath` | `string` | required | Must differ from `inputPath`. |
| `layers` | `OverlayLayer[]` | required | Drawn in array order: index 0 is **bottom**, last is **top**. Empty array rejects with `INVALID_LAYERS`. |
| `cropAspectRatio` | `number?` | `undefined` | Same semantics as `burnOverlay`: center-crop only, never letterbox. Layer anchoring and auto font size compute against the cropped frame. |

### 2.2 Layer common fields (`BaseLayer`)

| Field | Type | Default | Notes |
|---|---|---|---|
| `position` | `OverlayPosition?` | `'bottomLeft'` | Reused from `burnOverlay`: 9 camelCase presets or `{x,y}` 0–1. Ignored when `tile` is set. |
| `marginRatio` | `number?` | `0.05` | Fraction of frame **width**, clamped `[0, 0.5]`. Ignored for `{x,y}` positions and for `tile`. |
| `opacity` | `number?` | `1` | Clamped `[0, 1]`. Real native alpha blend. |
| `rotation` | `number?` | `0` | Degrees **clockwise**, about the layer's own center. Any finite value. |
| `startSec` | `number?` | `0` | Layer becomes visible at this time. |
| `endSec` | `number?` | video duration | Exclusive. `endSec <= startSec` ⇒ `INVALID_LAYERS`. |
| `tile` | `TileConfig?` | `undefined` | When present, the layer repeats across the whole frame; see §2.5. |

Layers are **independent** — overlapping time windows are normal and expected. There is no
cursor/timeline; every layer is evaluated per frame.

### 2.3 `ImageLayer`

| Field | Type | Default | Notes |
|---|---|---|---|
| `type` | `'image'` | required | Discriminant. |
| `source` | `string` | required | Filesystem path to PNG/JPG, no `file://`. Decode failure ⇒ layer skipped with a native warning log, burn still succeeds. |
| `width` | `number?` | image's own px width | Target width in **output-frame pixels**. |
| `height` | `number?` | derived from `width` keeping aspect ratio | If both `width` and `height` are set, aspect ratio is **not** preserved (explicit stretch). If neither is set, the image draws at its native pixel size (matches `burnOverlay` behavior). |

### 2.4 `TextLayer`

| Field | Type | Default | Notes |
|---|---|---|---|
| `type` | `'text'` | required | Discriminant. |
| `text` | `string` | required | `\n` splits into lines, drawn top-to-bottom. Empty string ⇒ layer skipped. |
| `fontSize` | `number?` | auto from frame's shorter edge | Absolute px. Wins over `fontScale`. |
| `fontScale` | `number?` | `1` | Multiplier on the auto size, clamped `[0.5, 3]`. Ignored when `fontSize` is set. |
| `fontColor` | `string?` | `'#FFFFFF'` | `#RRGGBB` or `#AARRGGBB`. **Named `fontColor`**, not `textColor` — this is the new API's naming. |
| `strokeColor` | `string?` | `'#000000'` | Set equal to `fontColor` to visually hide. |
| `strokeWidth` | `number?` | auto (relative to font) | `0` disables the stroke. |
| `fontFamily` | `string?` | platform default | iOS PostScript name / Android family. Unknown names fall back silently. |
| `fontWeight` | `'normal' \| 'bold' \| '100'…'900'` | `'400'` | Same union as `OverlayStyle`. |

### 2.5 `TileConfig` — repeated watermark

When `tile` is set, the layer's content is repeated across the **entire frame** (edge to
edge, including partially-clipped tiles at the borders). `position` and `marginRatio` are
ignored; `anchor` controls the grid's phase instead.

| Field | Type | Default | Notes |
|---|---|---|---|
| `angle` | `number?` | `0` | Rotation of the **whole grid**, degrees clockwise. `-30` gives the classic diagonal stock watermark. Free-form, any finite value. |
| `spacingX` | `number?` | `0.25` | Horizontal step between tile origins, as a fraction of frame width. Clamped `[0.02, 2]`. |
| `spacingY` | `number?` | `0.25` | Vertical step, as a fraction of frame **width** (not height) so tiles stay square-ish on any aspect. Clamped `[0.02, 2]`. |
| `anchor` | `OverlayPosition?` | `'center'` | Where the grid's origin tile sits; the grid expands outward from it in all four directions. Presets or `{x,y}`. |
| `scale` | `number?` | `1` | Multiplier applied to each tile's size, clamped `[0.05, 10]`. Applies on top of `width`/`height` (image) or `fontSize` (text). |
| `stagger` | `boolean?` | `false` | Offsets every other row by half of `spacingX` (brick pattern) — visually denser without more tiles. |

`rotation` (per-layer, §2.2) and `tile.angle` compose: `rotation` turns each individual
tile in place; `tile.angle` turns the whole lattice. Setting only `tile.angle` (the common
case) rotates the tiles too, because the lattice rotation carries them.

**Tile-count guard:** the effective tile count is capped at **400** per layer. If the
requested spacing/angle would exceed it, spacing is widened until it fits and a native
warning is logged. This protects against `spacingX: 0.001` freezing the encoder.

### 2.6 Types (final shape)

```ts
export type OverlayLayerType = 'image' | 'text';

export interface TileConfig {
  angle?: number;
  spacingX?: number;
  spacingY?: number;
  anchor?: OverlayPosition;
  scale?: number;
  stagger?: boolean;
}

interface BaseOverlayLayer {
  position?: OverlayPosition;
  marginRatio?: number;
  opacity?: number;
  rotation?: number;
  startSec?: number;
  endSec?: number;
  tile?: TileConfig;
}

export interface ImageOverlayLayer extends BaseOverlayLayer {
  type: 'image';
  source: string;
  width?: number;
  height?: number;
}

export interface TextOverlayLayer extends BaseOverlayLayer {
  type: 'text';
  text: string;
  fontSize?: number;
  fontScale?: number;
  fontColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  fontFamily?: string;
  fontWeight?: OverlayFontWeight;
}

export type OverlayLayer = ImageOverlayLayer | TextOverlayLayer;

export interface BurnLayersOptions {
  inputPath: string;
  outputPath: string;
  layers: OverlayLayer[];
  cropAspectRatio?: number;
}
```

`OverlayPosition`, `OverlayPositionPreset`, `OverlayPositionCoordinate` are **reused
verbatim** from the existing API. `OverlayFontWeight` is extracted from the existing
inline union in `OverlayStyle` (a non-breaking refactor — the union members are identical).

## 3. Native bridge

New TurboModule method, added alongside the existing one (`burnOverlay` untouched):

```ts
burnLayers(
  videoPath: string,
  outputPath: string,
  layersJson: string,   // JSON-stringified OverlayLayer[]
  optionsJson: string   // JSON-stringified { cropAspectRatio?: number }
): Promise<string>
```

Same rationale as `burnOverlay`: complex payloads ride a JSON string because codegen
handles `string` most reliably.

## 4. Validation & error codes

Parsing follows the **existing split**: structural problems throw, cosmetic ones fall back.

| Condition | Behavior |
|---|---|
| `layersJson` not a JSON array | throw `INVALID_LAYERS` |
| empty array | throw `INVALID_LAYERS` |
| element not an object, or unknown/missing `type` | throw `INVALID_LAYERS` |
| `image` layer with blank `source` | throw `INVALID_LAYERS` |
| `text` layer with missing `text` key | throw `INVALID_LAYERS` |
| `endSec <= startSec` | throw `INVALID_LAYERS` |
| image file fails to decode at render time | log warning, skip that layer, burn succeeds |
| `text` resolves to empty string | skip that layer, burn succeeds |
| any style/tile field invalid (NaN, wrong type, bad hex) | fall back to that field's default, never throw |
| numeric field out of range | clamp to the documented range |

`INVALID_LAYERS` is a **new** error code; existing `INVALID_CUES` is untouched.

## 5. Native implementation strategy

### 5.1 Android (`android/src/main/java/com/rx/videooverlay/`)

Already GLES20 with hand-written GLSL, decode→GL texture→shader→encoder surface, fully on
GPU. Extending it is additive.

- **New** `OverlayLayerConfig.kt` — data classes (`OverlayLayerConfig`, `TileConfig`) +
  `OverlayLayerParser` mirroring `OverlayCueParser`/`OverlayStyleParser` conventions.
- **New** `LayerRenderer.kt` — per-frame draws N layers. Each layer owns its own texture
  (text layers rasterize once at init via the existing `OverlayBitmapRenderer` drawing
  logic; image layers decode once at init). Per-frame work is only `glDrawArrays` calls —
  **no per-frame bitmap or decode work**.
- **Tiling** uses `GL_REPEAT` wrap + a new fragment shader doing rotated-UV `fract()`
  sampling on a single full-frame quad ⇒ **one draw call regardless of tile count**. Note
  `createTexture2D()` currently hardcodes `GL_CLAMP_TO_EDGE`; the new renderer needs its
  own texture-creation path with selectable wrap mode rather than mutating the old one.
  NPOT textures cannot use `GL_REPEAT` on GLES2 — tile textures must be padded to
  power-of-two, or fall back to the N-draw-call path.
- **Rotation** reuses `Matrix.setRotateM`/`multiplyMM`, already imported. Note the existing
  overlay path draws with `identityMatrix`; rotation must not distort on non-square frames
  — apply an aspect-correction scale around the rotation.
- **Reuse the transcode loop.** `VideoOverlayBurner.kt` owns decode/encode/mux and is
  ~500 lines; do **not** copy it. Extract a minimal drawer interface (e.g.
  `internal interface OverlayFrameDrawer { fun drawFrame(stMatrix: FloatArray, ptsUs: Long, oesTextureId: Int); fun release() }`),
  have `FrameRenderer` implement it by moving its existing `CueTimeline` lookup inside,
  and have `LayerRenderer` implement it too. This is the **only** permitted edit to
  existing files, and `burnOverlay`'s observable behavior must be byte-identical after it.
- **New** entry point on `VideoOverlayModule.kt` (`burnLayers` override) reusing the same
  single-thread executor.

### 5.2 iOS (`ios/`)

Already `AVAssetExportSession` + `AVVideoCompositionCoreAnimationTool` over a `CALayer`
tree built **once** for the whole export — there is no per-frame app code at all.

- **New** class method `+burnLayersWithVideoPath:outputPath:layersJson:optionsJson:completion:`
  in a new `VideoLayerBurner.h/.m`, or a clearly-separated section of the existing burner.
  Existing `+burnOverlayWithVideoPath:...` untouched.
- Each layer becomes one sibling in the overlay root: `CATextLayer` for text,
  `CALayer` with `.contents = cgImage` for image. Array order maps directly to sublayer
  order (`zPosition` not needed).
- **Time windows** use the existing `VOOpacityAnimation` keyframe approach — a layer with
  `startSec`/`endSec` gets an opacity keyframe animation, not per-frame work.
- **Rotation** via `CATransform3DMakeRotation` on the layer's `transform`.
- **Tiling** pre-bakes the pattern **once** into a single full-frame `CGImage` using
  `CGContext` (draw the tile at each computed grid point with the rotation applied), then
  assigns it to one full-frame `CALayer`. Do **not** create hundreds of `CALayer`s.
- Core Animation's coordinate origin is **bottom-left**; JS `{x,y}` and presets are
  **top-left** origin. Existing code already handles this for `burnOverlay` — mirror it,
  do not re-derive.

### 5.3 Cross-platform consistency

Android renders text via `Canvas`→GL texture; iOS via `CATextLayer`. Pixel-identical output
is **not** a goal. Required consistency:

- Same anchor position within ±1% of frame width.
- Same layer ordering.
- Same visible/invisible time windows.
- Tile grid: same angle, same approximate density, same anchor quadrant.

Font metrics, anti-aliasing, and stroke rendering will differ visibly on close inspection.
This is accepted and must be stated in the README.

**Auto font size is one shared formula**: `max(14, min(frameW, frameH) * 0.032) * fontScale`,
implemented identically on Android, iOS and in the example preview. Note the legacy
`burnOverlay` uses `0.028 / min 12` on iOS and `0.032 / min 14` on Android — a pre-existing
cross-platform inconsistency that `burnLayers` deliberately does **not** inherit.

**Known divergence**: if a source video's duration is unreadable, Android draws a layer with
no `endSec` unbounded and the burn succeeds, while iOS rejects the export before building any
layer. Degenerate input only; not reconciled in v1.

## 6. Example app

The demo must let a human verify every spec claim by eye:

- A **layer list editor**: add/remove/reorder layers, switch type, edit that layer's own
  props (position, size, opacity, rotation, time window).
- A **tile toggle** per layer exposing `angle` / `spacingX` / `spacingY` / `anchor` /
  `scale` / `stagger`.
- Two one-tap presets: **"Logo + caption"** (image topLeft + text bottomCenter, proving
  simultaneous multi-layer) and **"Stock watermark"** (tiled text at `angle: -30`, proving
  the tile path — the reference look).
- Live preview before burning, then the burned result in the existing player.

Existing demo screens for `burnOverlay` stay working and untouched.

## 7. Code conventions (non-negotiable)

- **Every code comment is exactly one line, maximum 15 words.** No exceptions, any language,
  any file. Multi-line prose blocks are not allowed — compress or delete. JSDoc `@param`
  lines each count as their own one-line comment.
- Match the surrounding file's existing naming, spacing, and idiom.
- Many small focused files over few large ones.

## 8. Out of scope (v1)

- Per-tile random jitter/seeded randomness (`angle` + `anchor` + `stagger` cover the
  "arbitrary direction / any starting corner" requirement).
- Animated layers (motion paths, scrolling marquee).
- Video-as-overlay (picture-in-picture).
- Blend modes beyond normal alpha.
