package com.rx.videooverlay

/** Burns a cue timeline with one global style; delegates decode/encode/mux to VideoTranscodeEngine. */
internal class VideoOverlayBurner(
    private val videoPath: String,
    private val outputPath: String,
    private val cuesJson: String,
    private val styleJson: String,
) {

    fun burn(): String {
        val engine = VideoTranscodeEngine(videoPath, outputPath)
        engine.prepareOutput()

        val cues = OverlayCueParser.parse(cuesJson)
        val style = OverlayStyleParser.parse(styleJson)

        engine.transcode(style.cropAspectRatio, style.maxBitRate) { ctx ->
            FrameRenderer(
                ctx.outputWidth,
                ctx.outputHeight,
                ctx.rotationDegrees,
                OverlayBitmapRenderer(ctx.outputWidth, ctx.outputHeight, cues, style),
                style.opacity,
                cues,
                // Oversizing the frame past the viewport is what performs the centre crop.
                ctx.rotatedWidth.toFloat() / ctx.outputWidth,
                ctx.rotatedHeight.toFloat() / ctx.outputHeight,
            )
        }
        return outputPath
    }
}
