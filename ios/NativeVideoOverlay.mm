//
//  NativeVideoOverlay.mm
//  react-native-video-overlay
//
//  TurboModule (New Architecture) bridge for `NativeVideoOverlay`.
//
//  WHY NOT SWIFT: static use_frameworks! makes mixing Swift/Obj-C++ create a fragile circular header dependency.
//
//  WHY NO .h FILE: use_frameworks! would expose the Obj-C++-only codegen header as plain Obj-C.
//

#import <Foundation/Foundation.h>

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

/// Class name determines JS module name via RCT_EXPORT_MODULE(); must be VideoOverlay to match spec.
@interface VideoOverlay : NSObject <NativeVideoOverlaySpec>
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

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeVideoOverlaySpecJSI>(params);
}

@end
