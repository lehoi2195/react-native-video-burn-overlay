#import "VideoOverlayBurner.h"

#import <AVFoundation/AVFoundation.h>
#import <UIKit/UIKit.h>

#import "VOBurnPipeline.h"

NSErrorDomain const VideoOverlayErrorDomain = @"VideoOverlayErrorDomain";

#pragma mark - Display constants

/// Font size = ratio * short edge, so portrait/landscape videos get similar-looking font sizes.
static const CGFloat kVOFontSizeRatio = 0.028;

/// Left margin and bottom margin = this ratio * frame width.
static const CGFloat kVOMarginRatio = 0.05;

/// Spacing between two lines = this ratio * font size.
static const CGFloat kVOLineHeightRatio = 1.35;

/// Line box height ratio; larger than line-height so descenders and stroke outline aren't clipped.
static const CGFloat kVOBoxHeightRatio = 1.7;

/// Stroke thickness as % of font size; MUST be negative (fill+stroke), positive means outline-only.
static const CGFloat kVOStrokeWidthPercent = -6.0;

/// Minimum font size, so low-resolution video doesn't produce illegibly small text.
static const CGFloat kVOMinFontSize = 12.0;

/// Allowed fontScale range from JS, clamped so extreme values can't hide or overflow text.
static const CGFloat kVOMinFontScale = 0.5;
static const CGFloat kVOMaxFontScale = 3.0;

/// Sentinel meaning fontSize not set; 0 is safe since VOParseStyle never lets non-positive values through.
static const CGFloat kVOFontSizeUnset = 0.0;

/// Sentinel for unset strokeWidth; -1 because 0 is valid (disables the stroke).
static const CGFloat kVOStrokeWidthUnset = -1.0;

/// Tolerance used when comparing timestamps (seconds).
static const double kVOTimeEpsilon = 1e-4;

#pragma mark - Model

/// A cue: time range + content, either lines or imagePath; imagePath takes priority.
@interface VOCue : NSObject
@property (nonatomic, readonly) double startSec;
@property (nonatomic, readonly) double endSec;
@property (nonatomic, readonly, copy) NSArray<NSString *> *lines;
@property (nonatomic, readonly, copy, nullable) NSString *imagePath;
@end

@implementation VOCue
- (instancetype)initWithStart:(double)startSec
                           end:(double)endSec
                         lines:(NSArray<NSString *> *)lines
                     imagePath:(nullable NSString *)imagePath
{
  if ((self = [super init])) {
    _startSec = startSec;
    _endSec = endSec;
    _lines = [lines copy];
    _imagePath = [imagePath copy];
  }
  return self;
}
@end

/// A contiguous time range; deliberately mutable, a scratch buffer that never escapes overlay setup.
@interface VOInterval : NSObject
@property (nonatomic) double start;
@property (nonatomic) double end;
@end

@implementation VOInterval
@end

/// A run: one text string at one slot, drawn as one overlay line.
@interface VOTextRun : NSObject
@property (nonatomic) NSUInteger slot;   // 0 = the bottommost line
@property (nonatomic, copy) NSString *text;
@property (nonatomic, strong) NSMutableArray<VOInterval *> *intervals;
@end

@implementation VOTextRun
- (instancetype)init
{
  if ((self = [super init])) {
    _intervals = [NSMutableArray array];
  }
  return self;
}
@end

/// An image run: one image path with its time ranges; images never stack across lines.
@interface VOImageRun : NSObject
@property (nonatomic, copy) NSString *imagePath;
@property (nonatomic, strong) NSMutableArray<VOInterval *> *intervals;
@end

@implementation VOImageRun
- (instancetype)init
{
  if ((self = [super init])) {
    _intervals = [NSMutableArray array];
  }
  return self;
}
@end

/// Anchor position: 9 named presets or VOPositionCustom for exact {x,y}; parsed once in VOParseStyle.
typedef NS_ENUM(NSInteger, VOPosition) {
  VOPositionTopLeft = 0,
  VOPositionTopCenter,
  VOPositionTopRight,
  VOPositionCenterLeft,
  VOPositionCenter,
  VOPositionCenterRight,
  VOPositionBottomLeft,
  VOPositionBottomCenter,
  VOPositionBottomRight,
  /// Exact placement via `customX`/`customY`, bypassing `marginRatio` entirely.
  VOPositionCustom,
};

/// Horizontal alignment of a content block (text box or image) within the frame.
typedef NS_ENUM(NSInteger, VOHorizontalAlign) {
  VOHorizontalLeft,
  VOHorizontalCenter,
  VOHorizontalRight,
};

/// Vertical alignment of a content block (text box or image) within the frame.
typedef NS_ENUM(NSInteger, VOVerticalAlign) {
  VOVerticalTop,
  VOVerticalCenter,
  VOVerticalBottom,
};

/// CSS-style 100-900 weight for the system fallback; has no effect once a custom fontFamily resolves.
typedef NS_ENUM(NSInteger, VOFontWeight) {
  VOFontWeight100 = 100,
  VOFontWeight200 = 200,
  VOFontWeight300 = 300,
  VOFontWeight400 = 400, // "normal" - default
  VOFontWeight500 = 500,
  VOFontWeight600 = 600,
  VOFontWeight700 = 700, // "bold" alias
  VOFontWeight800 = 800,
  VOFontWeight900 = 900,
};

/// Style parsed from styleJson, always fully populated with defaults; pipeline needs no JSON knowledge.
@interface VOStyle : NSObject
@property (nonatomic, strong) UIColor *textColor;
@property (nonatomic, strong) UIColor *strokeColor;
@property (nonatomic, copy, nullable) NSString *fontFamily;
@property (nonatomic) VOFontWeight fontWeight;
@property (nonatomic) CGFloat fontScale;
/// Absolute pixel size, bypassing auto-computed formula and fontScale entirely; kVOFontSizeUnset (0.0) means unset.
@property (nonatomic) CGFloat fontSize;
/// Absolute pixel stroke width; 0 disables the stroke, kVOStrokeWidthUnset means use the auto default.
@property (nonatomic) CGFloat strokeWidth;
@property (nonatomic) VOPosition position;
/// Only meaningful when `position == VOPositionCustom`; 0 otherwise (unused).
@property (nonatomic) CGFloat customX;
@property (nonatomic) CGFloat customY;
@property (nonatomic) CGFloat marginRatio;
/// Alpha multiplier applied to each text line and image on its own, like per-layer opacity.
@property (nonatomic) CGFloat opacity;
/// Width/height the output is centre-cropped to; 0 keeps the source's own framing.
@property (nonatomic) CGFloat cropAspectRatio;
/// Video bitrate cap in bits/s (e.g. from an upload size limit); 0 means no cap.
@property (nonatomic) double maxBitRate;
@end

@implementation VOStyle
@end

#pragma mark - Helpers

static NSError *VOMakeError(VideoOverlayErrorCode code, NSString *message)
{
  return [NSError errorWithDomain:VideoOverlayErrorDomain
                             code:code
                         userInfo:@{NSLocalizedDescriptionKey : message ?: @"Unknown video overlay error"}];
}

#pragma mark - Parse cues

/// Parses cuesJson into VOCue array sorted by startSec; bad cues skip silently, not error.
static NSArray<VOCue *> *_Nullable VOParseCues(NSString *cuesJson, NSError **outError)
{
  if (cuesJson.length == 0) {
    if (outError) *outError = VOMakeError(VideoOverlayErrorInvalidCues, @"cuesJson is empty.");
    return nil;
  }

  NSData *data = [cuesJson dataUsingEncoding:NSUTF8StringEncoding];
  NSError *jsonError = nil;
  id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:&jsonError];

  if (parsed == nil) {
    if (outError) {
      *outError = VOMakeError(VideoOverlayErrorInvalidCues,
                              [NSString stringWithFormat:@"cuesJson is not valid JSON: %@",
                                                         jsonError.localizedDescription]);
    }
    return nil;
  }

  if (![parsed isKindOfClass:[NSArray class]]) {
    if (outError) *outError = VOMakeError(VideoOverlayErrorInvalidCues, @"cuesJson must be a JSON array of cues.");
    return nil;
  }

  NSArray *rawCues = (NSArray *)parsed;
  if (rawCues.count == 0) {
    if (outError) *outError = VOMakeError(VideoOverlayErrorInvalidCues, @"cuesJson contains an empty array.");
    return nil;
  }

  NSMutableArray<VOCue *> *cues = [NSMutableArray arrayWithCapacity:rawCues.count];

  for (id rawCue in rawCues) {
    if (![rawCue isKindOfClass:[NSDictionary class]]) {
      continue;
    }
    NSDictionary *dict = (NSDictionary *)rawCue;

    id rawStart = dict[@"startSec"];
    id rawEnd = dict[@"endSec"];

    if (![rawStart isKindOfClass:[NSNumber class]] || ![rawEnd isKindOfClass:[NSNumber class]]) {
      continue;
    }

    double start = [(NSNumber *)rawStart doubleValue];
    double end = [(NSNumber *)rawEnd doubleValue];
    if (!isfinite(start) || !isfinite(end) || end <= start + kVOTimeEpsilon) {
      continue;
    }

    // imagePath takes priority over lines when present, matching the JS-side OverlayCue contract.
    id rawImagePath = dict[@"imagePath"];
    NSString *imagePath = nil;
    if ([rawImagePath isKindOfClass:[NSString class]]) {
      NSString *trimmedPath = [(NSString *)rawImagePath
          stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
      if (trimmedPath.length > 0) {
        // Also accept file:// form to be safe, matching videoPath/outputPath handling.
        imagePath = [trimmedPath hasPrefix:@"file://"] ? ([NSURL URLWithString:trimmedPath].path ?: trimmedPath)
                                                        : trimmedPath;
      }
    }

    // No line-count cap here; max lines computed dynamically to avoid a past truncation bug.
    NSMutableArray<NSString *> *lines = [NSMutableArray array];
    if (imagePath == nil) {
      id rawLines = dict[@"lines"];
      if ([rawLines isKindOfClass:[NSArray class]]) {
        for (id rawLine in (NSArray *)rawLines) {
          if (![rawLine isKindOfClass:[NSString class]]) {
            continue;
          }
          NSString *line = [(NSString *)rawLine
              stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
          if (line.length == 0) {
            continue;
          }
          [lines addObject:line];
        }
      }
    }

    if (imagePath == nil && lines.count == 0) {
      // No image, no usable text line -> this cue has no content, skip it.
      continue;
    }

    [cues addObject:[[VOCue alloc] initWithStart:MAX(start, 0.0) end:end lines:lines imagePath:imagePath]];
  }

  if (cues.count == 0) {
    if (outError) {
      *outError = VOMakeError(VideoOverlayErrorInvalidCues,
                              @"cuesJson contains no usable cue (need startSec < endSec and either a non-empty "
                              @"lines array or an imagePath).");
    }
    return nil;
  }

  return [cues sortedArrayUsingComparator:^NSComparisonResult(VOCue *a, VOCue *b) {
    if (a.startSec < b.startSec) return NSOrderedAscending;
    if (a.startSec > b.startSec) return NSOrderedDescending;
    return NSOrderedSame;
  }];
}

#pragma mark - Parse style

/// Parses a hex string into UIColor, returning nil on invalid input; never throws or crashes.
static UIColor *_Nullable VOColorFromHexValue(id _Nullable value)
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
    // AARRGGBB
    alpha = ((hexValue >> 24) & 0xFF) / 255.0;
    red = ((hexValue >> 16) & 0xFF) / 255.0;
    green = ((hexValue >> 8) & 0xFF) / 255.0;
    blue = (hexValue & 0xFF) / 255.0;
  } else {
    // RRGGBB
    red = ((hexValue >> 16) & 0xFF) / 255.0;
    green = ((hexValue >> 8) & 0xFF) / 255.0;
    blue = (hexValue & 0xFF) / 255.0;
  }

  return [UIColor colorWithRed:red green:green blue:blue alpha:alpha];
}

/// Parses one of 9 preset strings into VOPosition; anything else falls back to VOPositionBottomLeft.
static VOPosition VOPositionFromString(id _Nullable value)
{
  if (![value isKindOfClass:[NSString class]]) {
    return VOPositionBottomLeft;
  }
  NSString *str = (NSString *)value;
  if ([str isEqualToString:@"topLeft"]) {
    return VOPositionTopLeft;
  }
  if ([str isEqualToString:@"topCenter"]) {
    return VOPositionTopCenter;
  }
  if ([str isEqualToString:@"topRight"]) {
    return VOPositionTopRight;
  }
  if ([str isEqualToString:@"centerLeft"]) {
    return VOPositionCenterLeft;
  }
  if ([str isEqualToString:@"center"]) {
    return VOPositionCenter;
  }
  if ([str isEqualToString:@"centerRight"]) {
    return VOPositionCenterRight;
  }
  if ([str isEqualToString:@"bottomCenter"]) {
    return VOPositionBottomCenter;
  }
  if ([str isEqualToString:@"bottomRight"]) {
    return VOPositionBottomRight;
  }
  return VOPositionBottomLeft;
}

/// Accepts "normal"/"bold" aliases or "100".."900" strings; anything else falls back to 400, never throws.
static VOFontWeight VOFontWeightFromString(id _Nullable value)
{
  if (![value isKindOfClass:[NSString class]]) {
    return VOFontWeight400;
  }
  NSString *str = (NSString *)value;
  if ([str isEqualToString:@"normal"]) {
    return VOFontWeight400;
  }
  if ([str isEqualToString:@"bold"]) {
    return VOFontWeight700;
  }
  if ([str isEqualToString:@"100"]) {
    return VOFontWeight100;
  }
  if ([str isEqualToString:@"200"]) {
    return VOFontWeight200;
  }
  if ([str isEqualToString:@"300"]) {
    return VOFontWeight300;
  }
  if ([str isEqualToString:@"400"]) {
    return VOFontWeight400;
  }
  if ([str isEqualToString:@"500"]) {
    return VOFontWeight500;
  }
  if ([str isEqualToString:@"600"]) {
    return VOFontWeight600;
  }
  if ([str isEqualToString:@"700"]) {
    return VOFontWeight700;
  }
  if ([str isEqualToString:@"800"]) {
    return VOFontWeight800;
  }
  if ([str isEqualToString:@"900"]) {
    return VOFontWeight900;
  }
  return VOFontWeight400;
}

/// Parses styleJson into VOStyle; fontWeight now defaults to 400, an intentional change from Semibold.
static VOStyle *VOParseStyle(NSString *_Nullable styleJson)
{
  VOStyle *style = [[VOStyle alloc] init];
  style.textColor = [UIColor whiteColor];
  style.strokeColor = [UIColor blackColor];
  style.fontFamily = nil;
  style.fontWeight = VOFontWeight400;
  style.fontScale = 1.0;
  style.fontSize = kVOFontSizeUnset;
  style.strokeWidth = kVOStrokeWidthUnset;
  style.position = VOPositionBottomLeft;
  style.customX = 0.0;
  style.customY = 0.0;
  style.marginRatio = kVOMarginRatio;
  style.opacity = 1.0;
  style.cropAspectRatio = 0.0;
  style.maxBitRate = 0.0;

  if (styleJson.length == 0) {
    return style;
  }

  NSData *data = [styleJson dataUsingEncoding:NSUTF8StringEncoding];
  if (data == nil) {
    return style;
  }

  NSError *jsonError = nil;
  id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:&jsonError];
  if (jsonError != nil || ![parsed isKindOfClass:[NSDictionary class]]) {
    // Malformed JSON or not an object -> keep the defaults, don't report an error.
    return style;
  }

  NSDictionary *dict = (NSDictionary *)parsed;

  UIColor *textColor = VOColorFromHexValue(dict[@"textColor"]);
  if (textColor != nil) {
    style.textColor = textColor;
  }

  UIColor *strokeColor = VOColorFromHexValue(dict[@"strokeColor"]);
  if (strokeColor != nil) {
    style.strokeColor = strokeColor;
  }

  id rawFontFamily = dict[@"fontFamily"];
  if ([rawFontFamily isKindOfClass:[NSString class]] && [(NSString *)rawFontFamily length] > 0) {
    style.fontFamily = (NSString *)rawFontFamily;
  }

  style.fontWeight = VOFontWeightFromString(dict[@"fontWeight"]);

  id rawFontScale = dict[@"fontScale"];
  if ([rawFontScale isKindOfClass:[NSNumber class]]) {
    double scale = [(NSNumber *)rawFontScale doubleValue];
    if (isfinite(scale) && scale > 0.0) {
      // Clamp so an extreme JS value can't break layout (text disappearing or overflowing).
      style.fontScale = MIN(MAX(scale, kVOMinFontScale), kVOMaxFontScale);
    }
  }

  id rawFontSize = dict[@"fontSize"];
  if ([rawFontSize isKindOfClass:[NSNumber class]]) {
    double size = [(NSNumber *)rawFontSize doubleValue];
    // Must be finite and positive, else falls back to auto; no upper clamp, unlike fontScale.
    if (isfinite(size) && size > 0.0) {
      style.fontSize = size;
    }
  }

  id rawStrokeWidth = dict[@"strokeWidth"];
  if ([rawStrokeWidth isKindOfClass:[NSNumber class]]) {
    double width = [(NSNumber *)rawStrokeWidth doubleValue];
    // 0 is valid here (disables the stroke), unlike fontSize where 0 falls back to auto.
    if (isfinite(width) && width >= 0.0) {
      style.strokeWidth = width;
    }
  }

  // position is a {x,y} object or preset string; malformed objects fall back to VOPositionBottomLeft.
  id rawPosition = dict[@"position"];
  if ([rawPosition isKindOfClass:[NSDictionary class]]) {
    NSDictionary *positionDict = (NSDictionary *)rawPosition;
    id rawX = positionDict[@"x"];
    id rawY = positionDict[@"y"];
    double x = [rawX isKindOfClass:[NSNumber class]] ? [(NSNumber *)rawX doubleValue] : NAN;
    double y = [rawY isKindOfClass:[NSNumber class]] ? [(NSNumber *)rawY doubleValue] : NAN;
    if (isfinite(x) && isfinite(y)) {
      style.position = VOPositionCustom;
      style.customX = MIN(MAX(x, 0.0), 1.0);
      style.customY = MIN(MAX(y, 0.0), 1.0);
    } else {
      style.position = VOPositionBottomLeft;
    }
  } else {
    style.position = VOPositionFromString(rawPosition);
  }

  id rawMarginRatio = dict[@"marginRatio"];
  if ([rawMarginRatio isKindOfClass:[NSNumber class]]) {
    double ratio = [(NSNumber *)rawMarginRatio doubleValue];
    if (isfinite(ratio)) {
      // Clamp to 0-0.5: negative or too large leaves no room for content.
      style.marginRatio = MIN(MAX(ratio, 0.0), 0.5);
    }
  }

  id rawOpacity = dict[@"opacity"];
  if ([rawOpacity isKindOfClass:[NSNumber class]]) {
    double opacity = [(NSNumber *)rawOpacity doubleValue];
    if (isfinite(opacity)) {
      // Clamp to 0-1: opacity is an alpha multiplier, values outside that range are meaningless.
      style.opacity = MIN(MAX(opacity, 0.0), 1.0);
    }
  }

  id rawCropAspectRatio = dict[@"cropAspectRatio"];
  if ([rawCropAspectRatio isKindOfClass:[NSNumber class]]) {
    double ratio = [(NSNumber *)rawCropAspectRatio doubleValue];
    // Must be finite and positive; anything else keeps the source's own framing.
    if (isfinite(ratio) && ratio > 0.0) {
      style.cropAspectRatio = ratio;
    }
  }

  id rawMaxBitRate = dict[@"maxBitRate"];
  if ([rawMaxBitRate isKindOfClass:[NSNumber class]]) {
    double value = [(NSNumber *)rawMaxBitRate doubleValue];
    // Must be finite and positive; anything else means no cap.
    if (isfinite(value) && value > 0.0) {
      style.maxBitRate = value;
    }
  }

  return style;
}

#pragma mark - Grouping cues into text runs

// Groups by (slot, text) so each distinct line is laid out once.
static NSArray<VOTextRun *> *VOBuildTextRuns(NSArray<VOCue *> *cues, double durationSec)
{
  NSMutableDictionary<NSString *, VOTextRun *> *runsByKey = [NSMutableDictionary dictionary];
  NSMutableArray<VOTextRun *> *orderedRuns = [NSMutableArray array]; // keep a stable order, for debugging

  for (VOCue *cue in cues) {
    if (cue.imagePath != nil) {
      continue; // image-mode cue - handled separately by VOBuildImageRuns
    }

    double start = MAX(cue.startSec, 0.0);
    double end = MIN(cue.endSec, durationSec);
    if (end <= start + kVOTimeEpsilon) {
      continue; // cue falls outside the video's duration
    }

    NSUInteger lineCount = cue.lines.count;
    for (NSUInteger i = 0; i < lineCount; i++) {
      NSString *text = cue.lines[i];

      // Anchor from bottom (last line = slot 0) so a missing line doesn't shift others.
      NSUInteger slot = lineCount - 1 - i;

      NSString *key = [NSString stringWithFormat:@"%lu%@", (unsigned long)slot, text];
      VOTextRun *run = runsByKey[key];
      if (run == nil) {
        run = [[VOTextRun alloc] init];
        run.slot = slot;
        run.text = text;
        runsByKey[key] = run;
        [orderedRuns addObject:run];
      }

      VOInterval *last = run.intervals.lastObject;
      if (last != nil && start <= last.end + kVOTimeEpsilon) {
        // Adjacent/overlapping cue with the same content extends the existing interval.
        last.end = MAX(last.end, end);
      } else {
        VOInterval *interval = [[VOInterval alloc] init];
        interval.start = start;
        interval.end = end;
        [run.intervals addObject:interval];
      }
    }
  }

  return orderedRuns;
}

/// Groups image cues into VOImageRun, keyed by imagePath only since images occupy a single line.
static NSArray<VOImageRun *> *VOBuildImageRuns(NSArray<VOCue *> *cues, double durationSec)
{
  NSMutableDictionary<NSString *, VOImageRun *> *runsByPath = [NSMutableDictionary dictionary];
  NSMutableArray<VOImageRun *> *orderedRuns = [NSMutableArray array];

  for (VOCue *cue in cues) {
    if (cue.imagePath == nil) {
      continue; // text-mode cue - already handled by VOBuildTextRuns
    }

    double start = MAX(cue.startSec, 0.0);
    double end = MIN(cue.endSec, durationSec);
    if (end <= start + kVOTimeEpsilon) {
      continue; // cue falls outside the video's duration
    }

    VOImageRun *run = runsByPath[cue.imagePath];
    if (run == nil) {
      run = [[VOImageRun alloc] init];
      run.imagePath = cue.imagePath;
      runsByPath[cue.imagePath] = run;
      [orderedRuns addObject:run];
    }

    VOInterval *last = run.intervals.lastObject;
    if (last != nil && start <= last.end + kVOTimeEpsilon) {
      // Adjacent/overlapping cue with the same image extends the existing interval.
      last.end = MAX(last.end, end);
    } else {
      VOInterval *interval = [[VOInterval alloc] init];
      interval.start = start;
      interval.end = end;
      [run.intervals addObject:interval];
    }
  }

  return orderedRuns;
}

#pragma mark - Text attributes

/// Maps our 100-900 CSS-style weight scale onto the standard UIFont.Weight named constants.
static UIFontWeight VOUIFontWeightFromVOFontWeight(VOFontWeight weight)
{
  switch (weight) {
    case VOFontWeight100: return UIFontWeightUltraLight;
    case VOFontWeight200: return UIFontWeightThin;
    case VOFontWeight300: return UIFontWeightLight;
    case VOFontWeight400: return UIFontWeightRegular;
    case VOFontWeight500: return UIFontWeightMedium;
    case VOFontWeight600: return UIFontWeightSemibold;
    case VOFontWeight700: return UIFontWeightBold;
    case VOFontWeight800: return UIFontWeightHeavy;
    case VOFontWeight900: return UIFontWeightBlack;
  }
  return UIFontWeightRegular;
}

static NSDictionary<NSAttributedStringKey, id> *VOTextAttributes(CGFloat fontSize, VOStyle *style)
{
  // Prefer a custom font by PostScript name; fall back to system font if not found.
  UIFont *font = nil;
  if (style.fontFamily.length > 0) {
    font = [UIFont fontWithName:style.fontFamily size:fontSize];
  }

  if (font == nil) {
    // SF Pro fully supports Vietnamese diacritics; weight now comes from style.fontWeight, not hardcoded Semibold.
    UIFontWeight weight = VOUIFontWeightFromVOFontWeight(style.fontWeight);
    font = [UIFont systemFontOfSize:fontSize weight:weight];
  }

  NSMutableDictionary<NSAttributedStringKey, id> *attributes = [@{
    NSFontAttributeName : font,
    NSForegroundColorAttributeName : style.textColor,
  } mutableCopy];

  if (style.strokeWidth != 0.0) {
    // NSStrokeWidthAttributeName wants % of fontSize, negative = fill+stroke; convert absolute px when given.
    CGFloat percent = style.strokeWidth == kVOStrokeWidthUnset
        ? kVOStrokeWidthPercent
        : -(style.strokeWidth / fontSize) * 100.0;
    attributes[NSStrokeColorAttributeName] = style.strokeColor;
    attributes[NSStrokeWidthAttributeName] = @(percent);
  }

  return attributes;
}

#pragma mark - Anchor position

/// Maps VOPosition to horizontal alignment; custom uses the same nearest-third heuristic as Android.
static VOHorizontalAlign VOPositionHorizontal(VOPosition position, CGFloat customX)
{
  switch (position) {
    case VOPositionTopLeft:
    case VOPositionCenterLeft:
    case VOPositionBottomLeft:
      return VOHorizontalLeft;
    case VOPositionTopCenter:
    case VOPositionCenter:
    case VOPositionBottomCenter:
      return VOHorizontalCenter;
    case VOPositionTopRight:
    case VOPositionCenterRight:
    case VOPositionBottomRight:
      return VOHorizontalRight;
    case VOPositionCustom:
      if (customX < 1.0 / 3.0) return VOHorizontalLeft;
      if (customX > 2.0 / 3.0) return VOHorizontalRight;
      return VOHorizontalCenter;
  }
  return VOHorizontalLeft;
}

/// Maps VOPosition to vertical alignment; custom uses the same nearest-third heuristic as Android.
static VOVerticalAlign VOPositionVertical(VOPosition position, CGFloat customY)
{
  switch (position) {
    case VOPositionTopLeft:
    case VOPositionTopCenter:
    case VOPositionTopRight:
      return VOVerticalTop;
    case VOPositionCenterLeft:
    case VOPositionCenter:
    case VOPositionCenterRight:
      return VOVerticalCenter;
    case VOPositionBottomLeft:
    case VOPositionBottomCenter:
    case VOPositionBottomRight:
      return VOVerticalBottom;
    case VOPositionCustom:
      if (customY < 1.0 / 3.0) return VOVerticalTop;
      if (customY > 2.0 / 3.0) return VOVerticalBottom;
      return VOVerticalCenter;
  }
  return VOVerticalBottom;
}

/// X of block's bottom-left; text alignment itself comes from the paragraph style.
static CGFloat VOAnchorX(VOStyle *style, CGFloat margin, CGFloat contentWidth, CGFloat renderWidth)
{
  if (style.position == VOPositionCustom) {
    CGFloat available = MAX(renderWidth - contentWidth, 0.0);
    return available * style.customX;
  }
  switch (VOPositionHorizontal(style.position, 0.0)) {
    case VOHorizontalRight: return renderWidth - margin - contentWidth;
    case VOHorizontalCenter: return (renderWidth - contentWidth) / 2.0;
    case VOHorizontalLeft: default: return margin;
  }
}

/// Y for a single block; custom position converts top-down customY into the frame's bottom-up Y.
static CGFloat VOAnchorYForBlock(VOStyle *style, CGFloat margin, CGFloat blockHeight, CGFloat renderHeight)
{
  if (style.position == VOPositionCustom) {
    CGFloat available = MAX(renderHeight - blockHeight, 0.0);
    return available * (1.0 - style.customY);
  }
  switch (VOPositionVertical(style.position, 0.0)) {
    case VOVerticalTop: return renderHeight - margin - blockHeight;
    case VOVerticalCenter: return (renderHeight - blockHeight) / 2.0;
    case VOVerticalBottom: default: return margin;
  }
}

static NSTextAlignment VOTextAlignmentForStyle(VOStyle *style)
{
  switch (VOPositionHorizontal(style.position, style.customX)) {
    case VOHorizontalCenter: return NSTextAlignmentCenter;
    case VOHorizontalRight: return NSTextAlignmentRight;
    case VOHorizontalLeft: default: return NSTextAlignmentLeft;
  }
}

#pragma mark - Overlay renderer

/// Intervals are [start, end): exactly at a boundary the next cue wins, like discrete keyframes.
static BOOL VOIsVisibleAt(NSArray<VOInterval *> *intervals, double seconds)
{
  for (VOInterval *interval in intervals) {
    if (seconds + kVOTimeEpsilon >= interval.start && seconds < interval.end - kVOTimeEpsilon) {
      return YES;
    }
  }
  return NO;
}

/// Blits the overlay into each frame; its bitmap is re-rendered only when visible cues change.
@interface VOOverlayRenderer : NSObject
- (instancetype)initWithTextRuns:(NSArray<VOTextRun *> *)textRuns
                       imageRuns:(NSArray<VOImageRun *> *)imageRuns
                      renderSize:(CGSize)renderSize
                           style:(VOStyle *)style;
- (void)drawIntoPixelBuffer:(CVPixelBufferRef)pixelBuffer atTime:(double)seconds;
@end

@implementation VOOverlayRenderer {
  NSArray<VOTextRun *> *_textRuns;
  NSArray<NSAttributedString *> *_textStrings;
  // Parallel arrays holding only the images that loaded successfully.
  NSArray<VOImageRun *> *_imageRuns;
  NSArray<UIImage *> *_images;
  NSArray<NSValue *> *_imageRects;

  CGFloat _textWidth;
  CGFloat _lineHeight;
  CGFloat _boxHeight;
  CGFloat _totalBlockHeight;
  CGFloat _opacity;
  /// Text block rect in y-up frame coordinates.
  CGRect _blockRect;
  /// Union of everything we may draw, in y-up frame coordinates; the only pixels ever touched.
  CGRect _contentRect;

  NSIndexSet *_cachedVisible;
  UIImage *_cachedOverlay;
}

- (instancetype)initWithTextRuns:(NSArray<VOTextRun *> *)textRuns
                       imageRuns:(NSArray<VOImageRun *> *)imageRuns
                      renderSize:(CGSize)renderSize
                           style:(VOStyle *)style
{
  if ((self = [super init])) {
    _textRuns = textRuns;
    _opacity = style.opacity;

    // fontSize (when set) bypasses the auto formula and fontScale entirely, avoiding confusing double-scaling.
    CGFloat fontSize;
    if (style.fontSize != kVOFontSizeUnset) {
      fontSize = style.fontSize;
    } else {
      fontSize = MAX(kVOMinFontSize, floor(MIN(renderSize.width, renderSize.height) * kVOFontSizeRatio));
      fontSize = fontSize * style.fontScale;
    }
    _lineHeight = ceil(fontSize * kVOLineHeightRatio);
    _boxHeight = ceil(fontSize * kVOBoxHeightRatio);
    // Use style.marginRatio, not the constant directly, so JS's marginRatio field actually takes effect.
    CGFloat margin = floor(renderSize.width * style.marginRatio);
    _textWidth = MAX(renderSize.width - (margin * 2.0), 1.0);

    NSMutableDictionary<NSAttributedStringKey, id> *attributes = [VOTextAttributes(fontSize, style) mutableCopy];
    NSMutableParagraphStyle *paragraph = [[NSMutableParagraphStyle alloc] init];
    // Text hugs the anchored edge or centre within its box; overflow truncates.
    paragraph.alignment = VOTextAlignmentForStyle(style);
    paragraph.lineBreakMode = NSLineBreakByTruncatingTail;
    attributes[NSParagraphStyleAttributeName] = paragraph;

    NSMutableArray<NSAttributedString *> *strings = [NSMutableArray arrayWithCapacity:textRuns.count];
    // Max line count computed dynamically from textRuns, never hardcoded, to avoid a past overlap/drop bug.
    NSUInteger maxSlotIndex = 0;
    for (VOTextRun *run in textRuns) {
      [strings addObject:[[NSAttributedString alloc] initWithString:run.text attributes:attributes]];
      maxSlotIndex = MAX(maxSlotIndex, run.slot);
    }
    _textStrings = strings;

    _totalBlockHeight = (CGFloat)maxSlotIndex * _lineHeight + _boxHeight;
    _blockRect = CGRectMake(VOAnchorX(style, margin, _textWidth, renderSize.width),
                            VOAnchorYForBlock(style, margin, _totalBlockHeight, renderSize.height),
                            _textWidth,
                            _totalBlockHeight);

    CGRect content = CGRectNull;
    if (textRuns.count > 0) {
      // Pad for stroke outlines and glyph overhang past the line boxes.
      CGFloat pad = ceil(fontSize * 0.5);
      content = CGRectInset(_blockRect, -pad, -pad);
    }

    NSMutableArray<VOImageRun *> *loadedRuns = [NSMutableArray array];
    NSMutableArray<UIImage *> *loadedImages = [NSMutableArray array];
    NSMutableArray<NSValue *> *loadedRects = [NSMutableArray array];
    for (VOImageRun *run in imageRuns) {
      UIImage *image = [UIImage imageWithContentsOfFile:run.imagePath];
      CGImageRef cgImage = image.CGImage;
      if (image == nil || cgImage == NULL) {
        // Skip unreadable/malformed images safely, without crashing or blocking other cues.
        NSLog(@"[VideoOverlayBurner] Skipping image cue that could not be read at path: %@", run.imagePath);
        continue;
      }
      // Use CGImageGetWidth/Height for true pixel size (UIImage.size is a scaled point-size); no scaling here.
      CGFloat imageWidth = (CGFloat)CGImageGetWidth(cgImage);
      CGFloat imageHeight = (CGFloat)CGImageGetHeight(cgImage);
      if (!(imageWidth > 0.0) || !(imageHeight > 0.0)) {
        NSLog(@"[VideoOverlayBurner] Skipping image cue with an invalid size: %@", run.imagePath);
        continue;
      }
      CGRect rect = CGRectMake(VOAnchorX(style, margin, imageWidth, renderSize.width),
                               VOAnchorYForBlock(style, margin, imageHeight, renderSize.height),
                               imageWidth,
                               imageHeight);
      [loadedRuns addObject:run];
      [loadedImages addObject:[UIImage imageWithCGImage:cgImage scale:1.0 orientation:UIImageOrientationUp]];
      [loadedRects addObject:[NSValue valueWithCGRect:rect]];
      content = CGRectUnion(content, rect);
    }
    _imageRuns = loadedRuns;
    _images = loadedImages;
    _imageRects = loadedRects;

    CGRect frame = CGRectMake(0.0, 0.0, renderSize.width, renderSize.height);
    CGRect clipped = CGRectIsNull(content) ? CGRectNull : CGRectIntersection(content, frame);
    _contentRect = CGRectIsNull(clipped) ? CGRectZero : CGRectIntegral(clipped);
  }
  return self;
}

- (NSIndexSet *)visibleIndexesAt:(double)seconds
{
  NSMutableIndexSet *indexes = [NSMutableIndexSet indexSet];
  [_textRuns enumerateObjectsUsingBlock:^(VOTextRun *run, NSUInteger idx, BOOL *stop) {
    if (VOIsVisibleAt(run.intervals, seconds)) {
      [indexes addIndex:idx];
    }
  }];
  // Image indexes sit past text runs, so one set captures the whole visible state.
  NSUInteger offset = _textRuns.count;
  [_imageRuns enumerateObjectsUsingBlock:^(VOImageRun *run, NSUInteger idx, BOOL *stop) {
    if (VOIsVisibleAt(run.intervals, seconds)) {
      [indexes addIndex:offset + idx];
    }
  }];
  return indexes;
}

- (nullable UIImage *)renderOverlayForIndexes:(NSIndexSet *)indexes
{
  if (indexes.count == 0 || CGRectIsEmpty(_contentRect)) {
    return nil;
  }

  CGRect content = _contentRect;
  NSUInteger textCount = _textRuns.count;
  UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:content.size
                                                                              format:VOOverlayCanvasFormat()];
  return [renderer imageWithActions:^(UIGraphicsImageRendererContext *rendererContext) {
    CGContextRef context = rendererContext.CGContext;
    // Canvas is UIKit y-down but layout maths is y-up, so every element flips Y.
    CGFloat canvasMaxY = CGRectGetMaxY(content);

    // Each line is its own transparency group, so its stroke and fill never double-blend.
    CGContextSetAlpha(context, self->_opacity);
    CGFloat blockLeft = CGRectGetMinX(self->_blockRect) - content.origin.x;
    CGFloat blockTop = canvasMaxY - CGRectGetMaxY(self->_blockRect);
    [indexes enumerateIndexesInRange:NSMakeRange(0, textCount)
                             options:0
                          usingBlock:^(NSUInteger idx, BOOL *stop) {
                            VOTextRun *run = self->_textRuns[idx];
                            // Slot 0 is the bottom line; text sits flush against each box's top.
                            CGFloat lineTop =
                                self->_totalBlockHeight - ((CGFloat)run.slot * self->_lineHeight + self->_boxHeight);
                            CGRect box = CGRectMake(blockLeft, blockTop + lineTop, self->_textWidth, self->_boxHeight);
                            CGContextBeginTransparencyLayer(context, NULL);
                            [self->_textStrings[idx]
                                drawWithRect:box
                                     options:NSStringDrawingUsesLineFragmentOrigin |
                                             NSStringDrawingTruncatesLastVisibleLine
                                     context:nil];
                            CGContextEndTransparencyLayer(context);
                          }];

    // Images draw on top of text (fixed z-order) since images are usually primary content.
    [indexes enumerateIndexesInRange:NSMakeRange(textCount, self->_images.count)
                             options:0
                          usingBlock:^(NSUInteger idx, BOOL *stop) {
                            NSUInteger imageIndex = idx - textCount;
                            CGRect rect = [self->_imageRects[imageIndex] CGRectValue];
                            CGRect canvasRect = CGRectMake(rect.origin.x - content.origin.x,
                                                           canvasMaxY - CGRectGetMaxY(rect),
                                                           rect.size.width,
                                                           rect.size.height);
                            [self->_images[imageIndex] drawInRect:canvasRect];
                          }];
  }];
}

- (void)drawIntoPixelBuffer:(CVPixelBufferRef)pixelBuffer atTime:(double)seconds
{
  NSIndexSet *visible = [self visibleIndexesAt:seconds];
  if (_cachedVisible == nil || ![visible isEqualToIndexSet:_cachedVisible]) {
    _cachedVisible = visible;
    _cachedOverlay = [self renderOverlayForIndexes:visible];
  }

  CGImageRef overlay = _cachedOverlay.CGImage;
  if (overlay != NULL) {
    VOBlitImageIntoPixelBuffer(pixelBuffer, overlay, _contentRect);
  }
}

@end

#pragma mark - VideoOverlayBurner

@implementation VideoOverlayBurner

+ (dispatch_queue_t)workQueue
{
  static dispatch_queue_t queue;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    queue = dispatch_queue_create("com.smartsales.videooverlay.burn", DISPATCH_QUEUE_SERIAL);
  });
  return queue;
}

+ (void)burnOverlayWithVideoPath:(NSString *)videoPath
                      outputPath:(NSString *)outputPath
                        cuesJson:(NSString *)cuesJson
                       styleJson:(nullable NSString *)styleJson
                      completion:(VideoOverlayBurnCompletion)completion
{
  NSParameterAssert(completion != nil);

  // Push all work onto a background queue; this method is called from the JS thread.
  dispatch_async([self workQueue], ^{
    [self performBurnWithVideoPath:videoPath
                        outputPath:outputPath
                          cuesJson:cuesJson
                         styleJson:styleJson
                        completion:completion];
  });
}

+ (void)performBurnWithVideoPath:(NSString *)videoPath
                      outputPath:(NSString *)outputPath
                        cuesJson:(NSString *)cuesJson
                       styleJson:(nullable NSString *)styleJson
                      completion:(VideoOverlayBurnCompletion)completion
{
  NSFileManager *fileManager = [NSFileManager defaultManager];

  if (videoPath.length == 0 || outputPath.length == 0) {
    completion(nil, VOMakeError(VideoOverlayErrorInvalidArgument, @"videoPath and outputPath must not be empty."));
    return;
  }

  // Also accept file:// form to be safe, though the spec expects a plain path.
  NSString *inputPath = [videoPath hasPrefix:@"file://"] ? ([NSURL URLWithString:videoPath].path ?: videoPath) : videoPath;
  NSString *destPath = [outputPath hasPrefix:@"file://"] ? ([NSURL URLWithString:outputPath].path ?: outputPath) : outputPath;

  // DATA SAFETY: block output==input up front, or removing the old output would delete the source.
  if ([[inputPath stringByStandardizingPath] isEqualToString:[destPath stringByStandardizingPath]]) {
    completion(nil, VOMakeError(VideoOverlayErrorInvalidArgument,
                                @"outputPath must differ from videoPath; refusing to overwrite the source video."));
    return;
  }

  if (![fileManager isReadableFileAtPath:inputPath]) {
    completion(nil, VOMakeError(VideoOverlayErrorInputNotReadable,
                                [NSString stringWithFormat:@"Input video not found or not readable at: %@", inputPath]));
    return;
  }

  NSError *cueError = nil;
  NSArray<VOCue *> *cues = VOParseCues(cuesJson, &cueError);
  if (cues == nil) {
    completion(nil, cueError);
    return;
  }

  // VOParseStyle never returns an error; malformed fields just fall back to their defaults.
  VOStyle *style = VOParseStyle(styleJson);

  NSURL *inputURL = [NSURL fileURLWithPath:inputPath];
  AVURLAsset *asset = [AVURLAsset URLAssetWithURL:inputURL
                                          options:@{AVURLAssetPreferPreciseDurationAndTimingKey : @YES}];

  [asset loadTracksWithMediaType:AVMediaTypeVideo
               completionHandler:^(NSArray<AVAssetTrack *> *_Nullable tracks, NSError *_Nullable trackError) {
                 // This callback may run on any queue -> hop back onto our own queue.
                 dispatch_async([self workQueue], ^{
                   if (trackError != nil) {
                     completion(nil, VOMakeError(VideoOverlayErrorNoVideoTrack,
                                                 [NSString stringWithFormat:@"Cannot read video tracks: %@",
                                                                            trackError.localizedDescription]));
                     return;
                   }
                   AVAssetTrack *videoTrack = tracks.firstObject;
                   if (videoTrack == nil) {
                     completion(nil, VOMakeError(VideoOverlayErrorNoVideoTrack,
                                                 @"The input file contains no video track."));
                     return;
                   }
                   [self exportAsset:asset
                          videoTrack:videoTrack
                                cues:cues
                               style:style
                          outputPath:destPath
                          completion:completion];
                 });
               }];
}

+ (void)exportAsset:(AVURLAsset *)asset
         videoTrack:(AVAssetTrack *)videoTrack
               cues:(NSArray<VOCue *> *)cues
              style:(VOStyle *)style
         outputPath:(NSString *)outputPath
         completion:(VideoOverlayBurnCompletion)completion
{
  CMTime duration = videoTrack.timeRange.duration;
  double durationSec = CMTIME_IS_NUMERIC(duration) ? CMTimeGetSeconds(duration) : 0.0;
  if (!(durationSec > 0.0)) {
    completion(nil, VOMakeError(VideoOverlayErrorNoVideoTrack, @"The video track has a zero or unknown duration."));
    return;
  }

  CGSize renderSize = [VOBurnPipeline renderSizeForVideoTrack:videoTrack cropAspectRatio:style.cropAspectRatio];
  if (CGSizeEqualToSize(renderSize, CGSizeZero)) {
    completion(nil, VOMakeError(VideoOverlayErrorNoVideoTrack, @"The video track has an invalid natural size."));
    return;
  }

  NSArray<VOTextRun *> *textRuns = VOBuildTextRuns(cues, durationSec);
  NSArray<VOImageRun *> *imageRuns = VOBuildImageRuns(cues, durationSec);
  if (textRuns.count == 0 && imageRuns.count == 0) {
    completion(nil, VOMakeError(VideoOverlayErrorInvalidCues,
                                @"No cue overlaps the video timeline; nothing would be drawn."));
    return;
  }

  VOOverlayRenderer *overlay = [[VOOverlayRenderer alloc] initWithTextRuns:textRuns
                                                                 imageRuns:imageRuns
                                                                renderSize:renderSize
                                                                     style:style];

  [VOBurnPipeline burnAsset:asset
                 videoTrack:videoTrack
            cropAspectRatio:style.cropAspectRatio
                 maxBitRate:style.maxBitRate
                 outputPath:outputPath
                     drawer:^(CVPixelBufferRef pixelBuffer, double seconds) {
                       [overlay drawIntoPixelBuffer:pixelBuffer atTime:seconds];
                     }
                 completion:completion];
}

@end
