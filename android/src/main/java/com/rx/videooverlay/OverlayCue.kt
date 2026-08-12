package com.rx.videooverlay

import org.json.JSONArray
import org.json.JSONException

/** Time span with text lines or image path; imagePath takes priority, times stored in microseconds. */
internal data class OverlayCue(
    val startUs: Long,
    val endUs: Long,
    val lines: List<String>,
    val imagePath: String?,
)

internal object OverlayCueParser {

    /** Parses cuesJson array; arrives as UTF-16 java.lang.String via JSI, must not be re-decoded/encoded. */
    fun parse(cuesJson: String): List<OverlayCue> {
        val array = try {
            JSONArray(cuesJson)
        } catch (e: JSONException) {
            throw VideoOverlayException(
                ErrorCode.INVALID_CUES,
                "cuesJson is not a valid JSON array: ${e.message}",
                e,
            )
        }

        val cues = ArrayList<OverlayCue>(array.length())
        for (i in 0 until array.length()) {
            val obj = array.optJSONObject(i) ?: throw VideoOverlayException(
                ErrorCode.INVALID_CUES,
                "cuesJson[$i] is not an object",
            )

            val startSec = obj.optDouble("startSec", Double.NaN)
            val endSec = obj.optDouble("endSec", Double.NaN)
            if (startSec.isNaN() || endSec.isNaN() || endSec <= startSec) {
                throw VideoOverlayException(
                    ErrorCode.INVALID_CUES,
                    "cuesJson[$i] is missing a valid startSec/endSec (startSec=$startSec, endSec=$endSec)",
                )
            }

            // "lines" is now optional: a cue may use "imagePath" instead.
            val rawLines = obj.optJSONArray("lines")
            val lineCount = rawLines?.length() ?: 0
            val lines = ArrayList<String>(lineCount)
            if (rawLines != null) {
                for (j in 0 until lineCount) {
                    lines.add(rawLines.optString(j, ""))
                }
            }

            val imagePath = obj.optString("imagePath", "").ifBlank { null }

            cues.add(
                OverlayCue(
                    startUs = (startSec * 1_000_000.0).toLong(),
                    endUs = (endSec * 1_000_000.0).toLong(),
                    lines = lines,
                    imagePath = imagePath,
                )
            )
        }

        if (cues.isEmpty()) {
            throw VideoOverlayException(ErrorCode.INVALID_CUES, "cuesJson is an empty array")
        }
        return cues.sortedBy { it.startUs }
    }
}

/** Returns the active cue; a forward-moving cursor suffices since timestamps only increase. */
internal class CueTimeline(private val cues: List<OverlayCue>) {

    private var cursor = 0

    /** Index of the cue containing ptsUs, or -1 if it falls in a gap. */
    fun indexAt(ptsUs: Long): Int {
        while (cursor < cues.size && ptsUs >= cues[cursor].endUs) {
            cursor++
        }
        if (cursor >= cues.size) return -1
        // `[startSec, endSec)`: only visible once startSec has been reached.
        return if (ptsUs >= cues[cursor].startUs) cursor else -1
    }
}
