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

/** Rasterizes one TextLayerConfig to a bitmap sized to fit it; mirrors OverlayBitmapRenderer's approach. */
internal object LayerTextBitmapFactory {

    /** Returns null for empty text; sizeScale multiplies font size for crisp tiled rendering. */
    fun render(outputWidth: Int, outputHeight: Int, layer: TextLayerConfig, sizeScale: Float): Bitmap? {
        if (layer.text.isEmpty()) return null
        val lines = layer.text.split("\n")

        val baseTypeface = if (layer.fontFamily.isNullOrBlank()) {
            Typeface.DEFAULT
        } else {
            Typeface.create(layer.fontFamily, Typeface.NORMAL)
        }
        // fontWeight applies to both fallback and custom fontFamily on Android, unlike iOS.
        val typeface = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            Typeface.create(baseTypeface, layer.fontWeight.value, false)
        } else {
            val legacyStyle = if (layer.fontWeight.value >= 600) Typeface.BOLD else Typeface.NORMAL
            Typeface.create(baseTypeface, legacyStyle)
        }

        val textSize = (layer.fontSize ?: (max(14f, min(outputWidth, outputHeight) * 0.032f) * layer.fontScale)) * sizeScale
        // Explicit or auto, strokeWidth scales with sizeScale so tiled text stays proportional.
        val strokeWidthPx = if (layer.strokeWidth != null) layer.strokeWidth * sizeScale else max(2f, textSize * 0.14f)

        val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.typeface = typeface
            this.textSize = textSize
            color = layer.fontColor
            style = Paint.Style.FILL
        }
        val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.typeface = typeface
            this.textSize = textSize
            color = layer.strokeColor
            style = Paint.Style.STROKE
            strokeWidth = strokeWidthPx
            strokeJoin = Paint.Join.ROUND
        }

        val horizontalAlign = when (val position = layer.position) {
            is OverlayPosition.Preset -> position.horizontal
            is OverlayPosition.Coordinate -> position.horizontal
        }
        val paintAlign = when (horizontalAlign) {
            HorizontalAlign.LEFT -> Paint.Align.LEFT
            HorizontalAlign.CENTER -> Paint.Align.CENTER
            HorizontalAlign.RIGHT -> Paint.Align.RIGHT
        }
        fillPaint.textAlign = paintAlign
        strokePaint.textAlign = paintAlign

        val padding = textSize * 0.35f
        // Use font metrics not textSize: diacritics rise/extend beyond cap-height/baseline.
        val fm = fillPaint.fontMetrics
        val lineHeight = fm.bottom - fm.top
        val baselineOffsetFromTop = -fm.top

        val widest = lines.maxOfOrNull { fillPaint.measureText(it) } ?: 0f
        val boxWidth = max(1, (widest + 2 * padding).toInt())
        val boxHeight = max(1, (lines.size * lineHeight + 2 * padding).toInt())

        val textX = when (horizontalAlign) {
            HorizontalAlign.LEFT -> padding
            HorizontalAlign.CENTER -> boxWidth / 2f
            HorizontalAlign.RIGHT -> boxWidth - padding
        }

        val bitmap = Bitmap.createBitmap(boxWidth, boxHeight, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
        for (i in lines.indices) {
            val text = lines[i]
            if (text.isEmpty()) continue
            val baselineY = padding + baselineOffsetFromTop + i * lineHeight
            if (strokeWidthPx > 0f) canvas.drawText(text, textX, baselineY, strokePaint)
            canvas.drawText(text, textX, baselineY, fillPaint)
        }
        return bitmap
    }
}
