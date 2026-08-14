package com.rx.videooverlay

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.GLUtils
import android.opengl.Matrix
import android.util.Log
import java.nio.FloatBuffer
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/** Draws N layers per frame; textures prepare once at init, not per-frame. */
internal class LayerRenderer(
    private val outputWidth: Int,
    private val outputHeight: Int,
    rotationDegrees: Int,
    layers: List<OverlayLayerConfig>,
    durationUs: Long,
    videoScaleX: Float = 1f,
    videoScaleY: Float = 1f,
) : OverlayFrameDrawer {

    private val videoProgram = GlUtil.buildProgram(VERTEX_SHADER, FRAGMENT_SHADER_OES)
    private val overlayProgram = GlUtil.buildProgram(VERTEX_SHADER, FRAGMENT_SHADER_2D)

    private val videoVertices: FloatBuffer = GlUtil.floatBufferOf(
        -1f, -1f, 0f, 0f,
        1f, -1f, 1f, 0f,
        -1f, 1f, 0f, 1f,
        1f, 1f, 1f, 1f,
    )

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

    /** Prepared once at init: texture + vertex buffers per entry (N buffers when tiled). */
    private val drawEntries: List<LayerDrawEntry> = layers.mapNotNull { prepareLayer(it, durationUs) }

    override fun drawFrame(stMatrix: FloatArray, ptsUs: Long, oesTextureId: Int) {
        GLES20.glViewport(0, 0, outputWidth, outputHeight)
        GLES20.glDisable(GLES20.GL_BLEND)

        GLES20.glUseProgram(videoProgram)
        GlUtil.bindMatrices(videoProgram, mvpMatrix, stMatrix)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oesTextureId)
        GLES20.glUniform1i(GLES20.glGetUniformLocation(videoProgram, "sTexture"), 0)
        GlUtil.drawQuad(videoProgram, videoVertices)

        if (drawEntries.isEmpty()) return

        // Premultiplied alpha bitmaps -> GL_ONE, not GL_SRC_ALPHA, matching FrameRenderer.
        GLES20.glEnable(GLES20.GL_BLEND)
        GLES20.glBlendFunc(GLES20.GL_ONE, GLES20.GL_ONE_MINUS_SRC_ALPHA)
        GLES20.glUseProgram(overlayProgram)
        GlUtil.bindMatrices(overlayProgram, identityMatrix, identityMatrix)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glUniform1i(GLES20.glGetUniformLocation(overlayProgram, "sTexture"), 0)
        val opacityLoc = GLES20.glGetUniformLocation(overlayProgram, "uOpacity")

        for (entry in drawEntries) {
            if (ptsUs < entry.startUs || ptsUs >= entry.endUs) continue
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, entry.textureId)
            GLES20.glUniform1f(opacityLoc, entry.opacity)
            for (vertices in entry.vertices) {
                GlUtil.drawQuad(overlayProgram, vertices)
            }
        }
        GLES20.glDisable(GLES20.GL_BLEND)
    }

    override fun release() {
        val textureIds = drawEntries.map { it.textureId }.distinct().toIntArray()
        if (textureIds.isNotEmpty()) GLES20.glDeleteTextures(textureIds.size, textureIds, 0)
        GLES20.glDeleteProgram(videoProgram)
        GLES20.glDeleteProgram(overlayProgram)
    }

    /** Decodes/rasterizes once, uploads the texture once, and precomputes every draw-call's vertices. */
    private fun prepareLayer(config: OverlayLayerConfig, durationUs: Long): LayerDrawEntry? {
        val tile = config.tile
        val bitmap: Bitmap
        val boxWidth: Float
        val boxHeight: Float
        when (config) {
            is ImageLayerConfig -> {
                val decoded = decodeImage(config.source) ?: return null
                bitmap = decoded
                val (w, h) = resolveImageSize(config, decoded)
                val sizeScale = tile?.scale ?: 1f
                boxWidth = w * sizeScale
                boxHeight = h * sizeScale
            }
            is TextLayerConfig -> {
                val sizeScale = tile?.scale ?: 1f
                bitmap = LayerTextBitmapFactory.render(outputWidth, outputHeight, config, sizeScale) ?: return null
                // sizeScale is already baked into the rasterized font size, box matches it exactly.
                boxWidth = bitmap.width.toFloat()
                boxHeight = bitmap.height.toFloat()
            }
        }

        val textureId = GlUtil.createTexture2D()
        try {
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textureId)
            GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bitmap, 0)
        } finally {
            bitmap.recycle()
        }

        val vertices = if (tile != null) {
            val (anchorX, anchorY) = anchorPoint(tile.anchor)
            val combinedAngle = config.rotation + tile.angle
            tileOrigins(anchorX, anchorY, tile).map { (cx, cy) ->
                buildRotatedQuadVertices(cx, cy, boxWidth, boxHeight, combinedAngle)
            }
        } else {
            val bounds = anchorBounds(boxWidth, boxHeight, config.marginRatio, config.position)
            val centerX = (bounds[0] + bounds[2]) / 2f
            val centerY = (bounds[1] + bounds[3]) / 2f
            listOf(buildRotatedQuadVertices(centerX, centerY, boxWidth, boxHeight, config.rotation))
        }

        return LayerDrawEntry(
            textureId = textureId,
            vertices = vertices,
            opacity = config.opacity,
            startUs = config.startUs,
            // Unreadable duration must mean unbounded, not zero, or the layer never draws.
            endUs = config.endUs ?: durationUs.takeIf { it > 0L } ?: Long.MAX_VALUE,
        )
    }

    private fun decodeImage(path: String): Bitmap? {
        val bitmap = BitmapFactory.decodeFile(path)
        if (bitmap == null) Log.w(TAG, "Failed to decode layer image, skipping: $path")
        return bitmap
    }

    private fun resolveImageSize(config: ImageLayerConfig, bitmap: Bitmap): Pair<Float, Float> {
        val bw = bitmap.width.toFloat()
        val bh = bitmap.height.toFloat()
        return when {
            config.width != null && config.height != null -> config.width to config.height
            config.width != null -> config.width to (config.width * bh / bw)
            config.height != null -> (config.height * bw / bh) to config.height
            else -> bw to bh
        }
    }

    /** Same anchoring as FrameRenderer.anchorBounds, adapted to a per-layer marginRatio. */
    private fun anchorBounds(
        contentWidth: Float,
        contentHeight: Float,
        marginRatio: Float,
        position: OverlayPosition,
    ): FloatArray {
        val marginPx = outputWidth * marginRatio
        if (position is OverlayPosition.Coordinate) {
            val availableX = (outputWidth - contentWidth).coerceAtLeast(0f)
            val availableY = (outputHeight - contentHeight).coerceAtLeast(0f)
            val left = availableX * position.x
            val bottom = availableY * (1f - position.y)
            return floatArrayOf(left, bottom, left + contentWidth, bottom + contentHeight)
        }

        val preset = position as OverlayPosition.Preset
        val left: Float
        val right: Float
        when (preset.horizontal) {
            HorizontalAlign.RIGHT -> {
                right = outputWidth - marginPx
                left = right - contentWidth
            }
            HorizontalAlign.CENTER -> {
                left = (outputWidth - contentWidth) / 2f
                right = left + contentWidth
            }
            HorizontalAlign.LEFT -> {
                left = marginPx
                right = left + contentWidth
            }
        }

        val bottom: Float
        val top: Float
        when (preset.vertical) {
            VerticalAlign.TOP -> {
                top = outputHeight - marginPx
                bottom = top - contentHeight
            }
            VerticalAlign.CENTER -> {
                bottom = (outputHeight - contentHeight) / 2f
                top = bottom + contentHeight
            }
            VerticalAlign.BOTTOM -> {
                bottom = marginPx
                top = bottom + contentHeight
            }
        }
        return floatArrayOf(left, bottom, right, top)
    }

    /** Single anchor point for a tile grid's origin; ignores marginRatio entirely, per spec. */
    private fun anchorPoint(position: OverlayPosition): Pair<Float, Float> {
        return when (position) {
            is OverlayPosition.Coordinate -> position.x * outputWidth to (1f - position.y) * outputHeight
            is OverlayPosition.Preset -> {
                val x = when (position.horizontal) {
                    HorizontalAlign.LEFT -> 0f
                    HorizontalAlign.CENTER -> outputWidth / 2f
                    HorizontalAlign.RIGHT -> outputWidth.toFloat()
                }
                val y = when (position.vertical) {
                    VerticalAlign.BOTTOM -> 0f
                    VerticalAlign.CENTER -> outputHeight / 2f
                    VerticalAlign.TOP -> outputHeight.toFloat()
                }
                x to y
            }
        }
    }

    /** Builds tile points covering the frame; widens spacing and warns past the 400-tile cap. */
    private fun tileOrigins(anchorX: Float, anchorY: Float, tile: TileLayerConfig): List<Pair<Float, Float>> {
        var stepX = (tile.spacingX * outputWidth).coerceAtLeast(1f)
        var stepY = (tile.spacingY * outputWidth).coerceAtLeast(1f)
        val angleIsZero = abs(tile.angle) < ANGLE_EPSILON_DEG
        val corners = listOf(
            0f to 0f, outputWidth.toFloat() to 0f, 0f to outputHeight.toFloat(), outputWidth.toFloat() to outputHeight.toFloat(),
        )
        val maxDist = corners.maxOf { (cx, cy) -> hypot((cx - anchorX).toDouble(), (cy - anchorY).toDouble()).toFloat() }

        var counts = edgeStepCounts(stepX, stepY, angleIsZero, anchorX, anchorY, maxDist)
        var count = (counts[0] + counts[1] + 1) * (counts[2] + counts[3] + 1)

        if (count > MAX_TILES) {
            Log.w(TAG, "Tile count $count exceeds cap $MAX_TILES, widening spacing")
        }

        // Widen only the busier axis: scaling both keeps their ratio, so lopsided spacing never converges.
        var passes = 0
        while (count > MAX_TILES && passes < MAX_WIDEN_PASSES) {
            val widen = max(sqrt(count.toFloat() / MAX_TILES), MIN_WIDEN_FACTOR)
            val totalX = counts[0] + counts[1]
            val totalY = counts[2] + counts[3]
            if (totalX >= totalY) stepX *= widen else stepY *= widen
            counts = edgeStepCounts(stepX, stepY, angleIsZero, anchorX, anchorY, maxDist)
            count = (counts[0] + counts[1] + 1) * (counts[2] + counts[3] + 1)
            passes++
        }
        val stepsLeft = counts[0]
        val stepsRight = counts[1]
        val stepsDown = counts[2]
        val stepsUp = counts[3]

        val rad = Math.toRadians(-tile.angle.toDouble())
        val cos = cos(rad).toFloat()
        val sin = sin(rad).toFloat()

        val points = ArrayList<Pair<Float, Float>>(min(count, MAX_TILES))
        outer@ for (j in -stepsDown..stepsUp) {
            val rowOffset = if (tile.stagger && floorMod(j, 2) == 1) stepX / 2f else 0f
            for (i in -stepsLeft..stepsRight) {
                if (points.size >= MAX_TILES) break@outer
                val lx = i * stepX + rowOffset
                val ly = j * stepY
                val rx = lx * cos - ly * sin
                val ry = lx * sin + ly * cos
                points.add((anchorX + rx) to (anchorY + ry))
            }
        }
        return points
    }

    /** Tight per-edge counts when angle==0; symmetric corner-radius counts otherwise. */
    private fun edgeStepCounts(
        stepX: Float,
        stepY: Float,
        angleIsZero: Boolean,
        anchorX: Float,
        anchorY: Float,
        maxDist: Float,
    ): IntArray {
        if (angleIsZero) {
            val right = ceil((outputWidth - anchorX) / stepX).toInt() + 1
            val left = ceil(anchorX / stepX).toInt() + 1
            val up = ceil((outputHeight - anchorY) / stepY).toInt() + 1
            val down = ceil(anchorY / stepY).toInt() + 1
            return intArrayOf(left, right, down, up)
        }
        // Rotation can pull any tile toward any corner; use one symmetric radius.
        val radius = maxDist + max(stepX, stepY)
        val halfX = ceil(radius / stepX).toInt()
        val halfY = ceil(radius / stepY).toInt()
        return intArrayOf(halfX, halfX, halfY, halfY)
    }

    private fun floorMod(a: Int, b: Int) = ((a % b) + b) % b

    /** Rotates a box in isotropic pixel space, then projects to NDC last. */
    private fun buildRotatedQuadVertices(
        centerX: Float,
        centerY: Float,
        width: Float,
        height: Float,
        rotationDeg: Float,
    ): FloatBuffer {
        // Negate: the CCW math formula reads as clockwise since this local Y axis points up.
        val rad = Math.toRadians(-rotationDeg.toDouble())
        val cos = cos(rad).toFloat()
        val sin = sin(rad).toFloat()
        val hw = width / 2f
        val hh = height / 2f

        val values = FloatArray(UNIT_CORNERS.size * 4)
        UNIT_CORNERS.forEachIndexed { i, corner ->
            val lx = corner.lx * hw
            val ly = corner.ly * hh
            val rx = lx * cos - ly * sin
            val ry = lx * sin + ly * cos
            values[i * 4] = ndcX(centerX + rx)
            values[i * 4 + 1] = ndcY(centerY + ry)
            values[i * 4 + 2] = corner.u
            values[i * 4 + 3] = corner.v
        }
        return GlUtil.floatBufferOf(*values)
    }

    private fun ndcX(pixels: Float) = pixels / outputWidth * 2f - 1f

    private fun ndcY(pixels: Float) = pixels / outputHeight * 2f - 1f

    private class LayerDrawEntry(
        val textureId: Int,
        val vertices: List<FloatBuffer>,
        val opacity: Float,
        val startUs: Long,
        val endUs: Long,
    )

    private data class LocalCorner(val lx: Float, val ly: Float, val u: Float, val v: Float)

    private companion object {
        const val TAG = "VideoOverlayLayerRenderer"
        const val MAX_TILES = 400

        // Bounded retries; measured worst case converges in 8, so 30 is ample headroom.
        const val MAX_WIDEN_PASSES = 30

        // Floor guarantees progress when the computed widen factor sits just above 1.
        const val MIN_WIDEN_FACTOR = 1.05f

        // Below this, treat angle as zero; matches iOS's rotated-tile threshold.
        const val ANGLE_EPSILON_DEG = 0.001f

        // Bitmap row 0 is top, texture v=0 is bottom, so v is flipped.
        val UNIT_CORNERS = listOf(
            LocalCorner(-1f, -1f, 0f, 1f),
            LocalCorner(1f, -1f, 1f, 1f),
            LocalCorner(-1f, 1f, 0f, 0f),
            LocalCorner(1f, 1f, 1f, 0f),
        )

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
              gl_FragColor = texture2D(sTexture, vTexCoord) * uOpacity;
            }
        """.trimIndent()
    }
}
