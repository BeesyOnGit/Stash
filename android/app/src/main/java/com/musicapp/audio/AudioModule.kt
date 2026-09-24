package com.musicapp.audio

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.Executors

/** JS side: src/services/convert.ts. */
class AudioModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

  override fun getName() = NAME

  /** Converts `input` to an M4A at `output`, off the main thread; one song at a time. */
  @ReactMethod
  fun toM4a(input: String, output: String, promise: Promise) {
    worker.execute {
      try {
        AudioConverter.toM4a(input.removePrefix("file://"), output.removePrefix("file://"))
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("convert_failed", e.message ?: e.toString(), e)
      }
    }
  }

  companion object {
    const val NAME = "StashAudio"
    private val worker = Executors.newSingleThreadExecutor()
  }
}
