package com.rx.videooverlay

/** Error with a code so JS can distinguish causes; passed directly into Promise.reject. */
internal class VideoOverlayException(
    val code: String,
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause)

internal object ErrorCode {
    /** Input video file does not exist / cannot be read. */
    const val INPUT_NOT_FOUND = "E_INPUT_NOT_FOUND"

    /** outputPath is invalid: same as source video, or its parent directory can't be created. */
    const val INVALID_OUTPUT = "E_INVALID_OUTPUT"

    /** cuesJson could not be parsed, or is empty. */
    const val INVALID_CUES = "E_INVALID_CUES"

    /** Input file has no video track. */
    const val NO_VIDEO_TRACK = "E_NO_VIDEO_TRACK"

    /** Error during decode/encode/mux. */
    const val BURN_FAILED = "E_BURN_FAILED"
}
