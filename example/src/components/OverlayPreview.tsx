import { useCallback, useMemo, useState, type ReactElement } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { ResolvedOverlayStyle } from '../types';
import {
  computeOverlayAnchor,
  getHorizontalAlign,
} from '../utils/overlayAnchor';
import { useVideoThumbnail } from '../utils/useVideoThumbnail';

// Mirrors the native font-size formula: max(14, min(frameW,frameH) * 0.032) * fontScale.
const FONT_SIZE_RATIO = 0.032;
const MIN_FONT_SIZE = 14;
// fontSize is documented as absolute px in the OUTPUT VIDEO's own pixel space, not preview dp —
// used to scale it down for display when the real source width isn't known (e.g. recorded video).
const DEFAULT_VIDEO_WIDTH = 1920;
const LINE_GAP_RATIO = 0.35;
const STROKE_OFFSET_RATIO = 0.06;

// Simulates a stroke via 8 offset text copies, since RN's Text has no outline property.
const STROKE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

export interface Size {
  width: number;
  height: number;
}

const ZERO_SIZE: Size = { width: 0, height: 0 };

interface OverlayPreviewProps {
  /** Width/height of the placeholder frame, from the picked asset when known, else 16:9. */
  aspectRatio: number;
  /** Text-mode content. Ignored when `customContent` is provided. */
  lines: string[];
  style: ResolvedOverlayStyle;
  /** Image-mode content: the same element being captured for the `imagePath` cue. */
  customContent?: ReactElement;
  /** Known size of `customContent` — skips the measure-then-position flicker for text mode. */
  customContentSize?: Size;
  /** Path of a picked/recorded video; a static extracted-frame thumbnail stands in for live playback. */
  sourcePath?: string;
  /** Real pixel width of the source video, for scaling a fixed style.fontSize correctly in preview. */
  sourceWidth?: number;
  /** Arbitrary background element filling the frame; lets CameraRecorder reuse this anchor-math with a live feed. */
  backgroundContent?: ReactElement;
  /** Overrides the card look (rounded border, placeholder fill) for full-bleed uses like the camera. */
  frameStyle?: StyleProp<ViewStyle>;
}

export default function OverlayPreview({
  aspectRatio,
  lines,
  style,
  customContent,
  customContentSize,
  sourcePath,
  sourceWidth,
  backgroundContent,
  frameStyle: frameStyleOverride,
}: OverlayPreviewProps): ReactElement {
  const [frameSize, setFrameSize] = useState<Size>(ZERO_SIZE);
  const [measuredContentSize, setMeasuredContentSize] =
    useState<Size>(ZERO_SIZE);
  // No react-native-video/ExoPlayer here — a static extracted frame avoids the media3 version
  // conflict with react-native-vision-camera entirely (see example/README.md).
  const thumbnailUri = useVideoThumbnail(sourcePath ?? '');

  const handleFrameLayout = useCallback((event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout;
    setFrameSize({ width, height });
  }, []);

  const handleContentLayout = useCallback((event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout;
    setMeasuredContentSize((previous) =>
      previous.width === width && previous.height === height
        ? previous
        : { width, height }
    );
  }, []);

  const contentSize = customContentSize ?? measuredContentSize;
  const isReady = frameSize.width > 0 && contentSize.width > 0;

  // style.fontSize is absolute px in the OUTPUT VIDEO's pixel space, not preview dp — scale it down
  // by how much narrower the preview frame is than the real video so it displays proportionally.
  // Floored at 1, not MIN_FONT_SIZE: this is meant to genuinely LOOK as tiny as it'll really burn
  // — MIN_FONT_SIZE's 14 is a readability floor for the auto formula, not an anti-crash guard, and
  // would mask exactly the too-small values a user needs to see. 1 only guards frameSize still
  // being {0,0} pre-layout, since RN's <Text> throws on fontSize <= 0.
  const fontSize =
    style.fontSize !== undefined
      ? Math.max(
          1,
          style.fontSize *
            (frameSize.width / (sourceWidth ?? DEFAULT_VIDEO_WIDTH))
        )
      : Math.max(
          MIN_FONT_SIZE,
          Math.min(frameSize.width, frameSize.height) * FONT_SIZE_RATIO
        ) * style.fontScale;
  const strokeOffset = fontSize * STROKE_OFFSET_RATIO;

  const frameStyle = useMemo(() => ({ aspectRatio }), [aspectRatio]);

  const anchor = useMemo(
    () =>
      computeOverlayAnchor(
        style.position,
        frameSize.width,
        frameSize.height,
        contentSize.width,
        contentSize.height,
        style.marginRatio
      ),
    [
      style.position,
      style.marginRatio,
      frameSize.width,
      frameSize.height,
      contentSize.width,
      contentSize.height,
    ]
  );

  // style.opacity mirrors native alpha blend; multiplied by the ready-check so it starts invisible pre-layout.
  const overlayPositionStyle = useMemo(
    () => ({
      left: anchor.left,
      top: anchor.top,
      opacity: isReady ? style.opacity : 0,
    }),
    [anchor.left, anchor.top, isReady, style.opacity]
  );

  // OverlayFontWeight is a subset of RN's fontWeight scale, so values pass through with no translation.
  const fontWeight = style.fontWeight;

  const fillTextStyle = useMemo(
    () => ({
      fontSize,
      color: style.textColor,
      fontFamily: style.fontFamily,
      fontWeight,
    }),
    [fontSize, style.textColor, style.fontFamily, fontWeight]
  );

  const strokeTextStyles = useMemo(
    () =>
      STROKE_OFFSETS.map(([dx, dy]) => ({
        position: 'absolute' as const,
        fontSize,
        color: style.strokeColor,
        fontFamily: style.fontFamily,
        fontWeight,
        transform: [
          { translateX: dx * strokeOffset },
          { translateY: dy * strokeOffset },
        ],
      })),
    [fontSize, strokeOffset, style.strokeColor, style.fontFamily, fontWeight]
  );

  const lineGapStyle = useMemo(
    () => ({ marginTop: fontSize * LINE_GAP_RATIO }),
    [fontSize]
  );

  // Matches native's per-position text alignment (e.g. topRight lines align right, not left).
  const horizontalAlign = getHorizontalAlign(style.position);
  const alignItemsStyle = useMemo(
    () => ({
      alignItems:
        horizontalAlign === 'left'
          ? ('flex-start' as const)
          : horizontalAlign === 'right'
            ? ('flex-end' as const)
            : ('center' as const),
    }),
    [horizontalAlign]
  );

  const background =
    backgroundContent ??
    (thumbnailUri ? (
      <Image
        source={{ uri: thumbnailUri }}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
      />
    ) : null);

  return (
    <View
      style={[styles.frame, frameStyle, frameStyleOverride]}
      onLayout={handleFrameLayout}
    >
      {background ?? (
        <Text style={styles.frameHintText}>Video frame preview</Text>
      )}

      {customContent ? (
        <View
          style={[styles.overlayBox, overlayPositionStyle]}
          onLayout={customContentSize ? undefined : handleContentLayout}
          pointerEvents="none"
        >
          {customContent}
        </View>
      ) : lines.length > 0 ? (
        <View
          style={[styles.overlayBox, overlayPositionStyle, alignItemsStyle]}
          onLayout={handleContentLayout}
          pointerEvents="none"
        >
          {lines.map((line, index) => (
            <View
              key={`${index}-${line}`}
              style={index > 0 ? lineGapStyle : undefined}
            >
              {style.strokeWidth === 0
                ? null
                : STROKE_OFFSETS.map(([dx, dy], strokeIndex) => (
                    <Text
                      key={`stroke-${dx}-${dy}`}
                      allowFontScaling={false}
                      numberOfLines={1}
                      style={[styles.line, strokeTextStyles[strokeIndex]]}
                    >
                      {line}
                    </Text>
                  ))}
              <Text
                allowFontScaling={false}
                numberOfLines={1}
                style={[styles.line, fillTextStyle]}
              >
                {line}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#C6C6C8',
    backgroundColor: '#E5E5EA',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  frameHintText: {
    color: '#8E8E93',
    fontSize: 13,
  },
  // Default for image-overlay content; text lines override via alignItemsStyle per position.
  overlayBox: {
    position: 'absolute',
    alignItems: 'flex-start',
  },
  // fontWeight is applied per-render via fillTextStyle/strokeTextStyles, not hardcoded here.
  line: {},
});
