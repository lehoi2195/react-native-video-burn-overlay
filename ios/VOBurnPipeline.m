#import "VOBurnPipeline.h"

#pragma mark - Helpers

static NSError *VOPMakeError(VideoOverlayErrorCode code, NSString *message)
{
  return [NSError errorWithDomain:VideoOverlayErrorDomain
                             code:code
                         userInfo:@{NSLocalizedDescriptionKey : message ?: @"Unknown video overlay error"}];
}

/// H.264/HEVC require even dimensions; odd sizes get padded with a green/black edge line.
static CGFloat VOPEvenSize(CGFloat value)
{
  CGFloat rounded = round(value / 2.0) * 2.0;
  return MAX(rounded, 2.0);
}

/// Centre-crops only, never pads or upscales; ratio <= 0 keeps the size.
static CGSize VOPCropSize(CGSize size, CGFloat ratio)
{
  if (!(ratio > 0.0) || !(size.width > 0.0) || !(size.height > 0.0)) {
    return size;
  }
  CGFloat current = size.width / size.height;
  if (current > ratio) {
    return CGSizeMake(VOPEvenSize(MIN(size.height * ratio, size.width)), size.height);
  }
  if (current < ratio) {
    return CGSizeMake(size.width, VOPEvenSize(MIN(size.width / ratio, size.height)));
  }
  return size;
}

UIGraphicsImageRendererFormat *VOOverlayCanvasFormat(void)
{
  UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat preferredFormat];
  format.scale = 1.0; // the canvas is in video pixels, not screen points
  format.opaque = NO;
  // 8-bit sRGB like the frame context, so blitting never colour-converts or needs a wide-gamut buffer.
  format.preferredRange = UIGraphicsImageRendererFormatRangeStandard;
  return format;
}

void VOBlitImageIntoPixelBuffer(CVPixelBufferRef pixelBuffer, CGImageRef image, CGRect rect)
{
  static CGColorSpaceRef colorSpace;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    colorSpace = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  });

  CVPixelBufferLockBaseAddress(pixelBuffer, 0);
  // Frame treated as opaque BGRA, so blending never depends on its alpha byte.
  CGContextRef context = CGBitmapContextCreate(CVPixelBufferGetBaseAddress(pixelBuffer),
                                               CVPixelBufferGetWidth(pixelBuffer),
                                               CVPixelBufferGetHeight(pixelBuffer),
                                               8,
                                               CVPixelBufferGetBytesPerRow(pixelBuffer),
                                               colorSpace,
                                               kCGImageAlphaNoneSkipFirst | kCGBitmapByteOrder32Little);
  if (context != NULL) {
    // Rect matches the bitmap 1:1: no resampling, and pixels outside it stay untouched.
    CGContextSetInterpolationQuality(context, kCGInterpolationNone);
    // Bitmap contexts are y-up like the layout maths, so the rect needs no flip.
    CGContextDrawImage(context, rect, image);
    CGContextRelease(context);
  }
  CVPixelBufferUnlockBaseAddress(pixelBuffer, 0);
}

#pragma mark - Encoder settings

/// Headroom above the source bitrate keeps the re-encode visually lossless despite added overlay detail.
static const double kVOPBitRateHeadroom = 1.5;

/// Floor/ceiling guarding against a missing or absurd estimatedDataRate; ceiling never undercuts the source.
static const double kVOPMinBitRate = 1000000.0;
static const double kVOPMaxBitRate = 20000000.0;

/// Lowest accepted maxBitRate; tinier caps make encoders fail or emit mush.
static const double kVOPMinBitRateCap = 100000.0;

/// Fallback when the track has no estimatedDataRate: bits per pixel per frame.
static const double kVOPFallbackBitsPerPixel = 0.1;

/// AAC bitrate used only when the source audio is not AAC and must be transcoded.
static const NSInteger kVOPAudioBitRate = 128000;

/// H.264 at source bitrate plus headroom, BT.709 SDR; maxBitRate (0 = none) wins over everything.
static NSDictionary<NSString *, id> *VOPVideoSettings(CGSize renderSize, int32_t fps, float sourceBitRate, double maxBitRate)
{
  double bitRate = sourceBitRate > 0.0f
      ? (double)sourceBitRate * kVOPBitRateHeadroom
      : renderSize.width * renderSize.height * (double)fps * kVOPFallbackBitsPerPixel;
  bitRate = MIN(MAX(bitRate, kVOPMinBitRate), MAX(kVOPMaxBitRate, (double)sourceBitRate));
  if (maxBitRate > 0.0) {
    bitRate = MIN(bitRate, MAX(maxBitRate, kVOPMinBitRateCap));
  }

  return @{
    AVVideoCodecKey : AVVideoCodecTypeH264,
    AVVideoWidthKey : @(renderSize.width),
    AVVideoHeightKey : @(renderSize.height),
    AVVideoCompressionPropertiesKey : @{
      AVVideoAverageBitRateKey : @((NSInteger)bitRate),
      AVVideoProfileLevelKey : AVVideoProfileLevelH264HighAutoLevel,
      AVVideoExpectedSourceFrameRateKey : @(fps),
    },
    AVVideoColorPropertiesKey : @{
      AVVideoColorPrimariesKey : AVVideoColorPrimaries_ITU_R_709_2,
      AVVideoTransferFunctionKey : AVVideoTransferFunction_ITU_R_709_2,
      AVVideoYCbCrMatrixKey : AVVideoYCbCrMatrix_ITU_R_709_2,
    },
  };
}

#pragma mark - Burn session

typedef void (^VOBurnSessionCompletion)(NSError *_Nullable error, BOOL cancelled);

/// One reader -> overlay -> writer pass; reader/writer are single-use, so retries need new sessions.
@interface VOBurnSession : NSObject
@property (atomic) BOOL cancelled;
- (instancetype)initWithAsset:(AVAsset *)asset
                   videoTrack:(AVAssetTrack *)videoTrack
                   audioTrack:(nullable AVAssetTrack *)audioTrack
             videoComposition:(AVVideoComposition *)videoComposition
                       drawer:(VOFrameDrawer)drawer
                videoSettings:(NSDictionary<NSString *, id> *)videoSettings
                   outputPath:(NSString *)outputPath;
- (void)startWithCompletion:(VOBurnSessionCompletion)completion;
- (void)cancel;
@end

@implementation VOBurnSession {
  AVAsset *_asset;
  AVAssetTrack *_videoTrack;
  AVAssetTrack *_audioTrack;
  AVVideoComposition *_videoComposition;
  VOFrameDrawer _drawer;
  NSDictionary<NSString *, id> *_videoSettings;
  NSString *_outputPath;

  AVAssetReader *_reader;
  AVAssetWriter *_writer;
  dispatch_queue_t _stateQueue;
  VOBurnSessionCompletion _completion;
}

- (instancetype)initWithAsset:(AVAsset *)asset
                   videoTrack:(AVAssetTrack *)videoTrack
                   audioTrack:(nullable AVAssetTrack *)audioTrack
             videoComposition:(AVVideoComposition *)videoComposition
                       drawer:(VOFrameDrawer)drawer
                videoSettings:(NSDictionary<NSString *, id> *)videoSettings
                   outputPath:(NSString *)outputPath
{
  if ((self = [super init])) {
    _asset = asset;
    _videoTrack = videoTrack;
    _audioTrack = audioTrack;
    _videoComposition = videoComposition;
    _drawer = [drawer copy];
    _videoSettings = videoSettings;
    _outputPath = [outputPath copy];
    _stateQueue = dispatch_queue_create("com.rx.videooverlay.state", DISPATCH_QUEUE_SERIAL);
  }
  return self;
}

- (void)cancel
{
  self.cancelled = YES;
  dispatch_async(_stateQueue, ^{
    // Makes copyNextSampleBuffer return NULL, so both pump loops wind down and the group completes.
    [self->_reader cancelReading];
  });
}

/// Invokes the completion exactly once, then drops reader/writer to break the input-block retain cycle.
- (void)finishWithError:(nullable NSError *)error cancelled:(BOOL)cancelled
{
  VOBurnSessionCompletion completion = _completion;
  _completion = nil;
  _reader = nil;
  _writer = nil;
  if (completion != nil) {
    completion(error, cancelled);
  }
}

- (NSError *)setupError:(NSString *)message underlying:(nullable NSError *)underlying
{
  NSMutableDictionary *userInfo = [NSMutableDictionary dictionary];
  userInfo[NSLocalizedDescriptionKey] =
      underlying != nil ? [NSString stringWithFormat:@"%@: %@", message, underlying.localizedDescription] : message;
  if (underlying != nil) {
    userInfo[NSUnderlyingErrorKey] = underlying;
  }
  return [NSError errorWithDomain:VideoOverlayErrorDomain code:VideoOverlayErrorExportSetupFailed userInfo:userInfo];
}

/// AAC is copied into the MP4 untouched (bit-identical, no encode cost); anything else becomes AAC.
- (BOOL)makeAudioOutput:(AVAssetReaderTrackOutput **)outOutput input:(AVAssetWriterInput **)outInput
{
  CMFormatDescriptionRef format = (__bridge CMFormatDescriptionRef)_audioTrack.formatDescriptions.firstObject;
  const AudioStreamBasicDescription *asbd = format != NULL ? CMAudioFormatDescriptionGetStreamBasicDescription(format) : NULL;

  if (asbd != NULL && asbd->mFormatID == kAudioFormatMPEG4AAC) {
    *outOutput = [AVAssetReaderTrackOutput assetReaderTrackOutputWithTrack:_audioTrack outputSettings:nil];
    *outInput = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeAudio
                                                   outputSettings:nil
                                                 sourceFormatHint:format];
  } else {
    double sampleRate = (asbd != NULL && asbd->mSampleRate > 0.0) ? asbd->mSampleRate : 44100.0;
    NSInteger channels = (asbd != NULL && asbd->mChannelsPerFrame > 0) ? MIN((NSInteger)asbd->mChannelsPerFrame, 2) : 1;
    *outOutput = [AVAssetReaderTrackOutput assetReaderTrackOutputWithTrack:_audioTrack
                                                            outputSettings:@{
                                                              AVFormatIDKey : @(kAudioFormatLinearPCM),
                                                              AVSampleRateKey : @(sampleRate),
                                                              AVNumberOfChannelsKey : @(channels),
                                                            }];
    *outInput = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeAudio
                                                   outputSettings:@{
                                                     AVFormatIDKey : @(kAudioFormatMPEG4AAC),
                                                     AVSampleRateKey : @(sampleRate),
                                                     AVNumberOfChannelsKey : @(channels),
                                                     AVEncoderBitRateKey : @(kVOPAudioBitRate),
                                                   }];
  }
  (*outInput).expectsMediaDataInRealTime = NO;
  return [_reader canAddOutput:*outOutput] && [_writer canAddInput:*outInput];
}

- (void)startWithCompletion:(VOBurnSessionCompletion)completion
{
  _completion = [completion copy];

  NSError *error = nil;
  _reader = [AVAssetReader assetReaderWithAsset:_asset error:&error];
  if (_reader == nil) {
    [self finishWithError:[self setupError:@"Cannot create AVAssetReader" underlying:error] cancelled:NO];
    return;
  }
  _writer = [AVAssetWriter assetWriterWithURL:[NSURL fileURLWithPath:_outputPath] fileType:AVFileTypeMPEG4 error:&error];
  if (_writer == nil) {
    [self finishWithError:[self setupError:@"Cannot create AVAssetWriter" underlying:error] cancelled:NO];
    return;
  }
  _writer.shouldOptimizeForNetworkUse = YES;

  // The composition only rotates/crops (GPU); frames come out as BGRA for the CPU overlay blit.
  AVAssetReaderVideoCompositionOutput *videoOutput = [AVAssetReaderVideoCompositionOutput
      assetReaderVideoCompositionOutputWithVideoTracks:@[ _videoTrack ]
                                         videoSettings:@{
                                           (id)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA),
                                           (id)kCVPixelBufferIOSurfacePropertiesKey : @{},
                                         }];
  videoOutput.videoComposition = _videoComposition;
  // We draw into the decoded buffer in place, so skip the reader's defensive copy.
  videoOutput.alwaysCopiesSampleData = NO;
  AVAssetWriterInput *videoInput = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeVideo
                                                                      outputSettings:_videoSettings];
  videoInput.expectsMediaDataInRealTime = NO;
  if (![_reader canAddOutput:videoOutput] || ![_writer canAddInput:videoInput]) {
    [self finishWithError:[self setupError:@"Cannot attach the video track to reader/writer" underlying:nil]
                cancelled:NO];
    return;
  }
  [_reader addOutput:videoOutput];
  [_writer addInput:videoInput];

  AVAssetReaderTrackOutput *audioOutput = nil;
  AVAssetWriterInput *audioInput = nil;
  if (_audioTrack != nil) {
    // Never drop audio silently: a video without sound is worse than a failed burn.
    if (![self makeAudioOutput:&audioOutput input:&audioInput]) {
      [self finishWithError:[self setupError:@"Cannot attach the audio track to reader/writer" underlying:nil]
                  cancelled:NO];
      return;
    }
    [_reader addOutput:audioOutput];
    [_writer addInput:audioInput];
  }

  if (![_reader startReading]) {
    [self finishWithError:[self setupError:@"Cannot start reading the source video" underlying:_reader.error]
                cancelled:NO];
    return;
  }
  if (![_writer startWriting]) {
    [_reader cancelReading];
    [self finishWithError:[self setupError:@"Cannot start writing the output video" underlying:_writer.error]
                cancelled:NO];
    return;
  }
  [_writer startSessionAtSourceTime:kCMTimeZero];

  dispatch_group_t group = dispatch_group_create();
  VOFrameDrawer drawer = _drawer;

  dispatch_group_enter(group);
  dispatch_queue_t videoQueue = dispatch_queue_create("com.rx.videooverlay.video", DISPATCH_QUEUE_SERIAL);
  __block BOOL videoDone = NO;
  [videoInput requestMediaDataWhenReadyOnQueue:videoQueue
                                    usingBlock:^{
                                      while (!videoDone && videoInput.isReadyForMoreMediaData) {
                                        @autoreleasepool {
                                          CMSampleBufferRef sampleBuffer =
                                              self.cancelled ? NULL : [videoOutput copyNextSampleBuffer];
                                          if (sampleBuffer == NULL) {
                                            videoDone = YES;
                                            [videoInput markAsFinished];
                                            dispatch_group_leave(group);
                                            break;
                                          }
                                          CVPixelBufferRef pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer);
                                          if (pixelBuffer != NULL) {
                                            drawer(pixelBuffer,
                                                   CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer)));
                                          }
                                          BOOL appended = [videoInput appendSampleBuffer:sampleBuffer];
                                          CFRelease(sampleBuffer);
                                          if (!appended) {
                                            // Writer failed; its status/error is reported after the group finishes.
                                            videoDone = YES;
                                            dispatch_group_leave(group);
                                            break;
                                          }
                                        }
                                      }
                                    }];

  if (audioInput != nil) {
    dispatch_group_enter(group);
    dispatch_queue_t audioQueue = dispatch_queue_create("com.rx.videooverlay.audio", DISPATCH_QUEUE_SERIAL);
    __block BOOL audioDone = NO;
    [audioInput requestMediaDataWhenReadyOnQueue:audioQueue
                                      usingBlock:^{
                                        while (!audioDone && audioInput.isReadyForMoreMediaData) {
                                          @autoreleasepool {
                                            CMSampleBufferRef sampleBuffer =
                                                self.cancelled ? NULL : [audioOutput copyNextSampleBuffer];
                                            if (sampleBuffer == NULL) {
                                              audioDone = YES;
                                              [audioInput markAsFinished];
                                              dispatch_group_leave(group);
                                              break;
                                            }
                                            BOOL appended = [audioInput appendSampleBuffer:sampleBuffer];
                                            CFRelease(sampleBuffer);
                                            if (!appended) {
                                              audioDone = YES;
                                              dispatch_group_leave(group);
                                              break;
                                            }
                                          }
                                        }
                                      }];
  }

  dispatch_group_notify(group, _stateQueue, ^{
    [self completeWriting];
  });
}

- (void)completeWriting
{
  if (self.cancelled) {
    [_reader cancelReading];
    [_writer cancelWriting];
    [self finishWithError:nil cancelled:YES];
    return;
  }
  if (_reader.status == AVAssetReaderStatusFailed) {
    NSError *readerError = _reader.error;
    [_writer cancelWriting];
    [self finishWithError:readerError ?: VOPMakeError(VideoOverlayErrorExportFailed, @"Reading the source video failed.")
                cancelled:NO];
    return;
  }
  if (_writer.status == AVAssetWriterStatusFailed) {
    NSError *writerError = _writer.error;
    [_reader cancelReading];
    [self finishWithError:writerError ?: VOPMakeError(VideoOverlayErrorExportFailed, @"Writing the output video failed.")
                cancelled:NO];
    return;
  }

  AVAssetWriter *writer = _writer;
  [writer finishWritingWithCompletionHandler:^{
    dispatch_async(self->_stateQueue, ^{
      if (writer.status == AVAssetWriterStatusCompleted) {
        [self finishWithError:nil cancelled:NO];
      } else if (writer.status == AVAssetWriterStatusCancelled || self.cancelled) {
        [self finishWithError:nil cancelled:YES];
      } else {
        [self finishWithError:writer.error
                                  ?: VOPMakeError(VideoOverlayErrorExportFailed, @"Finalizing the output video failed.")
                    cancelled:NO];
      }
    });
  }];
}

@end

#pragma mark - VOBurnPipeline

@implementation VOBurnPipeline

+ (dispatch_queue_t)workQueue
{
  static dispatch_queue_t queue;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    queue = dispatch_queue_create("com.rx.videooverlay.pipeline", DISPATCH_QUEUE_SERIAL);
  });
  return queue;
}

/// Maps the track into its display orientation and even-sized display rect, before any crop.
+ (CGSize)displaySizeForVideoTrack:(AVAssetTrack *)videoTrack transform:(CGAffineTransform *)outTransform
{
  // Apply preferredTransform or portrait video renders sideways with the overlay at the wrong corner.
  CGSize naturalSize = videoTrack.naturalSize;
  CGAffineTransform preferredTransform = videoTrack.preferredTransform;
  CGRect displayRect =
      CGRectApplyAffineTransform(CGRectMake(0.0, 0.0, naturalSize.width, naturalSize.height), preferredTransform);
  if (outTransform != NULL) {
    *outTransform = CGAffineTransformConcat(
        preferredTransform, CGAffineTransformMakeTranslation(-displayRect.origin.x, -displayRect.origin.y));
  }
  return CGSizeMake(VOPEvenSize(displayRect.size.width), VOPEvenSize(displayRect.size.height));
}

+ (CGSize)renderSizeForVideoTrack:(AVAssetTrack *)videoTrack cropAspectRatio:(CGFloat)cropAspectRatio
{
  CGSize renderSize = VOPCropSize([self displaySizeForVideoTrack:videoTrack transform:NULL], cropAspectRatio);
  if (!(renderSize.width > 0.0) || !(renderSize.height > 0.0)) {
    return CGSizeZero;
  }
  return renderSize;
}

+ (void)burnAsset:(AVAsset *)asset
         videoTrack:(AVAssetTrack *)videoTrack
    cropAspectRatio:(CGFloat)cropAspectRatio
         maxBitRate:(double)maxBitRate
         outputPath:(NSString *)outputPath
             drawer:(VOFrameDrawer)drawer
         completion:(VideoOverlayBurnCompletion)completion
{
  [asset loadTracksWithMediaType:AVMediaTypeAudio
               completionHandler:^(NSArray<AVAssetTrack *> *_Nullable audioTracks, NSError *_Nullable audioError) {
                 dispatch_async([self workQueue], ^{
                   // Unreadable audio fails the burn rather than silently dropping sound.
                   if (audioError != nil) {
                     completion(nil, VOPMakeError(VideoOverlayErrorInputNotReadable,
                                                  [NSString stringWithFormat:@"Cannot read audio tracks: %@",
                                                                             audioError.localizedDescription]));
                     return;
                   }
                   [self burnAsset:asset
                            videoTrack:videoTrack
                            audioTrack:audioTracks.firstObject
                       cropAspectRatio:cropAspectRatio
                            maxBitRate:maxBitRate
                            outputPath:outputPath
                                drawer:drawer
                            completion:completion];
                 });
               }];
}

+ (void)burnAsset:(AVAsset *)asset
         videoTrack:(AVAssetTrack *)videoTrack
         audioTrack:(nullable AVAssetTrack *)audioTrack
    cropAspectRatio:(CGFloat)cropAspectRatio
         maxBitRate:(double)maxBitRate
         outputPath:(NSString *)outputPath
             drawer:(VOFrameDrawer)drawer
         completion:(VideoOverlayBurnCompletion)completion
{
  CGAffineTransform correctedTransform;
  CGSize displaySize = [self displaySizeForVideoTrack:videoTrack transform:&correctedTransform];
  CGSize renderSize = [self renderSizeForVideoTrack:videoTrack cropAspectRatio:cropAspectRatio];
  if (CGSizeEqualToSize(renderSize, CGSizeZero)) {
    completion(nil, VOPMakeError(VideoOverlayErrorNoVideoTrack, @"The video track has an invalid natural size."));
    return;
  }
  // Shifting the track recentres the kept region inside the smaller renderSize.
  correctedTransform = CGAffineTransformConcat(
      correctedTransform,
      CGAffineTransformMakeTranslation(floor((renderSize.width - displaySize.width) / 2.0),
                                       floor((renderSize.height - displaySize.height) / 2.0)));

  int32_t fps = (int32_t)lround((double)videoTrack.nominalFrameRate);
  if (fps <= 0 || fps > 240) {
    fps = 30;
  }

  AVMutableVideoCompositionLayerInstruction *layerInstruction =
      [AVMutableVideoCompositionLayerInstruction videoCompositionLayerInstructionWithAssetTrack:videoTrack];
  [layerInstruction setTransform:correctedTransform atTime:kCMTimeZero];

  AVMutableVideoCompositionInstruction *instruction = [AVMutableVideoCompositionInstruction videoCompositionInstruction];
  instruction.timeRange = CMTimeRangeMake(kCMTimeZero, videoTrack.timeRange.duration);
  instruction.layerInstructions = @[ layerInstruction ];

  AVMutableVideoComposition *videoComposition = [AVMutableVideoComposition videoComposition];
  videoComposition.renderSize = renderSize;
  videoComposition.frameDuration = CMTimeMake(1, fps);
  // Keep source frame timestamps, so no frames are duplicated or dropped by fps resampling.
  videoComposition.sourceTrackIDForFrameTiming = videoTrack.trackID;
  videoComposition.instructions = @[ instruction ];

  // Pin output to BT.709 SDR; HDR sources would otherwise come out washed-out and grayish.
  videoComposition.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2;
  videoComposition.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2;
  videoComposition.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2;

  NSDictionary<NSString *, id> *videoSettings =
      VOPVideoSettings(renderSize, fps, videoTrack.estimatedDataRate, maxBitRate);

  VOBurnSession * (^makeSession)(void) = ^VOBurnSession * {
    return [[VOBurnSession alloc] initWithAsset:asset
                                     videoTrack:videoTrack
                                     audioTrack:audioTrack
                               videoComposition:videoComposition
                                         drawer:drawer
                                  videoSettings:videoSettings
                                     outputPath:outputPath];
  };

  [self runBurnWithSessionFactory:makeSession outputPath:outputPath attempt:0 completion:completion];
}

/// One attempt under a background task (avoids -11847 on backgrounding), retried once on failure.
+ (void)runBurnWithSessionFactory:(VOBurnSession * (^)(void))makeSession
                       outputPath:(NSString *)outputPath
                          attempt:(NSInteger)attempt
                       completion:(VideoOverlayBurnCompletion)completion
{
  NSError *prepareError = nil;
  if (![self prepareOutputPath:outputPath error:&prepareError]) {
    completion(nil, prepareError);
    return;
  }

  VOBurnSession *session = makeSession();

  __block UIBackgroundTaskIdentifier backgroundTaskId = UIBackgroundTaskInvalid;
  backgroundTaskId = [[UIApplication sharedApplication]
      beginBackgroundTaskWithName:@"VideoOverlayExport"
                expirationHandler:^{
                  [session cancel];
                  [[UIApplication sharedApplication] endBackgroundTask:backgroundTaskId];
                  backgroundTaskId = UIBackgroundTaskInvalid;
                }];

  [session startWithCompletion:^(NSError *_Nullable error, BOOL cancelled) {
    // Expiration runs on main; ending here on main too prevents a double end.
    dispatch_async(dispatch_get_main_queue(), ^{
      if (backgroundTaskId != UIBackgroundTaskInvalid) {
        [[UIApplication sharedApplication] endBackgroundTask:backgroundTaskId];
        backgroundTaskId = UIBackgroundTaskInvalid;
      }
    });

    dispatch_async([self workQueue], ^{
      if (error == nil && !cancelled) {
        completion(outputPath, nil);
        return;
      }
      if (cancelled) {
        completion(nil, VOPMakeError(VideoOverlayErrorExportCancelled, @"Video export was cancelled."));
        return;
      }
      if (attempt < 1) {
        [self runBurnWithSessionFactory:makeSession outputPath:outputPath attempt:attempt + 1 completion:completion];
        return;
      }

      NSMutableDictionary *userInfo = [NSMutableDictionary dictionary];
      userInfo[NSLocalizedDescriptionKey] =
          [NSString stringWithFormat:@"Video export failed: %@", error.localizedDescription ?: @"unknown error"];
      userInfo[NSUnderlyingErrorKey] = error;
      completion(nil, [NSError errorWithDomain:VideoOverlayErrorDomain
                                          code:VideoOverlayErrorExportFailed
                                      userInfo:userInfo]);
    });
  }];
}

/// Creates the parent directory and removes the old output file; never touches the source video.
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
        *outError = VOPMakeError(VideoOverlayErrorOutputNotWritable,
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
        *outError = VOPMakeError(VideoOverlayErrorOutputNotWritable,
                                 [NSString stringWithFormat:@"Cannot remove existing output file %@: %@", outputPath,
                                                            removeError.localizedDescription]);
      }
      return NO;
    }
  }

  return YES;
}

@end
