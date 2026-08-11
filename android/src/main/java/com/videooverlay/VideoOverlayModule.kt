package com.videooverlay

import com.facebook.react.bridge.ReactApplicationContext

class VideoOverlayModule(reactContext: ReactApplicationContext) :
  NativeVideoOverlaySpec(reactContext) {

  override fun multiply(a: Double, b: Double): Double {
    return a * b
  }

  companion object {
    const val NAME = NativeVideoOverlaySpec.NAME
  }
}
