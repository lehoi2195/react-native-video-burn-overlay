package com.rx.videooverlay

import android.graphics.SurfaceTexture
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock

/** GL_TEXTURE_EXTERNAL_OES surface for decoder output; must be created after EGL makeCurrent(). */
internal class DecoderOutputSurface {

    val textureId: Int
    val surface: Surface

    private val surfaceTexture: SurfaceTexture

    // Worker thread is blocked waiting, can't run its own looper; use a dedicated HandlerThread.
    private val callbackThread = HandlerThread("VideoOverlay-frame").apply { start() }

    private val lock = ReentrantLock()
    private val frameReady = lock.newCondition()
    private var frameAvailable = false

    init {
        val textures = IntArray(1)
        GLES20.glGenTextures(1, textures, 0)
        textureId = textures[0]
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
        GLES20.glTexParameterf(
            GLES11Ext.GL_TEXTURE_EXTERNAL_OES,
            GLES20.GL_TEXTURE_MIN_FILTER,
            GLES20.GL_LINEAR.toFloat(),
        )
        GLES20.glTexParameterf(
            GLES11Ext.GL_TEXTURE_EXTERNAL_OES,
            GLES20.GL_TEXTURE_MAG_FILTER,
            GLES20.GL_LINEAR.toFloat(),
        )
        GLES20.glTexParameteri(
            GLES11Ext.GL_TEXTURE_EXTERNAL_OES,
            GLES20.GL_TEXTURE_WRAP_S,
            GLES20.GL_CLAMP_TO_EDGE,
        )
        GLES20.glTexParameteri(
            GLES11Ext.GL_TEXTURE_EXTERNAL_OES,
            GLES20.GL_TEXTURE_WRAP_T,
            GLES20.GL_CLAMP_TO_EDGE,
        )

        surfaceTexture = SurfaceTexture(textureId)
        surfaceTexture.setOnFrameAvailableListener(
            {
                lock.lock()
                try {
                    frameAvailable = true
                    frameReady.signalAll()
                } finally {
                    lock.unlock()
                }
            },
            Handler(callbackThread.looper),
        )
        surface = Surface(surfaceTexture)
    }

    /** Waits for a decoder frame, updates texture; must run on the EGL context's thread. */
    fun awaitNewImage(timeoutMs: Long = 5_000) {
        lock.lock()
        try {
            var remaining = TimeUnit.MILLISECONDS.toNanos(timeoutMs)
            while (!frameAvailable) {
                if (remaining <= 0) {
                    throw VideoOverlayException(
                        ErrorCode.BURN_FAILED,
                        "Timed out after $timeoutMs ms without receiving any frame from the decoder",
                    )
                }
                remaining = frameReady.awaitNanos(remaining)
            }
            frameAvailable = false
        } finally {
            lock.unlock()
        }
        surfaceTexture.updateTexImage()
    }

    fun getTransformMatrix(matrix: FloatArray) = surfaceTexture.getTransformMatrix(matrix)

    fun release() {
        surface.release()
        surfaceTexture.release()
        callbackThread.quitSafely()
    }
}
