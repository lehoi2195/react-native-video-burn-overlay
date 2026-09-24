package com.rx.videooverlay

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import java.nio.ByteBuffer

/** Copies audio verbatim via MediaExtractor/MediaMuxer, no decode/re-encode — zero quality loss or cost. */
internal class AudioTrackCopier(
    videoPath: String,
    trackIndex: Int,
) {

    private val extractor = MediaExtractor().apply {
        setDataSource(videoPath)
        selectTrack(trackIndex)
    }

    private val sourceFormat: MediaFormat = extractor.getTrackFormat(trackIndex)

    // Some OEM muxers (Samsung) drop the sample description for raw extractor formats; pass minimal keys.
    val format: MediaFormat = MediaFormat.createAudioFormat(
        checkNotNull(sourceFormat.getString(MediaFormat.KEY_MIME)) { "Audio track has no mime type" },
        sourceFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE),
        sourceFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT),
    ).apply {
        setByteBuffer("csd-0", sourceFormat.getByteBuffer("csd-0"))
    }

    private val buffer: ByteBuffer = ByteBuffer.allocateDirect(
        sourceFormat.optInt(MediaFormat.KEY_MAX_INPUT_SIZE, 0).coerceAtLeast(DEFAULT_BUFFER_BYTES)
    )

    private val info = MediaCodec.BufferInfo()
    private var finished = false

    /** Writes samples <= limitUs; interleaving by time keeps the mp4 playback smooth and seekable. */
    fun pumpUpTo(limitUs: Long, muxer: MediaMuxer, muxerTrackIndex: Int) {
        if (finished || muxerTrackIndex < 0) return
        while (true) {
            val sampleTimeUs = extractor.sampleTime
            if (sampleTimeUs < 0) {
                finished = true
                return
            }
            if (sampleTimeUs > limitUs) return

            buffer.clear()
            val size = extractor.readSampleData(buffer, 0)
            if (size < 0) {
                finished = true
                return
            }

            info.offset = 0
            info.size = size
            info.presentationTimeUs = sampleTimeUs
            info.flags =
                if (extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) {
                    MediaCodec.BUFFER_FLAG_KEY_FRAME
                } else {
                    0
                }

            buffer.position(0)
            buffer.limit(size)
            muxer.writeSampleData(muxerTrackIndex, buffer, info)
            extractor.advance()
        }
    }

    fun release() {
        extractor.release()
    }

    private companion object {
        const val DEFAULT_BUFFER_BYTES = 256 * 1024
    }
}

/** `getInteger` throws an exception if the key doesn't exist or has the wrong type. */
internal fun MediaFormat.optInt(key: String, fallback: Int): Int = try {
    if (containsKey(key)) getInteger(key) else fallback
} catch (_: ClassCastException) {
    // Some devices store KEY_FRAME_RATE as a Float.
    try {
        if (containsKey(key)) getFloat(key).toInt() else fallback
    } catch (_: Exception) {
        fallback
    }
} catch (_: NullPointerException) {
    fallback
}
