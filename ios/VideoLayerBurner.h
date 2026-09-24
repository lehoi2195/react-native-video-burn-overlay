// Burns an independent layer stack (image/text, optionally tiled) into a video.

#import <Foundation/Foundation.h>
#import "VideoOverlayBurner.h"

NS_ASSUME_NONNULL_BEGIN

@interface VideoLayerBurner : NSObject

/// Burns an ordered layer stack; array index 0 renders on the bottom.
/// @param videoPath    Absolute source path, no file:// prefix; never modified.
/// @param outputPath   Destination path; an existing file there is removed first.
/// @param layersJson   JSON array of OverlayLayer objects; see burn-layers-spec.md §2.6.
/// @param optionsJson  JSON object with optional cropAspectRatio and maxBitRate.
/// @param completion   Invoked on a background queue when done.
+ (void)burnLayersWithVideoPath:(NSString *)videoPath
                      outputPath:(NSString *)outputPath
                      layersJson:(NSString *)layersJson
                     optionsJson:(nullable NSString *)optionsJson
                      completion:(VideoOverlayBurnCompletion)completion;

@end

NS_ASSUME_NONNULL_END
