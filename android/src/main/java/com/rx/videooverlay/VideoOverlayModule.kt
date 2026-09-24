package com.rx.videooverlay

import android.view.WindowManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import java.util.concurrent.Executors

/** TurboModule VideoOverlay; NativeVideoOverlaySpec is codegen-generated, already providing NAME and getName(). */
class VideoOverlayModule(
    reactContext: ReactApplicationContext,
) : NativeVideoOverlaySpec(reactContext) {

    /** Burning is heavy; runs off-thread, single-threaded to avoid concurrent burns fighting over the hardware codec. */
    private val executor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "VideoOverlayBurn").apply { isDaemon = true }
    }

    override fun burnOverlay(
        videoPath: String,
        outputPath: String,
        cuesJson: String,
        styleJson: String,
        promise: Promise,
    ) {
        executor.execute {
            try {
                promise.resolve(VideoOverlayBurner(videoPath, outputPath, cuesJson, styleJson).burn())
            } catch (e: VideoOverlayException) {
                promise.reject(e.code, e.message, e)
            } catch (t: Throwable) {
                promise.reject(ErrorCode.BURN_FAILED, t.message ?: t.toString(), t)
            }
        }
    }

    override fun burnLayers(
        videoPath: String,
        outputPath: String,
        layersJson: String,
        optionsJson: String,
        promise: Promise,
    ) {
        executor.execute {
            try {
                promise.resolve(VideoLayerBurner(videoPath, outputPath, layersJson, optionsJson).burn())
            } catch (e: VideoOverlayException) {
                promise.reject(e.code, e.message, e)
            } catch (t: Throwable) {
                promise.reject(ErrorCode.BURN_FAILED, t.message ?: t.toString(), t)
            }
        }
    }

    /** The flag lives on the activity's window, so it must change on the UI thread. */
    override fun setKeepScreenOn(enabled: Boolean) {
        val activity = reactApplicationContext.currentActivity ?: return
        activity.runOnUiThread {
            if (enabled) {
                activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } else {
                activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }
    }

    override fun invalidate() {
        executor.shutdown()
        // JS reload skips effect cleanup; turn it off or the screen stays awake forever.
        setKeepScreenOn(false)
        super.invalidate()
    }

    companion object {
        const val NAME = NativeVideoOverlaySpec.NAME
    }
}
