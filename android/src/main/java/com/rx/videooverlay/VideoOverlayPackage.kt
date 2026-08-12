package com.rx.videooverlay

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/** WARNING: regex-based autolinking scans comments too; never write the letters "cl" + "ass" here. */
class VideoOverlayPackage : BaseReactPackage() {

    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
        if (name == VideoOverlayModule.NAME) VideoOverlayModule(reactContext) else null

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
        mapOf(
            VideoOverlayModule.NAME to ReactModuleInfo(
                VideoOverlayModule.NAME,
                VideoOverlayModule::class.java.name,
                /* canOverrideExistingModule = */ false,
                /* needsEagerInit = */ false,
                /* isCxxModule = */ false,
                /* isTurboModule = */ true,
            )
        )
    }
}
