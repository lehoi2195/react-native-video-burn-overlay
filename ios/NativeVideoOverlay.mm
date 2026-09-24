// No Swift or .h: use_frameworks! breaks Swift/Obj-C++ mixing and exposes codegen headers as Obj-C.

#import <Foundation/Foundation.h>
#import <React/RCTInvalidating.h>
#import <UIKit/UIKit.h>

// Codegen header path differs by RN version/pod; try each form, don't depend on just one.
#if __has_include(<VideoOverlaySpec/VideoOverlaySpec.h>)
#import <VideoOverlaySpec/VideoOverlaySpec.h>
#elif __has_include(<RNVideoOverlaySpec/RNVideoOverlaySpec.h>)
#import <RNVideoOverlaySpec/RNVideoOverlaySpec.h>
#elif __has_include(<ReactCodegen/RNVideoOverlaySpec/RNVideoOverlaySpec.h>)
#import <ReactCodegen/RNVideoOverlaySpec/RNVideoOverlaySpec.h>
#elif __has_include(<ReactCodegen/RNVideoOverlaySpec.h>)
#import <ReactCodegen/RNVideoOverlaySpec.h>
#else
#import "RNVideoOverlaySpec.h"
#endif

#import "VideoOverlayBurner.h"
#import "VideoLayerBurner.h"

/// Class name determines JS module name via RCT_EXPORT_MODULE(); must be VideoOverlay to match spec.
@interface VideoOverlay : NSObject <NativeVideoOverlaySpec, RCTInvalidating>
@end

@implementation VideoOverlay

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (void)burnOverlay:(NSString *)videoPath
         outputPath:(NSString *)outputPath
           cuesJson:(NSString *)cuesJson
          styleJson:(NSString *)styleJson
            resolve:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject
{
  // VideoOverlayBurner switches to a background queue itself, so this call never blocks the JS thread.
  [VideoOverlayBurner burnOverlayWithVideoPath:videoPath
                                    outputPath:outputPath
                                      cuesJson:cuesJson
                                     styleJson:styleJson
                                    completion:^(NSString *_Nullable resultPath, NSError *_Nullable error) {
                                      if (error != nil) {
                                        NSString *code =
                                            [NSString stringWithFormat:@"E_VIDEO_OVERLAY_%ld", (long)error.code];
                                        reject(code, error.localizedDescription, error);
                                        return;
                                      }
                                      resolve(resultPath);
                                    }];
}

- (void)burnLayers:(NSString *)videoPath
        outputPath:(NSString *)outputPath
        layersJson:(NSString *)layersJson
       optionsJson:(NSString *)optionsJson
           resolve:(RCTPromiseResolveBlock)resolve
            reject:(RCTPromiseRejectBlock)reject
{
  // VideoLayerBurner switches to a background queue itself, mirroring burnOverlay.
  [VideoLayerBurner burnLayersWithVideoPath:videoPath
                                  outputPath:outputPath
                                  layersJson:layersJson
                                 optionsJson:optionsJson
                                  completion:^(NSString *_Nullable resultPath, NSError *_Nullable error) {
                                    if (error != nil) {
                                      NSString *code =
                                          [NSString stringWithFormat:@"E_VIDEO_OVERLAY_%ld", (long)error.code];
                                      reject(code, error.localizedDescription, error);
                                      return;
                                    }
                                    resolve(resultPath);
                                  }];
}

- (void)setKeepScreenOn:(BOOL)enabled
{
  // idleTimerDisabled is a UIKit property, so it must change on the main queue.
  dispatch_async(dispatch_get_main_queue(), ^{
    [UIApplication sharedApplication].idleTimerDisabled = enabled;
  });
}

- (void)invalidate
{
  // JS reload skips effect cleanup; turn it off or the screen stays awake forever.
  [self setKeepScreenOn:NO];
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeVideoOverlaySpecJSI>(params);
}

@end
