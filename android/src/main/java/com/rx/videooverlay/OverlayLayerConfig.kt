package com.rx.videooverlay

import android.graphics.Color
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** Repeats a layer across the whole frame; angle/spacing are the lattice, scale/stagger tweak it. */
internal data class TileLayerConfig(
    val angle: Float,
    val spacingX: Float,
    val spacingY: Float,
    val anchor: OverlayPosition,
    val scale: Float,
    val stagger: Boolean,
)

/** Fields every layer type shares; times are in microseconds, endUs null means "video duration". */
internal sealed interface OverlayLayerConfig {
    val position: OverlayPosition
    val marginRatio: Float
    val opacity: Float
    val rotation: Float
    val startUs: Long
    val endUs: Long?
    val tile: TileLayerConfig?
}

internal data class ImageLayerConfig(
    override val position: OverlayPosition,
    override val marginRatio: Float,
    override val opacity: Float,
    override val rotation: Float,
    override val startUs: Long,
    override val endUs: Long?,
    override val tile: TileLayerConfig?,
    val source: String,
    /** Target output-frame pixel size; null derives from the image or the other dimension. */
    val width: Float?,
    val height: Float?,
) : OverlayLayerConfig

internal data class TextLayerConfig(
    override val position: OverlayPosition,
    override val marginRatio: Float,
    override val opacity: Float,
    override val rotation: Float,
    override val startUs: Long,
    override val endUs: Long?,
    override val tile: TileLayerConfig?,
    val text: String,
    val fontSize: Float?,
    val fontScale: Float,
    val fontColor: Int,
    val strokeColor: Int,
    val strokeWidth: Float?,
    val fontFamily: String?,
    val fontWeight: OverlayFontWeight,
) : OverlayLayerConfig

/** burnLayers options; null means unset (no crop, no bitrate cap). */
internal data class LayerBurnOptions(
    val cropAspectRatio: Float?,
    /** Video bitrate cap in bits/s (e.g. from an upload size limit). */
    val maxBitRate: Int?,
)

/** Parses layersJson; structural problems throw INVALID_LAYERS, cosmetic fields fall back or clamp. */
internal object OverlayLayerParser {

    private const val DEFAULT_MARGIN_RATIO = 0.05f
    private const val DEFAULT_TILE_ANGLE = 0f
    private const val DEFAULT_TILE_SPACING = 0.25f
    private const val MIN_TILE_SPACING = 0.02f
    private const val MAX_TILE_SPACING = 2f
    private const val DEFAULT_TILE_SCALE = 1f
    private const val MIN_TILE_SCALE = 0.05f
    private const val MAX_TILE_SCALE = 10f
    private const val DEFAULT_FONT_SCALE = 1f
    private const val MIN_FONT_SCALE = 0.5f
    private const val MAX_FONT_SCALE = 3f
    private val DEFAULT_POSITION = OverlayPosition.Preset.BOTTOM_LEFT
    private val DEFAULT_TILE_ANCHOR = OverlayPosition.Preset.CENTER

    fun parse(layersJson: String): List<OverlayLayerConfig> {
        val array = try {
            JSONArray(layersJson)
        } catch (e: JSONException) {
            throw VideoOverlayException(
                ErrorCode.INVALID_LAYERS,
                "layersJson is not a valid JSON array: ${e.message}",
                e,
            )
        }
        if (array.length() == 0) {
            throw VideoOverlayException(ErrorCode.INVALID_LAYERS, "layersJson is an empty array")
        }

        val layers = ArrayList<OverlayLayerConfig>(array.length())
        for (i in 0 until array.length()) {
            val obj = array.optJSONObject(i)
                ?: throw VideoOverlayException(ErrorCode.INVALID_LAYERS, "layersJson[$i] is not an object")
            layers.add(parseLayer(obj, i))
        }
        return layers
    }

    /** Parses optionsJson; unlike layers, every option falls back silently, never throws. */
    fun parseOptions(optionsJson: String): LayerBurnOptions {
        val json = runCatching { JSONObject(optionsJson) }.getOrNull() ?: JSONObject()
        return LayerBurnOptions(
            cropAspectRatio = positiveOrNull(json, "cropAspectRatio")?.toFloat(),
            maxBitRate = positiveOrNull(json, "maxBitRate")?.coerceAtMost(Int.MAX_VALUE.toDouble())?.toInt(),
        )
    }

    /** Must be finite and positive; anything else means the option is unset. */
    private fun positiveOrNull(json: JSONObject, key: String): Double? {
        if (!json.has(key)) return null
        val value = json.optDouble(key, Double.NaN)
        if (value.isNaN() || value.isInfinite() || value <= 0.0) return null
        return value
    }

    private fun parseLayer(obj: JSONObject, index: Int): OverlayLayerConfig {
        return when (val type = obj.optString("type", "")) {
            "image" -> parseImageLayer(obj, index)
            "text" -> parseTextLayer(obj, index)
            else -> throw VideoOverlayException(
                ErrorCode.INVALID_LAYERS,
                "layersJson[$index] has an unknown or missing type: $type",
            )
        }
    }

    private fun parseImageLayer(obj: JSONObject, index: Int): ImageLayerConfig {
        val source = obj.optString("source", "")
        if (source.isBlank()) {
            throw VideoOverlayException(ErrorCode.INVALID_LAYERS, "layersJson[$index] image layer has a blank source")
        }
        val base = parseBase(obj, index)
        return ImageLayerConfig(
            position = base.position,
            marginRatio = base.marginRatio,
            opacity = base.opacity,
            rotation = base.rotation,
            startUs = base.startUs,
            endUs = base.endUs,
            tile = base.tile,
            source = source,
            width = parsePositiveFloatOrNull(obj, "width"),
            height = parsePositiveFloatOrNull(obj, "height"),
        )
    }

    private fun parseTextLayer(obj: JSONObject, index: Int): TextLayerConfig {
        if (!obj.has("text")) {
            throw VideoOverlayException(ErrorCode.INVALID_LAYERS, "layersJson[$index] text layer is missing text")
        }
        val base = parseBase(obj, index)
        return TextLayerConfig(
            position = base.position,
            marginRatio = base.marginRatio,
            opacity = base.opacity,
            rotation = base.rotation,
            startUs = base.startUs,
            endUs = base.endUs,
            tile = base.tile,
            text = obj.optString("text", ""),
            fontSize = parsePositiveFloatOrNull(obj, "fontSize"),
            fontScale = parseFontScale(obj),
            fontColor = parseColor(obj, "fontColor", Color.WHITE),
            strokeColor = parseColor(obj, "strokeColor", Color.BLACK),
            strokeWidth = parseNonNegativeFloatOrNull(obj, "strokeWidth"),
            fontFamily = obj.optString("fontFamily", "").ifBlank { null },
            fontWeight = parseFontWeight(obj),
        )
    }

    /** Fields shared by every layer type, common to both image and text parsing. */
    private data class BaseFields(
        val position: OverlayPosition,
        val marginRatio: Float,
        val opacity: Float,
        val rotation: Float,
        val startUs: Long,
        val endUs: Long?,
        val tile: TileLayerConfig?,
    )

    private fun parseBase(obj: JSONObject, index: Int): BaseFields {
        val startSec = obj.optDouble("startSec", Double.NaN).let { if (it.isNaN()) 0.0 else it }
        val endUs = parseEndUs(obj, startSec, index)
        return BaseFields(
            position = parsePosition(obj, DEFAULT_POSITION),
            marginRatio = parseMarginRatio(obj),
            opacity = parseOpacity(obj),
            rotation = parseRotation(obj),
            startUs = (startSec * 1_000_000.0).toLong(),
            endUs = endUs,
            tile = parseTile(obj),
        )
    }

    /** endSec <= startSec is structural (throws); missing/invalid endSec falls back to null (video duration). */
    private fun parseEndUs(obj: JSONObject, startSec: Double, index: Int): Long? {
        if (!obj.has("endSec")) return null
        val endSec = obj.optDouble("endSec", Double.NaN)
        if (endSec.isNaN()) return null
        if (endSec <= startSec) {
            throw VideoOverlayException(
                ErrorCode.INVALID_LAYERS,
                "layersJson[$index] endSec ($endSec) must be greater than startSec ($startSec)",
            )
        }
        return (endSec * 1_000_000.0).toLong()
    }

    private fun parseRotation(obj: JSONObject): Float {
        val value = obj.optDouble("rotation", Double.NaN)
        return if (value.isNaN()) 0f else value.toFloat()
    }

    private fun parseMarginRatio(obj: JSONObject): Float {
        if (!obj.has("marginRatio")) return DEFAULT_MARGIN_RATIO
        val value = obj.optDouble("marginRatio", Double.NaN)
        if (value.isNaN()) return DEFAULT_MARGIN_RATIO
        return value.toFloat().coerceIn(0f, 0.5f)
    }

    private fun parseOpacity(obj: JSONObject): Float {
        if (!obj.has("opacity")) return 1f
        val value = obj.optDouble("opacity", Double.NaN)
        if (value.isNaN()) return 1f
        return value.toFloat().coerceIn(0f, 1f)
    }

    private fun parseFontScale(obj: JSONObject): Float {
        if (!obj.has("fontScale")) return DEFAULT_FONT_SCALE
        val value = obj.optDouble("fontScale", Double.NaN)
        if (value.isNaN()) return DEFAULT_FONT_SCALE
        return value.toFloat().coerceIn(MIN_FONT_SCALE, MAX_FONT_SCALE)
    }

    private fun parsePositiveFloatOrNull(obj: JSONObject, key: String): Float? {
        if (!obj.has(key)) return null
        val value = obj.optDouble(key, Double.NaN)
        if (value.isNaN() || value <= 0.0) return null
        return value.toFloat()
    }

    private fun parseNonNegativeFloatOrNull(obj: JSONObject, key: String): Float? {
        if (!obj.has(key)) return null
        val value = obj.optDouble(key, Double.NaN)
        if (value.isNaN() || value < 0.0) return null
        return value.toFloat()
    }

    private fun parseColor(obj: JSONObject, key: String, default: Int): Int {
        val hex = obj.optString(key, "").takeIf { it.isNotBlank() } ?: return default
        return runCatching { Color.parseColor(hex) }.getOrDefault(default)
    }

    private fun parseFontWeight(obj: JSONObject): OverlayFontWeight {
        return when (val raw = obj.optString("fontWeight", "")) {
            "normal" -> OverlayFontWeight.W400
            "bold" -> OverlayFontWeight.W700
            else -> OverlayFontWeight.fromJsonValue(raw) ?: OverlayStyleConfig.DEFAULT_FONT_WEIGHT
        }
    }

    private fun parsePosition(obj: JSONObject, default: OverlayPosition): OverlayPosition {
        return when (val raw = obj.opt("position")) {
            is String -> OverlayPosition.Preset.fromJsonValue(raw) ?: default
            is JSONObject -> parseCoordinate(raw, default)
            else -> default
        }
    }

    private fun parseCoordinate(obj: JSONObject, default: OverlayPosition): OverlayPosition {
        val x = obj.optDouble("x", Double.NaN)
        val y = obj.optDouble("y", Double.NaN)
        if (x.isNaN() || y.isNaN()) return default
        return OverlayPosition.Coordinate(x.toFloat().coerceIn(0f, 1f), y.toFloat().coerceIn(0f, 1f))
    }

    private fun parseTile(obj: JSONObject): TileLayerConfig? {
        val tileObj = obj.optJSONObject("tile") ?: return null
        return TileLayerConfig(
            angle = parseFiniteOrDefault(tileObj, "angle", DEFAULT_TILE_ANGLE),
            spacingX = parseClampedOrDefault(tileObj, "spacingX", DEFAULT_TILE_SPACING, MIN_TILE_SPACING, MAX_TILE_SPACING),
            spacingY = parseClampedOrDefault(tileObj, "spacingY", DEFAULT_TILE_SPACING, MIN_TILE_SPACING, MAX_TILE_SPACING),
            anchor = parsePosition(tileObj, DEFAULT_TILE_ANCHOR),
            scale = parseClampedOrDefault(tileObj, "scale", DEFAULT_TILE_SCALE, MIN_TILE_SCALE, MAX_TILE_SCALE),
            stagger = tileObj.optBoolean("stagger", false),
        )
    }

    private fun parseFiniteOrDefault(obj: JSONObject, key: String, default: Float): Float {
        val value = obj.optDouble(key, Double.NaN)
        return if (value.isNaN()) default else value.toFloat()
    }

    private fun parseClampedOrDefault(obj: JSONObject, key: String, default: Float, min: Float, max: Float): Float {
        val value = obj.optDouble(key, Double.NaN)
        if (value.isNaN()) return default
        return value.toFloat().coerceIn(min, max)
    }
}
