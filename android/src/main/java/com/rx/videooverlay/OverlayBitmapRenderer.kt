package com.rx.videooverlay

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.Typeface
import android.os.Build
import kotlin.math.max
import kotlin.math.min

/** Draws a cue's text onto a shared, fixed-size bitmap so the GL texture allocates once. */
internal class OverlayBitmapRenderer(
    outputWidth: Int,
    outputHeight: Int,
    cues: List<OverlayCue>,
    style: OverlayStyleConfig,
) {

    /** Margin = style.marginRatio fraction (default 5%) of the frame width. */
    val marginPx: Int = max(1, (outputWidth * style.marginRatio).toInt())

    /** Overlay box width = frame width minus 2 margins. */
    val boxWidth: Int = max(1, outputWidth - 2 * marginPx)

    /** Anchor corner, exposed so FrameRenderer knows where to place the overlay box. */
    val position: OverlayPosition = style.position

    val boxHeight: Int

    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val padding: Float
    private val lineHeight: Float
    private val baselineOffsetFromBottom: Float

    /** Baseline of the first line from the box's top, used when top-anchored. */
    private val baselineOffsetFromTop: Float

    /** True if top-anchored; CENTER and BOTTOM both use bottom-anchored packing (a deliberate simplification). */
    private val topAligned: Boolean

    /** X coordinate shared by every text line, based on horizontal alignment (LEFT/CENTER/RIGHT). */
    private val textX: Float

    /** Resolved stroke width in px; 0 means the stroke pass is skipped entirely. */
    private val strokeWidth: Float

    /** Bitmap shared across every cue — NOT recreated per frame. */
    val bitmap: Bitmap
    private val canvas: Canvas

    init {
        // Empty fontFamily keeps default typeface; Typeface.create never throws on bad names.
        val baseTypeface = if (style.fontFamily.isNullOrBlank()) {
            Typeface.DEFAULT
        } else {
            Typeface.create(style.fontFamily, Typeface.NORMAL)
        }

        // fontWeight applies to both fallback and custom fontFamily on Android, unlike iOS's PostScript-baked weight.
        val typeface = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // API 28+ accepts our 100-900 weight scale directly, rendering the exact requested weight.
            Typeface.create(baseTypeface, style.fontWeight.value, false)
        } else {
            // API 24-27 lacks fine-grained weight; threshold 600+ as BOLD, else NORMAL — a deliberate degradation.
            val legacyStyle = if (style.fontWeight.value >= 600) Typeface.BOLD else Typeface.NORMAL
            Typeface.create(baseTypeface, legacyStyle)
        }

        // fontSize bypasses auto-computed size and fontScale entirely, avoiding confusing double-scaling.
        var textSize = style.fontSize
            ?: (max(14f, min(outputWidth, outputHeight) * 0.032f) * style.fontScale)

        fillPaint.typeface = typeface
        fillPaint.textSize = textSize

        // Shrink text (max 50%) if the longest line overflows the box, to limit clipping.
        val widest = cues.asSequence()
            .flatMap { it.lines.asSequence() }
            .map { fillPaint.measureText(it) }
            .maxOrNull() ?: 0f
        val available = boxWidth * 0.94f
        if (widest > available && widest > 0f) {
            textSize *= max(0.5f, available / widest)
            fillPaint.textSize = textSize
        }

        fillPaint.color = style.textColor
        fillPaint.style = Paint.Style.FILL

        // Text outline: keeps it readable against any background (light or dark).
        strokePaint.typeface = typeface
        strokePaint.textSize = textSize
        strokePaint.color = style.strokeColor
        strokePaint.style = Paint.Style.STROKE
        strokeWidth = style.strokeWidth ?: max(2f, textSize * 0.14f)
        strokePaint.strokeWidth = strokeWidth
        strokePaint.strokeJoin = Paint.Join.ROUND

        padding = textSize * 0.35f

        // Use font metrics not textSize: Vietnamese diacritics rise/extend beyond cap-height/baseline, avoiding clipping.
        val fm = fillPaint.fontMetrics
        lineHeight = fm.bottom - fm.top
        baselineOffsetFromBottom = fm.bottom
        baselineOffsetFromTop = -fm.top

        val horizontalAlign: HorizontalAlign
        val verticalAlign: VerticalAlign
        when (val stylePosition = style.position) {
            is OverlayPosition.Preset -> {
                horizontalAlign = stylePosition.horizontal
                verticalAlign = stylePosition.vertical
            }
            is OverlayPosition.Coordinate -> {
                horizontalAlign = stylePosition.horizontal
                verticalAlign = stylePosition.vertical
            }
        }

        topAligned = verticalAlign == VerticalAlign.TOP

        // Align both paint and the per-line x anchor together, avoiding per-line x recomputation.
        val paintAlign = when (horizontalAlign) {
            HorizontalAlign.LEFT -> Paint.Align.LEFT
            HorizontalAlign.CENTER -> Paint.Align.CENTER
            HorizontalAlign.RIGHT -> Paint.Align.RIGHT
        }
        fillPaint.textAlign = paintAlign
        strokePaint.textAlign = paintAlign
        textX = when (horizontalAlign) {
            HorizontalAlign.LEFT -> padding
            HorizontalAlign.CENTER -> boxWidth / 2f
            HorizontalAlign.RIGHT -> boxWidth - padding
        }

        val maxLines = max(1, cues.maxOfOrNull { it.lines.size } ?: 1)
        boxHeight = (maxLines * lineHeight + 2 * padding).toInt().coerceAtLeast(1)

        bitmap = Bitmap.createBitmap(boxWidth, boxHeight, Bitmap.Config.ARGB_8888)
        canvas = Canvas(bitmap)
    }

    /** Redraws cue into shared bitmap; bottom anchor reverses index, top anchor uses forward index. */
    fun render(cue: OverlayCue): Bitmap {
        // Clear to transparent (not using eraseColor, to make sure the alpha channel is cleared too).
        canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)

        val lines = cue.lines
        for (i in lines.indices) {
            val baselineY = if (topAligned) {
                padding + baselineOffsetFromTop + i * lineHeight
            } else {
                val fromBottom = lines.size - 1 - i
                boxHeight - padding - baselineOffsetFromBottom - fromBottom * lineHeight
            }
            val text = lines[i]
            if (text.isEmpty()) continue
            // Draw the outline first, then the fill on top; strokeWidth 0 skips the outline pass.
            if (strokeWidth > 0f) {
                canvas.drawText(text, textX, baselineY, strokePaint)
            }
            canvas.drawText(text, textX, baselineY, fillPaint)
        }
        return bitmap
    }

    fun release() {
        if (!bitmap.isRecycled) bitmap.recycle()
    }
}
