package com.rx.videooverlay

/** Burns an independent layer stack; delegates decode/encode/mux to VideoTranscodeEngine. */
internal class VideoLayerBurner(
    private val videoPath: String,
    private val outputPath: String,
    private val layersJson: String,
    private val optionsJson: String,
) {

    fun burn(): String {
        val engine = VideoTranscodeEngine(videoPath, outputPath)
        engine.prepareOutput()

        val layers = OverlayLayerParser.parse(layersJson)
        val cropAspectRatio = OverlayLayerParser.parseOptions(optionsJson)

        engine.transcode(cropAspectRatio) { ctx ->
            LayerRenderer(
                ctx.outputWidth,
                ctx.outputHeight,
                ctx.rotationDegrees,
                layers,
                ctx.durationUs,
                // Oversizing the frame past the viewport is what performs the centre crop.
                ctx.rotatedWidth.toFloat() / ctx.outputWidth,
                ctx.rotatedHeight.toFloat() / ctx.outputHeight,
            )
        }
        return outputPath
    }
}
