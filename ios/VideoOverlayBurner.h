// Burns text/image cues into a video. Never #import C++ here: use_frameworks! exposes it as Obj-C.

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT NSErrorDomain const VideoOverlayErrorDomain;

typedef NS_ERROR_ENUM(VideoOverlayErrorDomain, VideoOverlayErrorCode) {
  /// Input argument is empty or invalid.
  VideoOverlayErrorInvalidArgument = 1,
  /// The source video file could not be found / read.
  VideoOverlayErrorInputNotReadable = 2,
  /// `cuesJson` could not be parsed, is not an array, or contains no usable text line.
  VideoOverlayErrorInvalidCues = 3,
  /// The input file has no video track (e.g. an audio file, a corrupted file).
  VideoOverlayErrorNoVideoTrack = 4,
  /// Could not prepare the output path (create directory, remove old file, etc.).
  VideoOverlayErrorOutputNotWritable = 5,
  /// Could not set up the reader/writer pipeline (tracks, encoder settings, output file).
  VideoOverlayErrorExportSetupFailed = 6,
  /// The reader/writer pipeline ran but failed.
  VideoOverlayErrorExportFailed = 7,
  /// Export was cancelled.
  VideoOverlayErrorExportCancelled = 8,
  /// `layersJson` is structurally invalid (see VideoLayerBurner.h).
  VideoOverlayErrorInvalidLayers = 9,
};

/// Returns burned output path or error; invoked on an internal background queue, not main.
typedef void (^VideoOverlayBurnCompletion)(NSString *_Nullable outputPath, NSError *_Nullable error);

@interface VideoOverlayBurner : NSObject

/// Burns a text overlay into the pixels of a video.
/// @param videoPath  Absolute path to the source video (no file:// prefix); never modified or deleted.
/// @param outputPath Path to write the result to (.mp4); removed first if it already exists.
/// @param cuesJson   JSON array of cues; each uses lines or imagePath exclusively, imagePath takes priority.
/// @param styleJson  Optional style JSON; missing or invalid fields fall back independently to their defaults.
/// @param completion Invoked on a background queue when done.
+ (void)burnOverlayWithVideoPath:(NSString *)videoPath
                      outputPath:(NSString *)outputPath
                        cuesJson:(NSString *)cuesJson
                       styleJson:(nullable NSString *)styleJson
                      completion:(VideoOverlayBurnCompletion)completion;

@end

NS_ASSUME_NONNULL_END
