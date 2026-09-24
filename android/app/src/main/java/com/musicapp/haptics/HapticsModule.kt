package com.musicapp.haptics

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/** JS side: src/services/haptics.ts. The feel itself is in [Haptics]. */
class HapticsModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

  override fun getName() = NAME

  @ReactMethod
  fun perform(kind: String, strength: String) {
    val view = reactApplicationContext.currentActivity?.window?.decorView
    val ctx = reactApplicationContext
    if (view != null) {
      view.post { Haptics.perform(ctx, view, kind, strength) }
    } else {
      Haptics.perform(ctx, null, kind, strength)
    }
  }

  companion object {
    const val NAME = "StashHaptics"
  }
}
