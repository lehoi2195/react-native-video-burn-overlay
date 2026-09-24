// Shared reader -> per-frame draw -> writer engine; the iOS twin of VideoTranscodeEngine.

#import <AVFoundation/AVFoundation.h>
#import <CoreVideo/CoreVideo.h>
#import <UIKit/UIKit.h>
#import "VideoOverlayBurner.h"

NS_ASSUME_NONNULL_BEGIN

/// Draws the overlay into one decoded BGRA frame in place; `seconds` is its presentation time.
typedef void (^VOFrameDrawer)(CVPixelBufferRef pixelBuffer, double seconds);

/// Bitmap format for overlay canvases: video pixels (scale 1), transparent, 8-bit sRGB like the frame.
UIGraphicsImageRendererFormat *VOOverlayCanvasFormat(void);

/// Alpha-blends `image` into the frame at `rect` (y-up frame coordinates, same size as the image).
void VOBlitImageIntoPixelBuffer(CVPixelBufferRef pixelBuffer, CGImageRef image, CGRect rect);

@interface VOBurnPipeline : NSObject

/// Display-oriented, centre-cropped output size; CGSizeZero when the track's size is unusable.
+ (CGSize)renderSizeForVideoTrack:(AVAssetTrack *)videoTrack cropAspectRatio:(CGFloat)cropAspectRatio;

/// Loads audio, then runs one reader -> drawer -> writer pass (retried once on failure).
/// @param maxBitRate Video bitrate cap in bits/s; 0 means no cap.
/// @param drawer     Called serially on one background queue, once per frame.
/// @param completion Invoked on a background queue when done.
+ (void)burnAsset:(AVAsset *)asset
         videoTrack:(AVAssetTrack *)videoTrack
    cropAspectRatio:(CGFloat)cropAspectRatio
         maxBitRate:(double)maxBitRate
         outputPath:(NSString *)outputPath
             drawer:(VOFrameDrawer)drawer
         completion:(VideoOverlayBurnCompletion)completion;

@end

NS_ASSUME_NONNULL_END
