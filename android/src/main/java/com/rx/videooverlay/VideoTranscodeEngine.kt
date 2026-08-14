package com.rx.videooverlay

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import android.os.SystemClock
import android.view.Surface
import java.io.File
import kotlin.math.roundToInt

/** Context passed to a drawer factory once the output frame's real dimensions are known. */
internal data class DrawerContext(
    val outputWidth: Int,
    val outputHeight: Int,
    val rotationDegrees: Int,
    val rotatedWidth: Int,
    val rotatedHeight: Int,
    val durationUs: Long,
)

/** System-API-only pipeline: decode, draw via GL (drawerFactory), encode, mux; shared by burnOverlay and burnLayers. */
internal class VideoTranscodeEngine(
    private val videoPath: String,
    private val outputPath: String,
) {

    /** File/path validation; must run before transcode(), matches the original burn() order. */
    fun prepareOutput() {
        val input = File(videoPath)
        if (!input.isFile || !input.canRead()) {
            throw VideoOverlayException(
                ErrorCode.INPUT_NOT_FOUND,
                "Input video not found or not readable: $videoPath",
            )
        }

        val output = File(outputPath)
        // Block overwriting the source video; it's the only copy of the data if burn fails.
        if (input.canonicalPath == output.canonicalPath) {
            throw VideoOverlayException(
                ErrorCode.INVALID_OUTPUT,
                "outputPath matches videoPath, which would overwrite the source video: $outputPath",
            )
        }
        output.parentFile?.mkdirs()
        if (output.exists() && !output.delete()) {
            throw VideoOverlayException(
                ErrorCode.INVALID_OUTPUT,
                "Failed to delete the existing output file: $outputPath",
            )
        }
    }

    /** Runs the decode/encode/mux loop; deletes the partial output and rethrows on any failure. */
    fun transcode(cropAspectRatio: Float?, drawerFactory: (DrawerContext) -> OverlayFrameDrawer) {
        try {
            runLoop(cropAspectRatio, drawerFactory)
        } catch (t: Throwable) {
            // Clean up the partial output file. Never touch the input file.
            File(outputPath).delete()
            throw t
        }
    }

    private fun runLoop(cropAspectRatio: Float?, drawerFactory: (DrawerContext) -> OverlayFrameDrawer) {
        // Nullable vars exist only for the finally block; try always uses the non-null local.
        var extractorRef: MediaExtractor? = null
        var decoderRef: MediaCodec? = null
        var encoderRef: MediaCodec? = null
        var encoderSurfaceRef: Surface? = null
        var inputSurfaceRef: EncoderInputSurface? = null
        var outputSurfaceRef: DecoderOutputSurface? = null
        var drawerRef: OverlayFrameDrawer? = null
        var muxerRef: MediaMuxer? = null
        var audioCopier: AudioTrackCopier? = null
        var muxerStarted = false

        try {
            val extractor = MediaExtractor().also { extractorRef = it }
            extractor.setDataSource(videoPath)

            val videoTrack = extractor.findTrack("video/")
                ?: throw VideoOverlayException(
                    ErrorCode.NO_VIDEO_TRACK,
                    "File has no video track: $videoPath",
                )
            // May be null: a clip recorded without sound must still work normally.
            val audioTrack = extractor.findTrack("audio/")

            val inputFormat = extractor.getTrackFormat(videoTrack)
            val mime = inputFormat.getString(MediaFormat.KEY_MIME)
                ?: throw VideoOverlayException(ErrorCode.NO_VIDEO_TRACK, "Video track has no mime type")

            val (sourceWidth, sourceHeight) = inputFormat.displaySize()
            val rotation = readRotation(inputFormat)
            val durationUs = readDurationUs(inputFormat)

            // Rotating pixels swaps dims for 90/270; both must stay even for H.264.
            val rotatedWidth = if (rotation == 90 || rotation == 270) sourceHeight else sourceWidth
            val rotatedHeight = if (rotation == 90 || rotation == 270) sourceWidth else sourceHeight

            // Overlay anchoring and auto font size then use the cropped frame, matching a preview.
            val (croppedWidth, croppedHeight) =
                cropToRatio(rotatedWidth, rotatedHeight, cropAspectRatio)
            val outputWidth = makeEven(croppedWidth)
            val outputHeight = makeEven(croppedHeight)
            if (outputWidth <= 0 || outputHeight <= 0) {
                throw VideoOverlayException(
                    ErrorCode.NO_VIDEO_TRACK,
                    "Invalid video dimensions: ${outputWidth}x$outputHeight",
                )
            }

            // ----- Encoder + EGL -----
            val encoder = MediaCodec.createEncoderByType(ENCODER_MIME).also { encoderRef = it }
            encoder.configure(
                buildEncoderFormat(inputFormat, outputWidth, outputHeight),
                null,
                null,
                MediaCodec.CONFIGURE_FLAG_ENCODE,
            )
            val encoderSurface = encoder.createInputSurface().also { encoderSurfaceRef = it }
            encoder.start()

            val inputSurface = EncoderInputSurface(encoderSurface).also { inputSurfaceRef = it }
            inputSurface.makeCurrent()

            // Created after makeCurrent(): texture/shaders belong to the just-created EGL context.
            val drawer = drawerFactory(
                DrawerContext(outputWidth, outputHeight, rotation, rotatedWidth, rotatedHeight, durationUs)
            ).also { drawerRef = it }
            val outputSurface = DecoderOutputSurface().also { outputSurfaceRef = it }

            // ----- Decoder -----
            extractor.selectTrack(videoTrack)
            // Force no auto-rotate (device behavior varies); rotation handled deterministically via GL instead.
            inputFormat.setInteger(MediaFormat.KEY_ROTATION, 0)
            val decoder = MediaCodec.createDecoderByType(mime).also { decoderRef = it }
            decoder.configure(inputFormat, outputSurface.surface, null, 0)
            decoder.start()

            // ----- Muxer -----
            // Skip setOrientationHint(): pixels are already rotated upright, avoiding a double rotation on playback.
            val muxer = MediaMuxer(outputPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
                .also { muxerRef = it }

            var videoMuxerTrack = -1
            var audioMuxerTrack = -1

            val decoderInfo = MediaCodec.BufferInfo()
            val encoderInfo = MediaCodec.BufferInfo()
            val stMatrix = FloatArray(16)

            var extractorDone = false
            var decoderDone = false
            var encoderDone = false
            var lastProgressMs = SystemClock.elapsedRealtime()

            while (!encoderDone) {
                var progressed = false

                // 1. Feed a sample into the decoder.
                if (!extractorDone) {
                    val index = decoder.dequeueInputBuffer(0)
                    if (index >= 0) {
                        progressed = true
                        val buffer = checkNotNull(decoder.getInputBuffer(index)) {
                            "Decoder input buffer $index null"
                        }
                        val size = extractor.readSampleData(buffer, 0)
                        if (size < 0) {
                            decoder.queueInputBuffer(
                                index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM
                            )
                            extractorDone = true
                        } else {
                            decoder.queueInputBuffer(index, 0, size, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }

                // 2. Pull the decoded frame, draw the frame + overlay, push it to the encoder.
                if (!decoderDone) {
                    val index = decoder.dequeueOutputBuffer(decoderInfo, 0)
                    if (index >= 0) {
                        progressed = true
                        val shouldRender = decoderInfo.size > 0
                        decoder.releaseOutputBuffer(index, shouldRender)
                        if (shouldRender) {
                            outputSurface.awaitNewImage()
                            outputSurface.getTransformMatrix(stMatrix)

                            drawer.drawFrame(
                                stMatrix,
                                decoderInfo.presentationTimeUs,
                                outputSurface.textureId,
                            )

                            // Preserve the original timeline (eglPresentationTime is in nanoseconds).
                            inputSurface.setPresentationTime(
                                decoderInfo.presentationTimeUs * 1_000
                            )
                            inputSurface.swapBuffers()
                        }
                        if (decoderInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                            decoderDone = true
                            encoder.signalEndOfInputStream()
                        }
                    }
                }

                // 3. Drain encoder output to muxer; poll with no timeout while decoder still runs.
                val timeoutUs = if (decoderDone) ENCODER_POLL_TIMEOUT_US else 0L
                var draining = true
                while (draining && !encoderDone) {
                    val index = encoder.dequeueOutputBuffer(encoderInfo, timeoutUs)
                    when {
                        index == MediaCodec.INFO_TRY_AGAIN_LATER -> draining = false

                        index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                            progressed = true
                            check(!muxerStarted) { "Encoder changed format after the muxer had already started" }
                            // Encoder's real format (csd-0/csd-1) is only available here; wait before addTrack + muxer start.
                            videoMuxerTrack = muxer.addTrack(encoder.outputFormat)
                            if (audioTrack != null) {
                                val copier = AudioTrackCopier(videoPath, audioTrack)
                                audioCopier = copier
                                audioMuxerTrack = muxer.addTrack(copier.format)
                            }
                            muxer.start()
                            muxerStarted = true
                        }

                        index >= 0 -> {
                            progressed = true
                            // Codec config (SPS/PPS) is already included in outputFormat -> don't write it again.
                            if (encoderInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
                                encoderInfo.size = 0
                            }
                            if (encoderInfo.size > 0 && muxerStarted) {
                                val buffer = checkNotNull(encoder.getOutputBuffer(index)) {
                                    "Encoder output buffer $index null"
                                }
                                buffer.position(encoderInfo.offset)
                                buffer.limit(encoderInfo.offset + encoderInfo.size)
                                muxer.writeSampleData(videoMuxerTrack, buffer, encoderInfo)
                                // Interleave audio based on the video's timestamp.
                                audioCopier?.pumpUpTo(
                                    encoderInfo.presentationTimeUs, muxer, audioMuxerTrack
                                )
                            }
                            encoder.releaseOutputBuffer(index, false)
                            if (encoderInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                                encoderDone = true
                            }
                        }

                        else -> Unit // INFO_OUTPUT_BUFFERS_CHANGED: ignored (deprecated)
                    }
                }

                // Guard against hanging forever if the codec stops returning anything.
                if (progressed) {
                    lastProgressMs = SystemClock.elapsedRealtime()
                } else {
                    if (SystemClock.elapsedRealtime() - lastProgressMs > NO_PROGRESS_TIMEOUT_MS) {
                        throw VideoOverlayException(
                            ErrorCode.BURN_FAILED,
                            "Codec made no progress for $NO_PROGRESS_TIMEOUT_MS ms",
                        )
                    }
                    Thread.sleep(1)
                }
            }

            if (!muxerStarted) {
                throw VideoOverlayException(
                    ErrorCode.BURN_FAILED,
                    "Encoder produced no data at all (video has no frames?)",
                )
            }

            // Flush any remaining audio (audio is usually a few tens of ms longer than video).
            audioCopier?.pumpUpTo(Long.MAX_VALUE, muxer, audioMuxerTrack)

            // stop() stays in try so file-write errors reach JS instead of being swallowed.
            muxer.stop()
            muxerStarted = false
        } finally {
            // Cleanup order matters: release resources only while their dependencies (EGL, surfaces) are alive.
            runCatching { if (muxerStarted) muxerRef?.stop() }
            runCatching { muxerRef?.release() }
            runCatching { audioCopier?.release() }
            runCatching { decoderRef?.stop() }
            runCatching { decoderRef?.release() }
            runCatching { drawerRef?.release() }
            runCatching { outputSurfaceRef?.release() }
            runCatching { inputSurfaceRef?.release() }
            runCatching { encoderRef?.stop() }
            runCatching { encoderRef?.release() }
            runCatching { encoderSurfaceRef?.release() }
            runCatching { extractorRef?.release() }
        }
    }

    private fun buildEncoderFormat(
        inputFormat: MediaFormat,
        width: Int,
        height: Int,
    ): MediaFormat {
        val frameRate = inputFormat.optInt(MediaFormat.KEY_FRAME_RATE, DEFAULT_FRAME_RATE)
            .coerceIn(1, 240)
        val sourceBitRate = inputFormat.optInt(MediaFormat.KEY_BIT_RATE, 0)
        // ~0.15 bit / pixel / frame when the container doesn't declare a bitrate.
        val estimated = (width.toLong() * height * frameRate * 0.15).roundToInt()
        val bitRate = (if (sourceBitRate > 0) sourceBitRate else estimated)
            .coerceIn(MIN_BIT_RATE, MAX_BIT_RATE)

        return MediaFormat.createVideoFormat(ENCODER_MIME, width, height).apply {
            setInteger(
                MediaFormat.KEY_COLOR_FORMAT,
                MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface,
            )
            setInteger(MediaFormat.KEY_BIT_RATE, bitRate)
            setInteger(MediaFormat.KEY_FRAME_RATE, frameRate)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, I_FRAME_INTERVAL_SEC)
        }
    }

    /** Rotation angle (0/90/180/270); prefers track metadata, falls back to MediaMetadataRetriever for container-level. */
    private fun readRotation(format: MediaFormat): Int {
        val fromTrack = format.optInt(MediaFormat.KEY_ROTATION, Int.MIN_VALUE)
        if (fromTrack != Int.MIN_VALUE) return normalizeRotation(fromTrack)

        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(videoPath)
            val value = retriever
                .extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)
                ?.toIntOrNull() ?: 0
            normalizeRotation(value)
        } catch (_: Exception) {
            0
        } finally {
            // release() throws IOException starting from API 29.
            runCatching { retriever.release() }
        }
    }

    /** Duration in microseconds; prefers track metadata, falls back to MediaMetadataRetriever. */
    private fun readDurationUs(format: MediaFormat): Long {
        if (format.containsKey(MediaFormat.KEY_DURATION)) {
            val value = format.getLong(MediaFormat.KEY_DURATION)
            if (value > 0) return value
        }
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(videoPath)
            val ms = retriever
                .extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                ?.toLongOrNull() ?: 0L
            ms * 1_000
        } catch (_: Exception) {
            0L
        } finally {
            runCatching { retriever.release() }
        }
    }

    private companion object {
        const val ENCODER_MIME = "video/avc"
        const val DEFAULT_FRAME_RATE = 30
        const val I_FRAME_INTERVAL_SEC = 1
        const val MIN_BIT_RATE = 1_000_000
        const val MAX_BIT_RATE = 24_000_000
        const val ENCODER_POLL_TIMEOUT_US = 10_000L
        const val NO_PROGRESS_TIMEOUT_MS = 20_000L

        fun normalizeRotation(degrees: Int): Int {
            val normalized = ((degrees % 360) + 360) % 360
            return if (normalized % 90 == 0) normalized else 0
        }

        fun makeEven(value: Int) = value and 1.inv()

        /** Centre-crops to [ratio] by trimming only; never pads or scales the source up. */
        fun cropToRatio(width: Int, height: Int, ratio: Float?): Pair<Int, Int> {
            if (ratio == null || ratio <= 0f) return width to height
            val current = width.toFloat() / height
            return when {
                current > ratio -> (height * ratio).roundToInt().coerceAtMost(width) to height
                current < ratio -> width to (width / ratio).roundToInt().coerceAtMost(height)
                else -> width to height
            }
        }
    }
}

private fun MediaExtractor.findTrack(mimePrefix: String): Int? {
    for (i in 0 until trackCount) {
        val mime = getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: continue
        if (mime.startsWith(mimePrefix)) return i
    }
    return null
}

/** Display size: KEY_WIDTH/HEIGHT may be codec-aligned; crop rect makes actual displayed size smaller. */
private fun MediaFormat.displaySize(): Pair<Int, Int> {
    var width = optInt(MediaFormat.KEY_WIDTH, 0)
    var height = optInt(MediaFormat.KEY_HEIGHT, 0)
    if (containsKey("crop-left") && containsKey("crop-right")) {
        width = optInt("crop-right", 0) - optInt("crop-left", 0) + 1
    }
    if (containsKey("crop-top") && containsKey("crop-bottom")) {
        height = optInt("crop-bottom", 0) - optInt("crop-top", 0) + 1
    }
    return width to height
}
