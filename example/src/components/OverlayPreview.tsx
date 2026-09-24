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
// fontSize is output-video px; scale it down when the source width is unknown.
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
  // A static frame, not react-native-video, avoids the media3 conflict with vision-camera.
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

  // Scale output-px fontSize to preview size; floor 1 (not MIN_FONT_SIZE) so tiny sizes show honestly.
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
