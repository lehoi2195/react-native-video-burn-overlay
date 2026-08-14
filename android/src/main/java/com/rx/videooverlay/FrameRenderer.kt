package com.rx.videooverlay

import android.graphics.BitmapFactory
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.GLUtils
import android.opengl.Matrix
import android.util.Log
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

/** Draws video + overlay in output-frame space; positions the overlay, OverlayBitmapRenderer only draws content. */
internal class FrameRenderer(
    private val outputWidth: Int,
    private val outputHeight: Int,
    rotationDegrees: Int,
    private val overlay: OverlayBitmapRenderer,
    /** Alpha multiplier for both text and image overlay draws, via uOpacity in FRAGMENT_SHADER_2D. */
    private val opacity: Float,
    private val cues: List<OverlayCue>,
    /** Video quad scale in output space; >1 overflows the viewport, which centre-crops it. */
    videoScaleX: Float = 1f,
    videoScaleY: Float = 1f,
) : OverlayFrameDrawer {

    /** Active-cue lookup now lives here, not in the transcode loop, to satisfy OverlayFrameDrawer. */
    private val timeline = CueTimeline(cues)

    private val videoProgram = buildProgram(VERTEX_SHADER, FRAGMENT_SHADER_OES)
    private val overlayProgram = buildProgram(VERTEX_SHADER, FRAGMENT_SHADER_2D)

    private val videoVertices: FloatBuffer = floatBufferOf(
        // x, y, u, v — quad covering NDC, drawn with TRIANGLE_STRIP
        -1f, -1f, 0f, 0f,
        1f, -1f, 1f, 0f,
        -1f, 1f, 0f, 1f,
        1f, 1f, 1f, 1f,
    )

    private val overlayVertices: FloatBuffer
    private val overlayTextureId: Int

    /** Cache: cue index currently uploaded; redraws only on cue change since frames vastly outnumber cues. */
    private var uploadedCueIndex = Int.MIN_VALUE

    /** Dedicated texture + quad for image cues, since image size varies per cue. */
    private val imageTextureId: Int
    private var imageVertices: FloatBuffer? = null

    /** Cache keyed by image path, not cueIndex, since consecutive cues often share the same file. */
    private var uploadedImagePath: String? = null

    /** Rotate then scale: scale must act in output axes, so it left-multiplies the rotation. */
    private val mvpMatrix = FloatArray(16).also { mvp ->
        val rotate = FloatArray(16).also {
            Matrix.setRotateM(it, 0, -rotationDegrees.toFloat(), 0f, 0f, 1f)
        }
        val scale = FloatArray(16).also {
            Matrix.setIdentityM(it, 0)
            Matrix.scaleM(it, 0, videoScaleX, videoScaleY, 1f)
        }
        Matrix.multiplyMM(mvp, 0, scale, 0, rotate, 0)
    }

    private val identityMatrix = FloatArray(16).also { Matrix.setIdentityM(it, 0) }

    init {
        val bounds = anchorBounds(overlay.boxWidth, overlay.boxHeight, overlay.marginPx, overlay.position)
        overlayVertices = buildQuadVertices(bounds)

        overlayTextureId = createTexture2D()
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, overlayTextureId)
        // Allocate storage once for the shared bitmap; later uploads use texSubImage2D, no re-allocation.
        GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, overlay.bitmap, 0)

        // Image texture storage is re-allocated per image change since sizes differ; only id created here.
        imageTextureId = createTexture2D()
    }

    /** Computes pixel edges for a content block; Coordinate positions ignore marginPx entirely, unlike Preset. */
    private fun anchorBounds(
        contentWidth: Int,
        contentHeight: Int,
        marginPx: Int,
        position: OverlayPosition,
    ): FloatArray {
        if (position is OverlayPosition.Coordinate) {
            // Custom coordinates ignore marginPx entirely — x/y ARE the exact placement.
            val availableX = (outputWidth - contentWidth).toFloat().coerceAtLeast(0f)
            val availableY = (outputHeight - contentHeight).toFloat().coerceAtLeast(0f)
            val left = availableX * position.x
            val bottom = availableY * (1f - position.y)
            return floatArrayOf(left, bottom, left + contentWidth, bottom + contentHeight)
        }

        val preset = position as OverlayPosition.Preset
        val left: Float
        val right: Float
        when (preset.horizontal) {
            HorizontalAlign.RIGHT -> {
                right = outputWidth - marginPx.toFloat()
                left = right - contentWidth
            }
            HorizontalAlign.CENTER -> {
                left = (outputWidth - contentWidth) / 2f
                right = left + contentWidth
            }
            HorizontalAlign.LEFT -> {
                left = marginPx.toFloat()
                right = left + contentWidth
            }
        }

        val bottom: Float
        val top: Float
        when (preset.vertical) {
            VerticalAlign.TOP -> {
                top = outputHeight - marginPx.toFloat()
                bottom = top - contentHeight
            }
            VerticalAlign.CENTER -> {
                bottom = (outputHeight - contentHeight) / 2f
                top = bottom + contentHeight
            }
            VerticalAlign.BOTTOM -> {
                bottom = marginPx.toFloat()
                top = bottom + contentHeight
            }
        }

        return floatArrayOf(left, bottom, right, top)
    }

    /** [bounds] = [left, bottom, right, top] in pixels (see [anchorBounds]). */
    private fun buildQuadVertices(bounds: FloatArray): FloatBuffer {
        val left = bounds[0]
        val bottom = bounds[1]
        val right = bounds[2]
        val top = bounds[3]
        // Bitmap row 0 is top but texture v=0 is bottom, so v must be flipped.
        return floatBufferOf(
            ndcX(left), ndcY(bottom), 0f, 1f,
            ndcX(right), ndcY(bottom), 1f, 1f,
            ndcX(left), ndcY(top), 0f, 0f,
            ndcX(right), ndcY(top), 1f, 0f,
        )
    }

    private fun createTexture2D(): Int {
        val textures = IntArray(1)
        GLES20.glGenTextures(1, textures, 0)
        val textureId = textures[0]
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textureId)
        GLES20.glTexParameterf(
            GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR.toFloat()
        )
        GLES20.glTexParameterf(
            GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR.toFloat()
        )
        GLES20.glTexParameteri(
            GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE
        )
        GLES20.glTexParameteri(
            GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE
        )
        return textureId
    }

    /** @param stMatrix texture coordinate transform matrix from SurfaceTexture (handles driver's flip / crop). */
    override fun drawFrame(stMatrix: FloatArray, ptsUs: Long, oesTextureId: Int) {
        val cueIndex = timeline.indexAt(ptsUs)
        val cue = cues.getOrNull(cueIndex)
        GLES20.glViewport(0, 0, outputWidth, outputHeight)
        GLES20.glDisable(GLES20.GL_BLEND)

        GLES20.glUseProgram(videoProgram)
        bindMatrices(videoProgram, mvpMatrix, stMatrix)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oesTextureId)
        GLES20.glUniform1i(GLES20.glGetUniformLocation(videoProgram, "sTexture"), 0)
        drawQuad(videoProgram, videoVertices)

        if (cue == null) return

        // imagePath takes priority over lines; an empty cue (neither set) draws nothing.
        val imagePath = cue.imagePath
        if (imagePath != null) {
            drawImageOverlay(imagePath)
        } else if (cue.lines.isNotEmpty()) {
            drawTextOverlay(cueIndex, cue)
        }
    }

    private fun drawTextOverlay(cueIndex: Int, cue: OverlayCue) {
        ensureOverlayTexture(cueIndex, cue)

        // The Canvas-drawn bitmap is premultiplied alpha -> use GL_ONE, not GL_SRC_ALPHA.
        GLES20.glEnable(GLES20.GL_BLEND)
        GLES20.glBlendFunc(GLES20.GL_ONE, GLES20.GL_ONE_MINUS_SRC_ALPHA)
        GLES20.glUseProgram(overlayProgram)
        // The overlay is drawn in output-frame space, so the rotation matrix does not apply.
        bindMatrices(overlayProgram, identityMatrix, identityMatrix)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, overlayTextureId)
        GLES20.glUniform1i(GLES20.glGetUniformLocation(overlayProgram, "sTexture"), 0)
        GLES20.glUniform1f(GLES20.glGetUniformLocation(overlayProgram, "uOpacity"), opacity)
        drawQuad(overlayProgram, overlayVertices)
        GLES20.glDisable(GLES20.GL_BLEND)
    }

    private fun drawImageOverlay(imagePath: String) {
        val vertices = imageVertices.takeIf { ensureImageTexture(imagePath) } ?: return

        // BitmapFactory ARGB_8888 defaults to premultiplied alpha like Canvas text, so reuses the same blend.
        GLES20.glEnable(GLES20.GL_BLEND)
        GLES20.glBlendFunc(GLES20.GL_ONE, GLES20.GL_ONE_MINUS_SRC_ALPHA)
        GLES20.glUseProgram(overlayProgram)
        bindMatrices(overlayProgram, identityMatrix, identityMatrix)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, imageTextureId)
        GLES20.glUniform1i(GLES20.glGetUniformLocation(overlayProgram, "sTexture"), 0)
        GLES20.glUniform1f(GLES20.glGetUniformLocation(overlayProgram, "uOpacity"), opacity)
        drawQuad(overlayProgram, vertices)
        GLES20.glDisable(GLES20.GL_BLEND)
    }

    /** Loads image texture, cached by path; returns true if ready to draw. */
    private fun ensureImageTexture(imagePath: String): Boolean {
        if (imagePath == uploadedImagePath) return imageVertices != null
        uploadedImagePath = imagePath

        val bitmap = BitmapFactory.decodeFile(imagePath)
        if (bitmap == null) {
            Log.w(TAG, "Failed to decode overlay image, skipping cue: $imagePath")
            imageVertices = null
            return false
        }

        try {
            // Quad uses the image's original size; JS is responsible for pre-scaling before passing it down.
            val bounds = anchorBounds(bitmap.width, bitmap.height, overlay.marginPx, overlay.position)
            imageVertices = buildQuadVertices(bounds)
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, imageTextureId)
            // Image size varies per cue, so use texImage2D (re-allocates), unlike fixed-size text's texSubImage2D.
            GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bitmap, 0)
        } finally {
            bitmap.recycle()
        }
        return true
    }

    private fun ensureOverlayTexture(cueIndex: Int, cue: OverlayCue) {
        if (cueIndex == uploadedCueIndex) return // still the same cue -> reuse the existing texture
        val bitmap = overlay.render(cue)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, overlayTextureId)
        GLUtils.texSubImage2D(GLES20.GL_TEXTURE_2D, 0, 0, 0, bitmap)
        uploadedCueIndex = cueIndex
    }

    private fun bindMatrices(program: Int, mvp: FloatArray, st: FloatArray) {
        GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(program, "uMvp"), 1, false, mvp, 0)
        GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(program, "uSt"), 1, false, st, 0)
    }

    private fun drawQuad(program: Int, vertices: FloatBuffer) {
        val position = GLES20.glGetAttribLocation(program, "aPosition")
        val texCoord = GLES20.glGetAttribLocation(program, "aTexCoord")

        vertices.position(0)
        GLES20.glVertexAttribPointer(position, 2, GLES20.GL_FLOAT, false, STRIDE_BYTES, vertices)
        GLES20.glEnableVertexAttribArray(position)

        vertices.position(2)
        GLES20.glVertexAttribPointer(texCoord, 2, GLES20.GL_FLOAT, false, STRIDE_BYTES, vertices)
        GLES20.glEnableVertexAttribArray(texCoord)

        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)

        GLES20.glDisableVertexAttribArray(position)
        GLES20.glDisableVertexAttribArray(texCoord)
    }

    override fun release() {
        GLES20.glDeleteTextures(1, intArrayOf(overlayTextureId), 0)
        GLES20.glDeleteTextures(1, intArrayOf(imageTextureId), 0)
        GLES20.glDeleteProgram(videoProgram)
        GLES20.glDeleteProgram(overlayProgram)
        overlay.release()
    }

    private fun ndcX(pixels: Float) = pixels / outputWidth * 2f - 1f

    private fun ndcY(pixels: Float) = pixels / outputHeight * 2f - 1f

    private companion object {
        const val TAG = "VideoOverlayFrameRenderer"
        const val STRIDE_BYTES = 4 * 4

        val VERTEX_SHADER = """
            uniform mat4 uMvp;
            uniform mat4 uSt;
            attribute vec4 aPosition;
            attribute vec4 aTexCoord;
            varying vec2 vTexCoord;
            void main() {
              gl_Position = uMvp * aPosition;
              vTexCoord = (uSt * aTexCoord).xy;
            }
        """.trimIndent()

        val FRAGMENT_SHADER_OES = """
            #extension GL_OES_EGL_image_external : require
            precision mediump float;
            varying vec2 vTexCoord;
            uniform samplerExternalOES sTexture;
            void main() {
              gl_FragColor = texture2D(sTexture, vTexCoord);
            }
        """.trimIndent()

        val FRAGMENT_SHADER_2D = """
            precision mediump float;
            varying vec2 vTexCoord;
            uniform sampler2D sTexture;
            uniform float uOpacity;
            void main() {
              // Premultiplied alpha means scaling RGBA by uOpacity gives a clean fade, no color fringing.
              gl_FragColor = texture2D(sTexture, vTexCoord) * uOpacity;
            }
        """.trimIndent()

        fun floatBufferOf(vararg values: Float): FloatBuffer =
            ByteBuffer.allocateDirect(values.size * 4)
                .order(ByteOrder.nativeOrder())
                .asFloatBuffer()
                .apply {
                    put(values)
                    position(0)
                }

        fun buildProgram(vertexSource: String, fragmentSource: String): Int {
            val vertexShader = compileShader(GLES20.GL_VERTEX_SHADER, vertexSource)
            val fragmentShader = compileShader(GLES20.GL_FRAGMENT_SHADER, fragmentSource)
            val program = GLES20.glCreateProgram()
            GLES20.glAttachShader(program, vertexShader)
            GLES20.glAttachShader(program, fragmentShader)
            GLES20.glLinkProgram(program)

            val status = IntArray(1)
            GLES20.glGetProgramiv(program, GLES20.GL_LINK_STATUS, status, 0)
            if (status[0] != GLES20.GL_TRUE) {
                val log = GLES20.glGetProgramInfoLog(program)
                GLES20.glDeleteProgram(program)
                throw VideoOverlayException(ErrorCode.BURN_FAILED, "Failed to link GL program: $log")
            }
            // Shader objects are already referenced by the program; delete them to avoid a leak.
            GLES20.glDeleteShader(vertexShader)
            GLES20.glDeleteShader(fragmentShader)
            return program
        }

        fun compileShader(type: Int, source: String): Int {
            val shader = GLES20.glCreateShader(type)
            GLES20.glShaderSource(shader, source)
            GLES20.glCompileShader(shader)
            val status = IntArray(1)
            GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, status, 0)
            if (status[0] != GLES20.GL_TRUE) {
                val log = GLES20.glGetShaderInfoLog(shader)
                GLES20.glDeleteShader(shader)
                throw VideoOverlayException(ErrorCode.BURN_FAILED, "Failed to compile shader: $log")
            }
            return shader
        }
    }
}
