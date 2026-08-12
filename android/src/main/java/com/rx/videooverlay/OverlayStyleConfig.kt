package com.rx.videooverlay

import android.graphics.Color
import org.json.JSONObject

/** Horizontal alignment of a content block (text box or image) within the frame. */
internal enum class HorizontalAlign { LEFT, CENTER, RIGHT }

/** Vertical alignment of a content block (text box or image) within the frame. */
internal enum class VerticalAlign { TOP, CENTER, BOTTOM }

/** Anchor position: 9 named presets or an exact Coordinate; default is BOTTOM_LEFT (legacy behavior). */
internal sealed interface OverlayPosition {

    enum class Preset(
        val jsonValue: String,
        val horizontal: HorizontalAlign,
        val vertical: VerticalAlign,
    ) : OverlayPosition {
        TOP_LEFT("topLeft", HorizontalAlign.LEFT, VerticalAlign.TOP),
        TOP_CENTER("topCenter", HorizontalAlign.CENTER, VerticalAlign.TOP),
        TOP_RIGHT("topRight", HorizontalAlign.RIGHT, VerticalAlign.TOP),
        CENTER_LEFT("centerLeft", HorizontalAlign.LEFT, VerticalAlign.CENTER),
        CENTER("center", HorizontalAlign.CENTER, VerticalAlign.CENTER),
        CENTER_RIGHT("centerRight", HorizontalAlign.RIGHT, VerticalAlign.CENTER),
        BOTTOM_LEFT("bottomLeft", HorizontalAlign.LEFT, VerticalAlign.BOTTOM),
        BOTTOM_CENTER("bottomCenter", HorizontalAlign.CENTER, VerticalAlign.BOTTOM),
        BOTTOM_RIGHT("bottomRight", HorizontalAlign.RIGHT, VerticalAlign.BOTTOM);

        companion object {
            fun fromJsonValue(value: String): Preset? =
                entries.firstOrNull { it.jsonValue == value }
        }
    }

    /** Exact 0-1 x/y placement, bypassing marginRatio entirely; (0,0) top-left, (1,1) bottom-right. */
    data class Coordinate(val x: Float, val y: Float) : OverlayPosition {
        /** Nearest-third heuristic for in-box text alignment only; frame position stays exact via x/y. */
        val horizontal: HorizontalAlign get() = when {
            x < 1f / 3f -> HorizontalAlign.LEFT
            x > 2f / 3f -> HorizontalAlign.RIGHT
            else -> HorizontalAlign.CENTER
        }
        val vertical: VerticalAlign get() = when {
            y < 1f / 3f -> VerticalAlign.TOP
            y > 2f / 3f -> VerticalAlign.BOTTOM
            else -> VerticalAlign.CENTER
        }
    }
}

/** CSS-style 100-900 weight; Android applies it even with a custom fontFamily, unlike iOS. */
internal enum class OverlayFontWeight(val jsonValue: String, val value: Int) {
    W100("100", 100),
    W200("200", 200),
    W300("300", 300),
    W400("400", 400), // also matches JS "normal" — see parseFontWeight
    W500("500", 500),
    W600("600", 600),
    W700("700", 700), // also matches JS "bold" — see parseFontWeight
    W800("800", 800),
    W900("900", 900);

    companion object {
        fun fromJsonValue(value: String): OverlayFontWeight? =
            entries.firstOrNull { it.jsonValue == value }
    }
}

/** Style config parsed from styleJson; fontWeight now defaults to W400, an intentional change from BOLD. */
internal data class OverlayStyleConfig(
    val textColor: Int,
    val strokeColor: Int,
    val fontFamily: String?,
    val fontWeight: OverlayFontWeight,
    val fontScale: Float,
    /** Absolute pixel size, bypassing auto-computed sizing and fontScale entirely; null keeps default behavior. */
    val fontSize: Float?,
    /** Stroke thickness in px; null keeps the auto formula, 0 disables the stroke entirely. */
    val strokeWidth: Float?,
    /** Real GL alpha blend multiplier via uOpacity, not a JS approximation. */
    val opacity: Float,
    val position: OverlayPosition,
    val marginRatio: Float,
    /** Width/height the output is center-cropped to; null keeps the source's own framing. */
    val cropAspectRatio: Float?,
) {
    companion object {
        const val DEFAULT_TEXT_COLOR = Color.WHITE
        const val DEFAULT_STROKE_COLOR = Color.BLACK
        val DEFAULT_FONT_WEIGHT = OverlayFontWeight.W400
        const val DEFAULT_FONT_SCALE = 1.0f
        val DEFAULT_FONT_SIZE: Float? = null
        val DEFAULT_STROKE_WIDTH: Float? = null
        const val DEFAULT_OPACITY = 1.0f
        val DEFAULT_POSITION = OverlayPosition.Preset.BOTTOM_LEFT
        const val DEFAULT_MARGIN_RATIO = 0.05f
        val DEFAULT_CROP_ASPECT_RATIO: Float? = null

        val DEFAULT = OverlayStyleConfig(
            textColor = DEFAULT_TEXT_COLOR,
            strokeColor = DEFAULT_STROKE_COLOR,
            fontFamily = null,
            fontWeight = DEFAULT_FONT_WEIGHT,
            fontScale = DEFAULT_FONT_SCALE,
            fontSize = DEFAULT_FONT_SIZE,
            strokeWidth = DEFAULT_STROKE_WIDTH,
            opacity = DEFAULT_OPACITY,
            position = DEFAULT_POSITION,
            marginRatio = DEFAULT_MARGIN_RATIO,
            cropAspectRatio = DEFAULT_CROP_ASPECT_RATIO,
        )
    }
}

/** Parses styleJson; unlike cues parsing, never throws — bad fields fall back individually to defaults. */
internal object OverlayStyleParser {

    private const val MIN_FONT_SCALE = 0.5f
    private const val MAX_FONT_SCALE = 3.0f

    fun parse(styleJson: String): OverlayStyleConfig {
        val json = runCatching { JSONObject(styleJson) }.getOrNull() ?: JSONObject()

        return OverlayStyleConfig(
            textColor = parseColor(json, "textColor", OverlayStyleConfig.DEFAULT_TEXT_COLOR),
            strokeColor = parseColor(json, "strokeColor", OverlayStyleConfig.DEFAULT_STROKE_COLOR),
            fontFamily = json.optString("fontFamily", "").ifBlank { null },
            fontWeight = parseFontWeight(json),
            fontScale = parseFontScale(json),
            fontSize = parseFontSize(json),
            strokeWidth = parseStrokeWidth(json),
            opacity = parseOpacity(json),
            position = parsePosition(json),
            marginRatio = parseMarginRatio(json),
            cropAspectRatio = parseCropAspectRatio(json),
        )
    }

    /** Must be finite and positive; anything else keeps the source's own framing. */
    private fun parseCropAspectRatio(json: JSONObject): Float? {
        if (!json.has("cropAspectRatio")) return OverlayStyleConfig.DEFAULT_CROP_ASPECT_RATIO
        val value = json.optDouble("cropAspectRatio", Double.NaN)
        if (value.isNaN() || value <= 0.0) return OverlayStyleConfig.DEFAULT_CROP_ASPECT_RATIO
        return value.toFloat()
    }

    /** Accepts "normal"/"bold" aliases or "100".."900" strings; anything else falls back to default, never throws. */
    private fun parseFontWeight(json: JSONObject): OverlayFontWeight {
        val raw = json.optString("fontWeight", "")
        return when (raw) {
            "normal" -> OverlayFontWeight.W400
            "bold" -> OverlayFontWeight.W700
            else -> OverlayFontWeight.fromJsonValue(raw) ?: OverlayStyleConfig.DEFAULT_FONT_WEIGHT
        }
    }

    /** `Color.parseColor` throws `IllegalArgumentException` for an invalid hex string -> fall back to [default]. */
    private fun parseColor(json: JSONObject, key: String, default: Int): Int {
        val hex = json.optString(key, "").takeIf { it.isNotBlank() } ?: return default
        return runCatching { Color.parseColor(hex) }.getOrDefault(default)
    }

    /** Clamp to avoid absurd values (0, negative, too large) breaking the layout. */
    private fun parseFontScale(json: JSONObject): Float {
        if (!json.has("fontScale")) return OverlayStyleConfig.DEFAULT_FONT_SCALE
        val value = json.optDouble("fontScale", Double.NaN)
        if (value.isNaN()) return OverlayStyleConfig.DEFAULT_FONT_SCALE
        return value.toFloat().coerceIn(MIN_FONT_SCALE, MAX_FONT_SCALE)
    }

    /** Must be finite and positive, else falls back to null; no upper clamp, unlike fontScale. */
    private fun parseFontSize(json: JSONObject): Float? {
        if (!json.has("fontSize")) return OverlayStyleConfig.DEFAULT_FONT_SIZE
        val value = json.optDouble("fontSize", Double.NaN)
        if (value.isNaN() || value <= 0.0) return OverlayStyleConfig.DEFAULT_FONT_SIZE
        return value.toFloat()
    }

    /** 0 explicitly disables the stroke; unlike fontSize, 0 is a valid value, not a fallback trigger. */
    private fun parseStrokeWidth(json: JSONObject): Float? {
        if (!json.has("strokeWidth")) return OverlayStyleConfig.DEFAULT_STROKE_WIDTH
        val value = json.optDouble("strokeWidth", Double.NaN)
        if (value.isNaN() || value < 0.0) return OverlayStyleConfig.DEFAULT_STROKE_WIDTH
        return value.toFloat()
    }

    /** Clamp to [0, 1]: opacity is an alpha multiplier, values outside that range are meaningless. */
    private fun parseOpacity(json: JSONObject): Float {
        if (!json.has("opacity")) return OverlayStyleConfig.DEFAULT_OPACITY
        val value = json.optDouble("opacity", Double.NaN)
        if (value.isNaN()) return OverlayStyleConfig.DEFAULT_OPACITY
        return value.toFloat().coerceIn(0f, 1f)
    }

    /** Accepts a preset string or {x,y} object; anything else falls back to bottom-left, never throws. */
    private fun parsePosition(json: JSONObject): OverlayPosition {
        return when (val raw = json.opt("position")) {
            is String -> OverlayPosition.Preset.fromJsonValue(raw) ?: OverlayStyleConfig.DEFAULT_POSITION
            is JSONObject -> parseCoordinate(raw)
            else -> OverlayStyleConfig.DEFAULT_POSITION
        }
    }

    /** Either coordinate missing/non-finite falls the whole position back to default, not just one axis. */
    private fun parseCoordinate(json: JSONObject): OverlayPosition {
        val x = json.optDouble("x", Double.NaN)
        val y = json.optDouble("y", Double.NaN)
        if (x.isNaN() || y.isNaN()) return OverlayStyleConfig.DEFAULT_POSITION
        return OverlayPosition.Coordinate(
            x.toFloat().coerceIn(0f, 1f),
            y.toFloat().coerceIn(0f, 1f),
        )
    }

    /** Clamp to [0, 0.5] so margin can't be negative or swallow the frame. */
    private fun parseMarginRatio(json: JSONObject): Float {
        if (!json.has("marginRatio")) return OverlayStyleConfig.DEFAULT_MARGIN_RATIO
        val value = json.optDouble("marginRatio", Double.NaN)
        if (value.isNaN()) return OverlayStyleConfig.DEFAULT_MARGIN_RATIO
        return value.toFloat().coerceIn(0f, 0.5f)
    }
}
