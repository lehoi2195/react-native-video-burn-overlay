//
//  VideoLayerBurner.m
//  react-native-video-overlay
//

#import "VideoLayerBurner.h"

#import <AVFoundation/AVFoundation.h>
#import <QuartzCore/QuartzCore.h>
#import <UIKit/UIKit.h>

#pragma mark - Display constants

/// Mirrors VideoOverlayBurner.m's constants; kept separate so that file stays untouched.
/// Font ratio and floor intentionally match Android's, so burnLayers sizes text identically.
static const CGFloat kVOLFontSizeRatio = 0.032;
static const CGFloat kVOLMarginRatio = 0.05;
static const CGFloat kVOLLineHeightRatio = 1.35;
static const CGFloat kVOLBoxHeightRatio = 1.7;
static const CGFloat kVOLStrokeWidthPercent = -6.0;
static const CGFloat kVOLMinFontSize = 14.0;
static const CGFloat kVOLMinFontScale = 0.5;
static const CGFloat kVOLMaxFontScale = 3.0;
static const CGFloat kVOLFontSizeUnset = 0.0;
static const CGFloat kVOLStrokeWidthUnset = -1.0;
static const double kVOLTimeEpsilon = 1e-4;
static const CGFloat kVOLDefaultSpacing = 0.25;
/// Tile-count guard from spec §2.5; spacing widens automatically past this.
static const NSInteger kVOLMaxTileCount = 400;

#pragma mark - Model

/// Anchor position, same 9 presets plus exact {x,y} as the cue-based burner.
typedef NS_ENUM(NSInteger, VOLPosition) {
  VOLPositionTopLeft = 0,
  VOLPositionTopCenter,
  VOLPositionTopRight,
  VOLPositionCenterLeft,
  VOLPositionCenter,
  VOLPositionCenterRight,
  VOLPositionBottomLeft,
  VOLPositionBottomCenter,
  VOLPositionBottomRight,
  VOLPositionCustom,
};

typedef NS_ENUM(NSInteger, VOLHorizontalAlign) {
  VOLHorizontalLeft,
  VOLHorizontalCenter,
  VOLHorizontalRight,
};

typedef NS_ENUM(NSInteger, VOLVerticalAlign) {
  VOLVerticalTop,
  VOLVerticalCenter,
  VOLVerticalBottom,
};

/// One repeated-tile config, parsed once per layer that sets `tile`.
@interface VOLTileConfig : NSObject
@property (nonatomic) CGFloat angle;
@property (nonatomic) CGFloat spacingX;
@property (nonatomic) CGFloat spacingY;
@property (nonatomic) VOLPosition anchorPosition;
@property (nonatomic) CGFloat anchorCustomX;
@property (nonatomic) CGFloat anchorCustomY;
@property (nonatomic) CGFloat scale;
@property (nonatomic) BOOL stagger;
@end

@implementation VOLTileConfig
@end

/// One parsed OverlayLayer, image or text, always fully populated with defaults.
@interface VOLLayer : NSObject
@property (nonatomic) BOOL isText;
@property (nonatomic, copy) NSString *source;
@property (nonatomic, copy) NSString *text;
@property (nonatomic) CGFloat width;
@property (nonatomic) CGFloat height;
@property (nonatomic) CGFloat fontSize;
@property (nonatomic) CGFloat fontScale;
@property (nonatomic, strong) UIColor *fontColor;
@property (nonatomic, strong) UIColor *strokeColor;
@property (nonatomic) CGFloat strokeWidth;
@property (nonatomic, copy, nullable) NSString *fontFamily;
@property (nonatomic) NSInteger fontWeightValue;
@property (nonatomic) VOLPosition position;
@property (nonatomic) CGFloat customX;
@property (nonatomic) CGFloat customY;
@property (nonatomic) CGFloat marginRatio;
@property (nonatomic) CGFloat opacity;
@property (nonatomic) CGFloat rotationDegrees;
@property (nonatomic) double startSec;
@property (nonatomic) BOOL hasEndSec;
@property (nonatomic) double endSec;
@property (nonatomic, strong, nullable) VOLTileConfig *tile;
@end

@implementation VOLLayer
@end

#pragma mark - Helpers

static NSError *VOLMakeError(VideoOverlayErrorCode code, NSString *message)
{
  return [NSError errorWithDomain:VideoOverlayErrorDomain
                             code:code
                         userInfo:@{NSLocalizedDescriptionKey : message ?: @"Unknown video layer error"}];
}

static CGFloat VOLDegreesToRadians(CGFloat degrees)
{
  return degrees * (CGFloat)M_PI / 180.0;
}

/// H.264/HEVC require even dimensions; mirrors VOEvenSize exactly.
static CGFloat VOLEvenSize(CGFloat value)
{
  CGFloat rounded = round(value / 2.0) * 2.0;
  return MAX(rounded, 2.0);
}

/// Centre-crops only, never pads or upscales; mirrors VOCropSize exactly.
static CGSize VOLCropSize(CGSize size, CGFloat ratio)
{
  if (!(ratio > 0.0) || !(size.width > 0.0) || !(size.height > 0.0)) {
    return size;
  }
  CGFloat current = size.width / size.height;
  if (current > ratio) {
    return CGSizeMake(VOLEvenSize(MIN(size.height * ratio, size.width)), size.height);
  }
  if (current < ratio) {
    return CGSizeMake(size.width, VOLEvenSize(MIN(size.width / ratio, size.height)));
  }
  return size;
}

/// Parses a hex color, nil on invalid input; mirrors VOColorFromHexValue exactly.
static UIColor *_Nullable VOLColorFromHex(id _Nullable value)
{
  if (![value isKindOfClass:[NSString class]]) {
    return nil;
  }
  NSString *hex = [(NSString *)value stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
  if ([hex hasPrefix:@"#"]) {
    hex = [hex substringFromIndex:1];
  }
  if (hex.length != 6 && hex.length != 8) {
    return nil;
  }
  NSScanner *scanner = [NSScanner scannerWithString:hex];
  unsigned int hexValue = 0;
  if (![scanner scanHexInt:&hexValue] || !scanner.isAtEnd) {
    return nil;
  }
  CGFloat alpha = 1.0;
  CGFloat red;
  CGFloat green;
  CGFloat blue;
  if (hex.length == 8) {
    alpha = ((hexValue >> 24) & 0xFF) / 255.0;
    red = ((hexValue >> 16) & 0xFF) / 255.0;
    green = ((hexValue >> 8) & 0xFF) / 255.0;
    blue = (hexValue & 0xFF) / 255.0;
  } else {
    red = ((hexValue >> 16) & 0xFF) / 255.0;
    green = ((hexValue >> 8) & 0xFF) / 255.0;
    blue = (hexValue & 0xFF) / 255.0;
  }
  return [UIColor colorWithRed:red green:green blue:blue alpha:alpha];
}

/// Accepts "normal"/"bold" or "100".."900"; anything else falls back to 400.
static NSInteger VOLFontWeightFromString(id _Nullable value)
{
  if (![value isKindOfClass:[NSString class]]) {
    return 400;
  }
  NSString *str = (NSString *)value;
  if ([str isEqualToString:@"normal"]) return 400;
  if ([str isEqualToString:@"bold"]) return 700;
  static NSArray<NSString *> *weights;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    weights = @[ @"100", @"200", @"300", @"400", @"500", @"600", @"700", @"800", @"900" ];
  });
  if ([weights containsObject:str]) {
    return str.integerValue;
  }
  return 400;
}

static UIFontWeight VOLUIFontWeightFromInt(NSInteger weight)
{
  switch (weight) {
    case 100: return UIFontWeightUltraLight;
    case 200: return UIFontWeightThin;
    case 300: return UIFontWeightLight;
    case 500: return UIFontWeightMedium;
    case 600: return UIFontWeightSemibold;
    case 700: return UIFontWeightBold;
    case 800: return UIFontWeightHeavy;
    case 900: return UIFontWeightBlack;
    default: return UIFontWeightRegular;
  }
}

/// One of 9 preset strings, falling back to `fallback` (not always bottomLeft).
static VOLPosition VOLPositionFromString(id _Nullable value, VOLPosition fallback)
{
  if (![value isKindOfClass:[NSString class]]) {
    return fallback;
  }
  NSString *str = (NSString *)value;
  if ([str isEqualToString:@"topLeft"]) return VOLPositionTopLeft;
  if ([str isEqualToString:@"topCenter"]) return VOLPositionTopCenter;
  if ([str isEqualToString:@"topRight"]) return VOLPositionTopRight;
  if ([str isEqualToString:@"centerLeft"]) return VOLPositionCenterLeft;
  if ([str isEqualToString:@"center"]) return VOLPositionCenter;
  if ([str isEqualToString:@"centerRight"]) return VOLPositionCenterRight;
  if ([str isEqualToString:@"bottomLeft"]) return VOLPositionBottomLeft;
  if ([str isEqualToString:@"bottomCenter"]) return VOLPositionBottomCenter;
  if ([str isEqualToString:@"bottomRight"]) return VOLPositionBottomRight;
  return fallback;
}

#pragma mark - Anchor position (top-left JS space -> bottom-left CA space)

/// Mirrors VOPositionHorizontal exactly, generalized to take raw fields.
static VOLHorizontalAlign VOLPositionHorizontal(VOLPosition position, CGFloat customX)
{
  switch (position) {
    case VOLPositionTopLeft:
    case VOLPositionCenterLeft:
    case VOLPositionBottomLeft:
      return VOLHorizontalLeft;
    case VOLPositionTopCenter:
    case VOLPositionCenter:
    case VOLPositionBottomCenter:
      return VOLHorizontalCenter;
    case VOLPositionTopRight:
    case VOLPositionCenterRight:
    case VOLPositionBottomRight:
      return VOLHorizontalRight;
    case VOLPositionCustom:
      if (customX < 1.0 / 3.0) return VOLHorizontalLeft;
      if (customX > 2.0 / 3.0) return VOLHorizontalRight;
      return VOLHorizontalCenter;
  }
  return VOLHorizontalLeft;
}

/// Mirrors VOPositionVertical exactly, generalized to take raw fields.
static VOLVerticalAlign VOLPositionVertical(VOLPosition position, CGFloat customY)
{
  switch (position) {
    case VOLPositionTopLeft:
    case VOLPositionTopCenter:
    case VOLPositionTopRight:
      return VOLVerticalTop;
    case VOLPositionCenterLeft:
    case VOLPositionCenter:
    case VOLPositionCenterRight:
      return VOLVerticalCenter;
    case VOLPositionBottomLeft:
    case VOLPositionBottomCenter:
    case VOLPositionBottomRight:
      return VOLVerticalBottom;
    case VOLPositionCustom:
      if (customY < 1.0 / 3.0) return VOLVerticalTop;
      if (customY > 2.0 / 3.0) return VOLVerticalBottom;
      return VOLVerticalCenter;
  }
  return VOLVerticalBottom;
}

/// Mirrors VOAnchorX exactly, generalized to take raw fields instead of VOStyle.
static CGFloat VOLAnchorX(VOLPosition position, CGFloat customX, CGFloat margin, CGFloat contentWidth, CGFloat renderWidth)
{
  if (position == VOLPositionCustom) {
    CGFloat available = MAX(renderWidth - contentWidth, 0.0);
    return available * customX;
  }
  switch (VOLPositionHorizontal(position, 0.0)) {
    case VOLHorizontalRight: return renderWidth - margin - contentWidth;
    case VOLHorizontalCenter: return (renderWidth - contentWidth) / 2.0;
    case VOLHorizontalLeft: default: return margin;
  }
}

/// Mirrors VOAnchorYForBlock exactly; `1.0 - customY` is the top-left -> bottom-left flip.
static CGFloat VOLAnchorYForBlock(VOLPosition position, CGFloat customY, CGFloat margin, CGFloat blockHeight, CGFloat renderHeight)
{
  if (position == VOLPositionCustom) {
    CGFloat available = MAX(renderHeight - blockHeight, 0.0);
    return available * (1.0 - customY);
  }
  switch (VOLPositionVertical(position, 0.0)) {
    case VOLVerticalTop: return renderHeight - margin - blockHeight;
    case VOLVerticalCenter: return (renderHeight - blockHeight) / 2.0;
    case VOLVerticalBottom: default: return margin;
  }
}

/// Maps a preset or {x,y} position to a 0-1 anchor point.
static CGPoint VOLPositionFraction(VOLPosition position, CGFloat customX, CGFloat customY)
{
  if (position == VOLPositionCustom) {
    return CGPointMake(customX, customY);
  }
  switch (position) {
    case VOLPositionTopLeft: return CGPointMake(0.0, 0.0);
    case VOLPositionTopCenter: return CGPointMake(0.5, 0.0);
    case VOLPositionTopRight: return CGPointMake(1.0, 0.0);
    case VOLPositionCenterLeft: return CGPointMake(0.0, 0.5);
    case VOLPositionCenter: return CGPointMake(0.5, 0.5);
    case VOLPositionCenterRight: return CGPointMake(1.0, 0.5);
    case VOLPositionBottomLeft: return CGPointMake(0.0, 1.0);
    case VOLPositionBottomCenter: return CGPointMake(0.5, 1.0);
    case VOLPositionBottomRight: return CGPointMake(1.0, 1.0);
    default: return CGPointMake(0.5, 0.5);
  }
}

#pragma mark - Text attributes

static NSDictionary<NSAttributedStringKey, id> *VOLTextAttributes(CGFloat fontSize, VOLLayer *layer)
{
  UIFont *font = nil;
  if (layer.fontFamily.length > 0) {
    font = [UIFont fontWithName:layer.fontFamily size:fontSize];
  }
  if (font == nil) {
    font = [UIFont systemFontOfSize:fontSize weight:VOLUIFontWeightFromInt(layer.fontWeightValue)];
  }
  NSMutableDictionary<NSAttributedStringKey, id> *attributes = [@{
    NSFontAttributeName : font,
    NSForegroundColorAttributeName : layer.fontColor,
  } mutableCopy];
  if (layer.strokeWidth != 0.0) {
    CGFloat percent = layer.strokeWidth == kVOLStrokeWidthUnset
        ? kVOLStrokeWidthPercent
        : -(layer.strokeWidth / fontSize) * 100.0;
    attributes[NSStrokeColorAttributeName] = layer.strokeColor;
    attributes[NSStrokeWidthAttributeName] = @(percent);
  }
  return attributes;
}

#pragma mark - Opacity keyframes

/// Mirrors VOOpacityAnimation's discrete keyframe approach for a single time window.
static CAKeyframeAnimation *VOLOpacityAnimation(double startSec, double endSec, double durationSec, CGFloat maxOpacity)
{
  NSMutableArray<NSNumber *> *keyTimes = [NSMutableArray array];
  NSMutableArray<NSNumber *> *values = [NSMutableArray array];
  __block double lastKeyTime = -1.0;

  void (^addKeyframe)(double, double) = ^(double normalizedTime, double opacity) {
    double clamped = MIN(MAX(normalizedTime, 0.0), 1.0);
    if (keyTimes.count > 0 && clamped <= lastKeyTime) {
      values[values.count - 1] = @(opacity);
      return;
    }
    lastKeyTime = clamped;
    [keyTimes addObject:@(clamped)];
    [values addObject:@(opacity)];
  };

  addKeyframe(0.0, 0.0);
  addKeyframe(startSec / durationSec, maxOpacity);
  addKeyframe(endSec / durationSec, 0.0);
  if (lastKeyTime < 1.0) {
    addKeyframe(1.0, 0.0);
  }

  CAKeyframeAnimation *animation = [CAKeyframeAnimation animationWithKeyPath:@"opacity"];
  animation.calculationMode = kCAAnimationDiscrete;
  animation.keyTimes = keyTimes;
  animation.values = values;
  animation.duration = durationSec;
  animation.beginTime = AVCoreAnimationBeginTimeAtZero;
  animation.removedOnCompletion = NO;
  animation.fillMode = kCAFillModeForwards;
  return animation;
}

#pragma mark - Parsing

static VOLTileConfig *VOLParseTileConfig(NSDictionary *dict)
{
  VOLTileConfig *tile = [[VOLTileConfig alloc] init];

  tile.angle = 0.0;
  id rawAngle = dict[@"angle"];
  if ([rawAngle isKindOfClass:[NSNumber class]]) {
    double v = [(NSNumber *)rawAngle doubleValue];
    if (isfinite(v)) tile.angle = v;
  }

  tile.spacingX = kVOLDefaultSpacing;
  id rawSpacingX = dict[@"spacingX"];
  if ([rawSpacingX isKindOfClass:[NSNumber class]]) {
    double v = [(NSNumber *)rawSpacingX doubleValue];
    if (isfinite(v)) tile.spacingX = MIN(MAX(v, 0.02), 2.0);
  }

  tile.spacingY = kVOLDefaultSpacing;
  id rawSpacingY = dict[@"spacingY"];
  if ([rawSpacingY isKindOfClass:[NSNumber class]]) {
    double v = [(NSNumber *)rawSpacingY doubleValue];
    if (isfinite(v)) tile.spacingY = MIN(MAX(v, 0.02), 2.0);
  }

  id rawAnchor = dict[@"anchor"];
  if ([rawAnchor isKindOfClass:[NSDictionary class]]) {
    NSDictionary *anchorDict = (NSDictionary *)rawAnchor;
    double x = [anchorDict[@"x"] isKindOfClass:[NSNumber class]] ? [(NSNumber *)anchorDict[@"x"] doubleValue] : NAN;
    double y = [anchorDict[@"y"] isKindOfClass:[NSNumber class]] ? [(NSNumber *)anchorDict[@"y"] doubleValue] : NAN;
    if (isfinite(x) && isfinite(y)) {
      tile.anchorPosition = VOLPositionCustom;
      tile.anchorCustomX = MIN(MAX(x, 0.0), 1.0);
      tile.anchorCustomY = MIN(MAX(y, 0.0), 1.0);
    } else {
      tile.anchorPosition = VOLPositionCenter;
    }
  } else {
    tile.anchorPosition = VOLPositionFromString(rawAnchor, VOLPositionCenter);
  }

  tile.scale = 1.0;
  id rawScale = dict[@"scale"];
  if ([rawScale isKindOfClass:[NSNumber class]]) {
    double v = [(NSNumber *)rawScale doubleValue];
    if (isfinite(v) && v > 0.0) tile.scale = MIN(MAX(v, 0.05), 10.0);
  }

  id rawStagger = dict[@"stagger"];
  tile.stagger = [rawStagger isKindOfClass:[NSNumber class]] && [(NSNumber *)rawStagger boolValue];

  return tile;
}

/// Parses layersJson; structural problems throw INVALID_LAYERS, cosmetic ones fall back.
static NSArray<VOLLayer *> *_Nullable VOLParseLayers(NSString *layersJson, NSError **outError)
{
  if (layersJson.length == 0) {
    if (outError) *outError = VOLMakeError(VideoOverlayErrorInvalidLayers, @"layersJson is empty.");
    return nil;
  }

  NSData *data = [layersJson dataUsingEncoding:NSUTF8StringEncoding];
  NSError *jsonError = nil;
  id parsed = data != nil ? [NSJSONSerialization JSONObjectWithData:data options:0 error:&jsonError] : nil;
  if (parsed == nil || ![parsed isKindOfClass:[NSArray class]]) {
    if (outError) *outError = VOLMakeError(VideoOverlayErrorInvalidLayers, @"layersJson must be a JSON array.");
    return nil;
  }

  NSArray *rawLayers = (NSArray *)parsed;
  if (rawLayers.count == 0) {
    if (outError) *outError = VOLMakeError(VideoOverlayErrorInvalidLayers, @"layers must not be empty.");
    return nil;
  }

  NSMutableArray<VOLLayer *> *layers = [NSMutableArray arrayWithCapacity:rawLayers.count];

  for (id rawLayer in rawLayers) {
    if (![rawLayer isKindOfClass:[NSDictionary class]]) {
      if (outError) *outError = VOLMakeError(VideoOverlayErrorInvalidLayers, @"Each layer must be a JSON object.");
      return nil;
    }
    NSDictionary *dict = (NSDictionary *)rawLayer;

    id rawType = dict[@"type"];
    NSString *typeStr = [rawType isKindOfClass:[NSString class]] ? (NSString *)rawType : nil;
    BOOL isText;
    if ([typeStr isEqualToString:@"image"]) {
      isText = NO;
    } else if ([typeStr isEqualToString:@"text"]) {
      isText = YES;
    } else {
      if (outError) *outError = VOLMakeError(VideoOverlayErrorInvalidLayers, @"Layer type must be 'image' or 'text'.");
      return nil;
    }

    VOLLayer *layer = [[VOLLayer alloc] init];
    layer.isText = isText;

    if (isText) {
      // A non-string counts as missing too, since there's no usable content to draw.
      id rawText = dict[@"text"];
      if (![rawText isKindOfClass:[NSString class]]) {
        if (outError) *outError = VOLMakeError(VideoOverlayErrorInvalidLayers, @"Text layer is missing its text key.");
        return nil;
      }
      layer.text = (NSString *)rawText;
    } else {
      id rawSource = dict[@"source"];
      NSString *source = [rawSource isKindOfClass:[NSString class]]
          ? [(NSString *)rawSource stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]]
          : @"";
      if (source.length == 0) {
        if (outError) *outError = VOLMakeError(VideoOverlayErrorInvalidLayers, @"Image layer has a blank source.");
        return nil;
      }
      layer.source = [source hasPrefix:@"file://"] ? ([NSURL URLWithString:source].path ?: source) : source;
    }

    double startSec = 0.0;
    id rawStart = dict[@"startSec"];
    if ([rawStart isKindOfClass:[NSNumber class]]) {
      double v = [(NSNumber *)rawStart doubleValue];
      if (isfinite(v)) startSec = MAX(v, 0.0);
    }
    BOOL hasEndSec = NO;
    double endSec = 0.0;
    id rawEnd = dict[@"endSec"];
    if ([rawEnd isKindOfClass:[NSNumber class]]) {
      double v = [(NSNumber *)rawEnd doubleValue];
      if (isfinite(v)) {
        hasEndSec = YES;
        endSec = v;
      }
    }
    if (hasEndSec && endSec <= startSec) {
      if (outError) *outError = VOLMakeError(VideoOverlayErrorInvalidLayers, @"endSec must be greater than startSec.");
      return nil;
    }
    layer.startSec = startSec;
    layer.hasEndSec = hasEndSec;
    layer.endSec = endSec;

    id rawPosition = dict[@"position"];
    if ([rawPosition isKindOfClass:[NSDictionary class]]) {
      NSDictionary *positionDict = (NSDictionary *)rawPosition;
      double x = [positionDict[@"x"] isKindOfClass:[NSNumber class]] ? [(NSNumber *)positionDict[@"x"] doubleValue] : NAN;
      double y = [positionDict[@"y"] isKindOfClass:[NSNumber class]] ? [(NSNumber *)positionDict[@"y"] doubleValue] : NAN;
      if (isfinite(x) && isfinite(y)) {
        layer.position = VOLPositionCustom;
        layer.customX = MIN(MAX(x, 0.0), 1.0);
        layer.customY = MIN(MAX(y, 0.0), 1.0);
      } else {
        layer.position = VOLPositionBottomLeft;
      }
    } else {
      layer.position = VOLPositionFromString(rawPosition, VOLPositionBottomLeft);
    }

    layer.marginRatio = kVOLMarginRatio;
    id rawMargin = dict[@"marginRatio"];
    if ([rawMargin isKindOfClass:[NSNumber class]]) {
      double v = [(NSNumber *)rawMargin doubleValue];
      if (isfinite(v)) layer.marginRatio = MIN(MAX(v, 0.0), 0.5);
    }

    layer.opacity = 1.0;
    id rawOpacity = dict[@"opacity"];
    if ([rawOpacity isKindOfClass:[NSNumber class]]) {
      double v = [(NSNumber *)rawOpacity doubleValue];
      if (isfinite(v)) layer.opacity = MIN(MAX(v, 0.0), 1.0);
    }

    layer.rotationDegrees = 0.0;
    id rawRotation = dict[@"rotation"];
    if ([rawRotation isKindOfClass:[NSNumber class]]) {
      double v = [(NSNumber *)rawRotation doubleValue];
      if (isfinite(v)) layer.rotationDegrees = v;
    }

    if (isText) {
      layer.fontSize = kVOLFontSizeUnset;
      id rawFontSize = dict[@"fontSize"];
      if ([rawFontSize isKindOfClass:[NSNumber class]]) {
        double v = [(NSNumber *)rawFontSize doubleValue];
        if (isfinite(v) && v > 0.0) layer.fontSize = v;
      }
      layer.fontScale = 1.0;
      id rawFontScale = dict[@"fontScale"];
      if ([rawFontScale isKindOfClass:[NSNumber class]]) {
        double v = [(NSNumber *)rawFontScale doubleValue];
        if (isfinite(v) && v > 0.0) layer.fontScale = MIN(MAX(v, kVOLMinFontScale), kVOLMaxFontScale);
      }
      layer.fontColor = VOLColorFromHex(dict[@"fontColor"]) ?: [UIColor whiteColor];
      layer.strokeColor = VOLColorFromHex(dict[@"strokeColor"]) ?: [UIColor blackColor];
      layer.strokeWidth = kVOLStrokeWidthUnset;
      id rawStrokeWidth = dict[@"strokeWidth"];
      if ([rawStrokeWidth isKindOfClass:[NSNumber class]]) {
        double v = [(NSNumber *)rawStrokeWidth doubleValue];
        if (isfinite(v) && v >= 0.0) layer.strokeWidth = v;
      }
      id rawFontFamily = dict[@"fontFamily"];
      layer.fontFamily = [rawFontFamily isKindOfClass:[NSString class]] && [(NSString *)rawFontFamily length] > 0
          ? (NSString *)rawFontFamily
          : nil;
      layer.fontWeightValue = VOLFontWeightFromString(dict[@"fontWeight"]);
    } else {
      layer.width = 0.0;
      id rawWidth = dict[@"width"];
      if ([rawWidth isKindOfClass:[NSNumber class]]) {
        double v = [(NSNumber *)rawWidth doubleValue];
        if (isfinite(v) && v > 0.0) layer.width = v;
      }
      layer.height = 0.0;
      id rawHeight = dict[@"height"];
      if ([rawHeight isKindOfClass:[NSNumber class]]) {
        double v = [(NSNumber *)rawHeight doubleValue];
        if (isfinite(v) && v > 0.0) layer.height = v;
      }
    }

    id rawTile = dict[@"tile"];
    if ([rawTile isKindOfClass:[NSDictionary class]]) {
      layer.tile = VOLParseTileConfig((NSDictionary *)rawTile);
    }

    [layers addObject:layer];
  }

  return layers;
}

/// Only field is cropAspectRatio; malformed JSON silently means "no crop".
static CGFloat VOLParseCropAspectRatio(NSString *_Nullable optionsJson)
{
  if (optionsJson.length == 0) {
    return 0.0;
  }
  NSData *data = [optionsJson dataUsingEncoding:NSUTF8StringEncoding];
  NSError *jsonError = nil;
  id parsed = data != nil ? [NSJSONSerialization JSONObjectWithData:data options:0 error:&jsonError] : nil;
  if (jsonError != nil || ![parsed isKindOfClass:[NSDictionary class]]) {
    return 0.0;
  }
  id rawRatio = ((NSDictionary *)parsed)[@"cropAspectRatio"];
  if ([rawRatio isKindOfClass:[NSNumber class]]) {
    double ratio = [(NSNumber *)rawRatio doubleValue];
    if (isfinite(ratio) && ratio > 0.0) {
      return ratio;
    }
  }
  return 0.0;
}

#pragma mark - Building single (non-tiled) layers

/// Sizes per spec 2.3: neither set keeps native size, one derives.
static CGSize VOLResolveImageSize(CGFloat requestedWidth, CGFloat requestedHeight, CGFloat naturalWidth, CGFloat naturalHeight)
{
  if (requestedWidth > 0.0 && requestedHeight > 0.0) {
    return CGSizeMake(requestedWidth, requestedHeight);
  }
  if (requestedWidth > 0.0) {
    return CGSizeMake(requestedWidth, requestedWidth * (naturalHeight / naturalWidth));
  }
  if (requestedHeight > 0.0) {
    return CGSizeMake(requestedHeight * (naturalWidth / naturalHeight), requestedHeight);
  }
  return CGSizeMake(naturalWidth, naturalHeight);
}

/// Bakes rotation into pixels so raw CGImage dims equal the visual size everywhere.
static UIImage *_Nullable VOLLoadNormalizedImage(NSString *path)
{
  UIImage *image = [UIImage imageWithContentsOfFile:path];
  if (image == nil || image.CGImage == NULL) {
    return nil;
  }
  if (image.imageOrientation == UIImageOrientationUp) {
    return image;
  }
  UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat preferredFormat];
  format.scale = 1.0;
  format.opaque = NO;
  UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:image.size format:format];
  return [renderer imageWithActions:^(UIGraphicsImageRendererContext *_Nonnull rendererContext) {
    [image drawInRect:CGRectMake(0.0, 0.0, image.size.width, image.size.height)];
  }];
}

static CALayer *_Nullable VOLBuildImageLayer(VOLLayer *layer, CGSize renderSize)
{
  UIImage *image = VOLLoadNormalizedImage(layer.source);
  CGImageRef cgImage = image.CGImage;
  if (image == nil || cgImage == NULL) {
    NSLog(@"[VideoLayerBurner] Skipping image layer, cannot read: %@", layer.source);
    return nil;
  }
  CGFloat naturalWidth = (CGFloat)CGImageGetWidth(cgImage);
  CGFloat naturalHeight = (CGFloat)CGImageGetHeight(cgImage);
  if (!(naturalWidth > 0.0) || !(naturalHeight > 0.0)) {
    NSLog(@"[VideoLayerBurner] Skipping image layer with invalid size: %@", layer.source);
    return nil;
  }

  CGSize size = VOLResolveImageSize(layer.width, layer.height, naturalWidth, naturalHeight);
  CGFloat margin = floor(renderSize.width * layer.marginRatio);
  CGFloat x = VOLAnchorX(layer.position, layer.customX, margin, size.width, renderSize.width);
  CGFloat y = VOLAnchorYForBlock(layer.position, layer.customY, margin, size.height, renderSize.height);

  CALayer *imageLayer = [CALayer layer];
  imageLayer.contentsScale = 1.0;
  imageLayer.frame = CGRectMake(x, y, size.width, size.height);
  imageLayer.contents = (__bridge id)cgImage;
  if (layer.rotationDegrees != 0.0) {
    // Negate: CA's rotation is CCW-positive here, JS/Android rotation is clockwise-positive.
    imageLayer.transform = CATransform3DMakeRotation(-VOLDegreesToRadians(layer.rotationDegrees), 0, 0, 1);
  }
  return imageLayer;
}

/// One CATextLayer per line, like VideoOverlayBurner.m's proven slot math, not one multi-line layer.
static CALayer *_Nullable VOLBuildTextLayer(VOLLayer *layer, CGSize renderSize)
{
  if (layer.text.length == 0) {
    return nil;
  }

  NSArray<NSString *> *lines = [layer.text componentsSeparatedByString:@"\n"];
  NSUInteger lineCount = lines.count;

  CGFloat fontSize = layer.fontSize != kVOLFontSizeUnset
      ? layer.fontSize
      : MAX(kVOLMinFontSize, floor(MIN(renderSize.width, renderSize.height) * kVOLFontSizeRatio)) * layer.fontScale;
  CGFloat lineHeight = ceil(fontSize * kVOLLineHeightRatio);
  CGFloat lineBoxHeight = ceil(fontSize * kVOLBoxHeightRatio);
  CGFloat blockHeight = (CGFloat)(lineCount - 1) * lineHeight + lineBoxHeight;

  CGFloat margin = floor(renderSize.width * layer.marginRatio);
  CGFloat textWidth = MAX(renderSize.width - margin * 2.0, 1.0);
  // Box always spans margin-to-margin; alignmentMode below does the real horizontal placement.
  CGFloat containerY = VOLAnchorYForBlock(layer.position, layer.customY, margin, blockHeight, renderSize.height);

  CATextLayerAlignmentMode alignmentMode;
  switch (VOLPositionHorizontal(layer.position, layer.customX)) {
    case VOLHorizontalLeft: alignmentMode = kCAAlignmentLeft; break;
    case VOLHorizontalCenter: alignmentMode = kCAAlignmentCenter; break;
    case VOLHorizontalRight: alignmentMode = kCAAlignmentRight; break;
  }
  NSDictionary<NSAttributedStringKey, id> *attributes = VOLTextAttributes(fontSize, layer);

  // Container groups every line so rotation below spins the whole block, not each line.
  CALayer *container = [CALayer layer];
  container.frame = CGRectMake(margin, containerY, textWidth, blockHeight);
  container.masksToBounds = NO;

  for (NSUInteger i = 0; i < lineCount; i++) {
    // First line (i=0) is the top line, so it gets the highest slot (spec: top-to-bottom).
    NSUInteger slot = lineCount - 1 - i;
    CATextLayer *lineLayer = [CATextLayer layer];
    lineLayer.contentsScale = 1.0;
    lineLayer.frame = CGRectMake(0.0, (CGFloat)slot * lineHeight, textWidth, lineBoxHeight);
    lineLayer.alignmentMode = alignmentMode;
    lineLayer.wrapped = NO;
    lineLayer.truncationMode = kCATruncationEnd;
    lineLayer.string = [[NSAttributedString alloc] initWithString:lines[i] attributes:attributes];
    [container addSublayer:lineLayer];
  }

  if (layer.rotationDegrees != 0.0) {
    container.transform = CATransform3DMakeRotation(-VOLDegreesToRadians(layer.rotationDegrees), 0, 0, 1);
  }
  return container;
}

#pragma mark - Tiling

/// Bakes the whole repeated pattern once into a single full-frame CGImage.
static CALayer *_Nullable VOLBuildTileLayer(VOLLayer *layer, CGSize renderSize)
{
  VOLTileConfig *tile = layer.tile;
  UIImage *tileImage = nil;
  NSAttributedString *attributedText = nil;
  CGSize baseSize = CGSizeZero;

  if (!layer.isText) {
    tileImage = VOLLoadNormalizedImage(layer.source);
    CGImageRef cgImage = tileImage.CGImage;
    if (tileImage == nil || cgImage == NULL) {
      NSLog(@"[VideoLayerBurner] Skipping tile layer, cannot read image: %@", layer.source);
      return nil;
    }
    CGFloat naturalWidth = (CGFloat)CGImageGetWidth(cgImage);
    CGFloat naturalHeight = (CGFloat)CGImageGetHeight(cgImage);
    if (!(naturalWidth > 0.0) || !(naturalHeight > 0.0)) {
      return nil;
    }
    CGSize resolved = VOLResolveImageSize(layer.width, layer.height, naturalWidth, naturalHeight);
    baseSize = CGSizeMake(resolved.width * tile.scale, resolved.height * tile.scale);
  } else {
    if (layer.text.length == 0) {
      return nil;
    }
    CGFloat fontSize = layer.fontSize != kVOLFontSizeUnset
        ? layer.fontSize
        : MAX(kVOLMinFontSize, floor(MIN(renderSize.width, renderSize.height) * kVOLFontSizeRatio)) * layer.fontScale;
    fontSize *= tile.scale;
    attributedText = [[NSAttributedString alloc] initWithString:layer.text attributes:VOLTextAttributes(fontSize, layer)];
    baseSize = [attributedText boundingRectWithSize:CGSizeMake(CGFLOAT_MAX, CGFLOAT_MAX)
                                             options:NSStringDrawingUsesLineFragmentOrigin
                                             context:nil]
                   .size;
  }
  if (!(baseSize.width > 0.0) || !(baseSize.height > 0.0)) {
    return nil;
  }

  // spacingY is a fraction of frame WIDTH too, so tiles stay square-ish.
  CGFloat stepX = MAX(MIN(MAX(tile.spacingX, 0.02), 2.0) * renderSize.width, 1.0);
  CGFloat stepY = MAX(MIN(MAX(tile.spacingY, 0.02), 2.0) * renderSize.width, 1.0);

  CGPoint anchorFraction = VOLPositionFraction(tile.anchorPosition, tile.anchorCustomX, tile.anchorCustomY);
  CGFloat anchorX = anchorFraction.x * renderSize.width;
  CGFloat anchorY = anchorFraction.y * renderSize.height;
  BOOL rotated = fabs(tile.angle) > 0.001;
  CGFloat angleRadians = VOLDegreesToRadians(tile.angle);

  NSInteger colsLeft;
  NSInteger colsRight;
  NSInteger rowsUp;
  NSInteger rowsDown;
  NSInteger iterations = 0;
  do {
    if (!rotated) {
      // Edge-to-edge coverage only; no rotation means no risk of bare corners.
      colsRight = (NSInteger)ceil((renderSize.width - anchorX) / stepX) + 1;
      colsLeft = (NSInteger)ceil(anchorX / stepX) + 1;
      rowsDown = (NSInteger)ceil((renderSize.height - anchorY) / stepY) + 1;
      rowsUp = (NSInteger)ceil(anchorY / stepY) + 1;
    } else {
      // Rotation can swing any corner anywhere, so over-extend symmetrically by that radius.
      CGFloat radius = sqrt(pow(MAX(anchorX, renderSize.width - anchorX), 2) +
                             pow(MAX(anchorY, renderSize.height - anchorY), 2));
      colsLeft = colsRight = (NSInteger)ceil(radius / stepX) + 1;
      rowsUp = rowsDown = (NSInteger)ceil(radius / stepY) + 1;
    }
    NSInteger estimate = (colsLeft + colsRight + 1) * (rowsUp + rowsDown + 1);
    if (estimate <= kVOLMaxTileCount || iterations >= 30) {
      if (iterations > 0) {
        NSLog(@"[VideoLayerBurner] Tile count exceeded %ld, spacing widened.", (long)kVOLMaxTileCount);
      }
      break;
    }
    stepX *= 1.15;
    stepY *= 1.15;
    iterations++;
  } while (YES);

  UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat preferredFormat];
  // Scale must be 1.0: renderSize is video pixels, not screen points.
  format.scale = 1.0;
  format.opaque = NO;
  UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:renderSize format:format];
  CGFloat perTileRotation = angleRadians + VOLDegreesToRadians(layer.rotationDegrees);

  UIImage *baked = [renderer imageWithActions:^(UIGraphicsImageRendererContext *_Nonnull rendererContext) {
    CGContextRef ctx = rendererContext.CGContext;
    for (NSInteger row = -rowsUp; row <= rowsDown; row++) {
      CGFloat rowOffset = (tile.stagger && (row % 2 != 0)) ? stepX / 2.0 : 0.0;
      for (NSInteger col = -colsLeft; col <= colsRight; col++) {
        CGPoint local = CGPointMake(col * stepX + rowOffset, row * stepY);
        // Lattice rotation: carries every tile's position, positive is clockwise on this canvas.
        CGPoint rotated = CGPointApplyAffineTransform(local, CGAffineTransformMakeRotation(angleRadians));
        CGFloat centerX = anchorX + rotated.x;
        CGFloat centerY = anchorY + rotated.y;

        CGContextSaveGState(ctx);
        CGContextTranslateCTM(ctx, centerX, centerY);
        CGContextRotateCTM(ctx, perTileRotation);
        CGRect drawRect = CGRectMake(-baseSize.width / 2.0, -baseSize.height / 2.0, baseSize.width, baseSize.height);
        if (tileImage != nil) {
          [tileImage drawInRect:drawRect];
        } else {
          [attributedText drawWithRect:drawRect options:NSStringDrawingUsesLineFragmentOrigin context:nil];
        }
        CGContextRestoreGState(ctx);
      }
    }
  }];

  if (baked.CGImage == NULL) {
    return nil;
  }
  CALayer *tileLayer = [CALayer layer];
  tileLayer.contentsScale = 1.0;
  tileLayer.frame = CGRectMake(0, 0, renderSize.width, renderSize.height);
  tileLayer.contents = (__bridge id)baked.CGImage;
  return tileLayer;
}

#pragma mark - Building the layer tree

/// Array order maps directly to sublayer order: index 0 = bottom, last = top.
static CALayer *VOLBuildLayerTree(NSArray<VOLLayer *> *layers, CGSize renderSize, double durationSec, CALayer **outVideoLayer)
{
  CGRect frame = CGRectMake(0.0, 0.0, renderSize.width, renderSize.height);

  CALayer *parentLayer = [CALayer layer];
  parentLayer.frame = frame;
  parentLayer.geometryFlipped = NO;

  CALayer *videoLayer = [CALayer layer];
  videoLayer.frame = frame;
  [parentLayer addSublayer:videoLayer];

  CALayer *overlayRoot = [CALayer layer];
  overlayRoot.frame = frame;
  overlayRoot.masksToBounds = NO;
  [parentLayer addSublayer:overlayRoot];

  for (VOLLayer *layer in layers) {
    CALayer *_Nullable built = layer.tile != nil ? VOLBuildTileLayer(layer, renderSize)
        : layer.isText                           ? VOLBuildTextLayer(layer, renderSize)
                                                  : VOLBuildImageLayer(layer, renderSize);
    if (built == nil) {
      continue; // decode failure or empty text, already logged where relevant
    }

    double clampedStart = MAX(layer.startSec, 0.0);
    double clampedEnd = MIN(layer.hasEndSec ? layer.endSec : durationSec, durationSec);
    if (clampedEnd <= clampedStart + kVOLTimeEpsilon) {
      built.opacity = 0.0; // window never overlaps the clip
    } else if (clampedStart <= kVOLTimeEpsilon && clampedEnd >= durationSec - kVOLTimeEpsilon) {
      built.opacity = layer.opacity; // visible for the whole clip, no animation needed
    } else {
      built.opacity = 0.0;
      CAKeyframeAnimation *animation = VOLOpacityAnimation(clampedStart, clampedEnd, durationSec, layer.opacity);
      [built addAnimation:animation forKey:@"vol_opacity"];
    }

    [overlayRoot addSublayer:built];
  }

  if (outVideoLayer != NULL) {
    *outVideoLayer = videoLayer;
  }
  return parentLayer;
}

#pragma mark - VideoLayerBurner

@implementation VideoLayerBurner

+ (dispatch_queue_t)workQueue
{
  static dispatch_queue_t queue;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    queue = dispatch_queue_create("com.smartsales.videooverlay.burnlayers", DISPATCH_QUEUE_SERIAL);
  });
  return queue;
}

+ (void)burnLayersWithVideoPath:(NSString *)videoPath
                      outputPath:(NSString *)outputPath
                      layersJson:(NSString *)layersJson
                     optionsJson:(nullable NSString *)optionsJson
                      completion:(VideoOverlayBurnCompletion)completion
{
  NSParameterAssert(completion != nil);
  dispatch_async([self workQueue], ^{
    [self performBurnWithVideoPath:videoPath
                        outputPath:outputPath
                        layersJson:layersJson
                       optionsJson:optionsJson
                        completion:completion];
  });
}

+ (void)performBurnWithVideoPath:(NSString *)videoPath
                      outputPath:(NSString *)outputPath
                      layersJson:(NSString *)layersJson
                     optionsJson:(nullable NSString *)optionsJson
                      completion:(VideoOverlayBurnCompletion)completion
{
  NSFileManager *fileManager = [NSFileManager defaultManager];

  if (videoPath.length == 0 || outputPath.length == 0) {
    completion(nil, VOLMakeError(VideoOverlayErrorInvalidArgument, @"videoPath and outputPath must not be empty."));
    return;
  }

  NSString *inputPath = [videoPath hasPrefix:@"file://"] ? ([NSURL URLWithString:videoPath].path ?: videoPath) : videoPath;
  NSString *destPath = [outputPath hasPrefix:@"file://"] ? ([NSURL URLWithString:outputPath].path ?: outputPath) : outputPath;

  if ([[inputPath stringByStandardizingPath] isEqualToString:[destPath stringByStandardizingPath]]) {
    completion(nil, VOLMakeError(VideoOverlayErrorInvalidArgument,
                                 @"outputPath must differ from videoPath; refusing to overwrite the source video."));
    return;
  }

  if (![fileManager isReadableFileAtPath:inputPath]) {
    completion(nil, VOLMakeError(VideoOverlayErrorInputNotReadable,
                                 [NSString stringWithFormat:@"Input video not found or not readable at: %@", inputPath]));
    return;
  }

  NSError *layersError = nil;
  NSArray<VOLLayer *> *layers = VOLParseLayers(layersJson, &layersError);
  if (layers == nil) {
    completion(nil, layersError);
    return;
  }

  CGFloat cropAspectRatio = VOLParseCropAspectRatio(optionsJson);

  NSURL *inputURL = [NSURL fileURLWithPath:inputPath];
  AVURLAsset *asset = [AVURLAsset URLAssetWithURL:inputURL
                                          options:@{AVURLAssetPreferPreciseDurationAndTimingKey : @YES}];

  [asset loadTracksWithMediaType:AVMediaTypeVideo
               completionHandler:^(NSArray<AVAssetTrack *> *_Nullable tracks, NSError *_Nullable trackError) {
                 dispatch_async([self workQueue], ^{
                   if (trackError != nil) {
                     completion(nil, VOLMakeError(VideoOverlayErrorNoVideoTrack,
                                                  [NSString stringWithFormat:@"Cannot read video tracks: %@",
                                                                             trackError.localizedDescription]));
                     return;
                   }
                   AVAssetTrack *videoTrack = tracks.firstObject;
                   if (videoTrack == nil) {
                     completion(nil, VOLMakeError(VideoOverlayErrorNoVideoTrack, @"The input file contains no video track."));
                     return;
                   }
                   [self exportAsset:asset
                          videoTrack:videoTrack
                              layers:layers
                     cropAspectRatio:cropAspectRatio
                          outputPath:destPath
                          completion:completion];
                 });
               }];
}

+ (void)exportAsset:(AVURLAsset *)asset
         videoTrack:(AVAssetTrack *)videoTrack
             layers:(NSArray<VOLLayer *> *)layers
    cropAspectRatio:(CGFloat)cropAspectRatio
         outputPath:(NSString *)outputPath
         completion:(VideoOverlayBurnCompletion)completion
{
  CMTime duration = videoTrack.timeRange.duration;
  double durationSec = CMTIME_IS_NUMERIC(duration) ? CMTimeGetSeconds(duration) : 0.0;
  if (!(durationSec > 0.0)) {
    completion(nil, VOLMakeError(VideoOverlayErrorNoVideoTrack, @"The video track has a zero or unknown duration."));
    return;
  }

  CGSize naturalSize = videoTrack.naturalSize;
  CGAffineTransform preferredTransform = videoTrack.preferredTransform;
  CGRect naturalRect = CGRectMake(0.0, 0.0, naturalSize.width, naturalSize.height);
  CGRect displayRect = CGRectApplyAffineTransform(naturalRect, preferredTransform);
  CGAffineTransform correctedTransform = CGAffineTransformConcat(
      preferredTransform, CGAffineTransformMakeTranslation(-displayRect.origin.x, -displayRect.origin.y));

  CGSize displaySize = CGSizeMake(VOLEvenSize(displayRect.size.width), VOLEvenSize(displayRect.size.height));
  CGSize renderSize = VOLCropSize(displaySize, cropAspectRatio);
  if (!(renderSize.width > 0.0) || !(renderSize.height > 0.0)) {
    completion(nil, VOLMakeError(VideoOverlayErrorNoVideoTrack, @"The video track has an invalid natural size."));
    return;
  }

  correctedTransform = CGAffineTransformConcat(
      correctedTransform,
      CGAffineTransformMakeTranslation(floor((renderSize.width - displaySize.width) / 2.0),
                                       floor((renderSize.height - displaySize.height) / 2.0)));

  __block CALayer *videoLayer = nil;
  __block CALayer *parentLayer = nil;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  parentLayer = VOLBuildLayerTree(layers, renderSize, durationSec, &videoLayer);
  [CATransaction commit];

  int32_t fps = (int32_t)lround((double)videoTrack.nominalFrameRate);
  if (fps <= 0 || fps > 240) {
    fps = 30;
  }

  AVMutableVideoCompositionLayerInstruction *layerInstruction =
      [AVMutableVideoCompositionLayerInstruction videoCompositionLayerInstructionWithAssetTrack:videoTrack];
  [layerInstruction setTransform:correctedTransform atTime:kCMTimeZero];

  AVMutableVideoCompositionInstruction *instruction = [AVMutableVideoCompositionInstruction videoCompositionInstruction];
  instruction.timeRange = CMTimeRangeMake(kCMTimeZero, duration);
  instruction.layerInstructions = @[ layerInstruction ];

  AVMutableVideoComposition *videoComposition = [AVMutableVideoComposition videoComposition];
  videoComposition.renderSize = renderSize;
  videoComposition.frameDuration = CMTimeMake(1, fps);
  videoComposition.instructions = @[ instruction ];
  videoComposition.animationTool =
      [AVVideoCompositionCoreAnimationTool videoCompositionCoreAnimationToolWithPostProcessingAsVideoLayer:videoLayer
                                                                                                  inLayer:parentLayer];

  videoComposition.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2;
  videoComposition.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2;
  videoComposition.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2;

  NSError *prepareError = nil;
  if (![self prepareOutputPath:outputPath error:&prepareError]) {
    completion(nil, prepareError);
    return;
  }

  AVAssetExportSession *exportSession = [[AVAssetExportSession alloc] initWithAsset:asset
                                                                         presetName:AVAssetExportPresetHighestQuality];
  if (exportSession == nil) {
    completion(nil, VOLMakeError(VideoOverlayErrorExportSetupFailed,
                                 @"Cannot create AVAssetExportSession with AVAssetExportPresetHighestQuality."));
    return;
  }
  if (![exportSession.supportedFileTypes containsObject:AVFileTypeMPEG4]) {
    completion(nil, VOLMakeError(VideoOverlayErrorExportSetupFailed, @"This asset cannot be exported as MPEG-4."));
    return;
  }

  exportSession.outputURL = [NSURL fileURLWithPath:outputPath];
  exportSession.outputFileType = AVFileTypeMPEG4;
  exportSession.videoComposition = videoComposition;
  exportSession.shouldOptimizeForNetworkUse = YES;

  [exportSession exportAsynchronouslyWithCompletionHandler:^{
    AVAssetExportSessionStatus status = exportSession.status;
    NSError *exportError = exportSession.error;

    switch (status) {
      case AVAssetExportSessionStatusCompleted:
        completion(outputPath, nil);
        break;

      case AVAssetExportSessionStatusCancelled:
        completion(nil, VOLMakeError(VideoOverlayErrorExportCancelled, @"Video export was cancelled."));
        break;

      default: {
        NSString *message = [NSString
            stringWithFormat:@"Video export failed (status %ld): %@", (long)status,
                             exportError.localizedDescription ?: @"unknown error"];
        NSMutableDictionary *userInfo = [NSMutableDictionary dictionary];
        userInfo[NSLocalizedDescriptionKey] = message;
        if (exportError != nil) {
          userInfo[NSUnderlyingErrorKey] = exportError;
        }
        completion(nil, [NSError errorWithDomain:VideoOverlayErrorDomain
                                            code:VideoOverlayErrorExportFailed
                                        userInfo:userInfo]);
        break;
      }
    }
  }];
}

/// Creates the parent directory and removes the old output file; never touches the source.
+ (BOOL)prepareOutputPath:(NSString *)outputPath error:(NSError **)outError
{
  NSFileManager *fileManager = [NSFileManager defaultManager];
  NSString *directory = [outputPath stringByDeletingLastPathComponent];

  if (directory.length > 0 && ![fileManager fileExistsAtPath:directory]) {
    NSError *createError = nil;
    if (![fileManager createDirectoryAtPath:directory
                withIntermediateDirectories:YES
                                 attributes:nil
                                      error:&createError]) {
      if (outError) {
        *outError = VOLMakeError(VideoOverlayErrorOutputNotWritable,
                                 [NSString stringWithFormat:@"Cannot create output directory %@: %@", directory,
                                                            createError.localizedDescription]);
      }
      return NO;
    }
  }

  if ([fileManager fileExistsAtPath:outputPath]) {
    NSError *removeError = nil;
    if (![fileManager removeItemAtPath:outputPath error:&removeError]) {
      if (outError) {
        *outError = VOLMakeError(VideoOverlayErrorOutputNotWritable,
                                 [NSString stringWithFormat:@"Cannot remove existing output file %@: %@", outputPath,
                                                            removeError.localizedDescription]);
      }
      return NO;
    }
  }

  return YES;
}

@end
