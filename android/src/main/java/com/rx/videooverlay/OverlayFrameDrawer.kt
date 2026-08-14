package com.rx.videooverlay

/** Draws one decoded frame's overlay content; implemented by FrameRenderer and LayerRenderer. */
internal interface OverlayFrameDrawer {
    fun drawFrame(stMatrix: FloatArray, ptsUs: Long, oesTextureId: Int)
    fun release()
}
