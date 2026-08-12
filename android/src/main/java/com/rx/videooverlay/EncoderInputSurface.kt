package com.rx.videooverlay

import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
import android.opengl.EGLSurface
import android.view.Surface

/** EGL surface on encoder's input Surface; GL draws go straight in, no CPU copy. */
internal class EncoderInputSurface(surface: Surface) {

    private var display: EGLDisplay = EGL14.EGL_NO_DISPLAY
    private var context: EGLContext = EGL14.EGL_NO_CONTEXT
    private var eglSurface: EGLSurface = EGL14.EGL_NO_SURFACE

    init {
        display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        if (display === EGL14.EGL_NO_DISPLAY) fail("eglGetDisplay")

        val version = IntArray(2)
        if (!EGL14.eglInitialize(display, version, 0, version, 1)) fail("eglInitialize")

        val configAttribs = intArrayOf(
            EGL14.EGL_RED_SIZE, 8,
            EGL14.EGL_GREEN_SIZE, 8,
            EGL14.EGL_BLUE_SIZE, 8,
            EGL14.EGL_ALPHA_SIZE, 8,
            EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
            // Required for MediaCodec-consumed surfaces; without it some GPUs pick an unwritable config.
            EGL_RECORDABLE_ANDROID, 1,
            EGL14.EGL_NONE,
        )
        val configs = arrayOfNulls<EGLConfig>(1)
        val numConfigs = IntArray(1)
        if (!EGL14.eglChooseConfig(display, configAttribs, 0, configs, 0, 1, numConfigs, 0) ||
            numConfigs[0] <= 0
        ) {
            fail("eglChooseConfig")
        }

        context = EGL14.eglCreateContext(
            display,
            configs[0],
            EGL14.EGL_NO_CONTEXT,
            intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE),
            0,
        )
        if (context === EGL14.EGL_NO_CONTEXT) fail("eglCreateContext")

        eglSurface = EGL14.eglCreateWindowSurface(
            display,
            configs[0],
            surface,
            intArrayOf(EGL14.EGL_NONE),
            0,
        )
        if (eglSurface === EGL14.EGL_NO_SURFACE) fail("eglCreateWindowSurface")
    }

    fun makeCurrent() {
        if (!EGL14.eglMakeCurrent(display, eglSurface, eglSurface, context)) fail("eglMakeCurrent")
    }

    /** Sets the frame's timestamp; MediaCodec uses it as output presentation time, preserving the timeline. */
    fun setPresentationTime(nanoseconds: Long) {
        EGLExt.eglPresentationTimeANDROID(display, eglSurface, nanoseconds)
    }

    /** Pushes the just-drawn frame to the encoder. */
    fun swapBuffers(): Boolean = EGL14.eglSwapBuffers(display, eglSurface)

    fun release() {
        if (display !== EGL14.EGL_NO_DISPLAY) {
            EGL14.eglMakeCurrent(
                display,
                EGL14.EGL_NO_SURFACE,
                EGL14.EGL_NO_SURFACE,
                EGL14.EGL_NO_CONTEXT,
            )
            if (eglSurface !== EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(display, eglSurface)
            if (context !== EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(display, context)
            EGL14.eglReleaseThread()
            EGL14.eglTerminate(display)
        }
        display = EGL14.EGL_NO_DISPLAY
        context = EGL14.EGL_NO_CONTEXT
        eglSurface = EGL14.EGL_NO_SURFACE
    }

    private fun fail(step: String): Nothing = throw VideoOverlayException(
        ErrorCode.BURN_FAILED,
        "$step failed (EGL error 0x${Integer.toHexString(EGL14.eglGetError())})",
    )

    private companion object {
        /** EGL_RECORDABLE_ANDROID — not present in EGL14, must be declared manually. */
        const val EGL_RECORDABLE_ANDROID = 0x3142
    }
}
