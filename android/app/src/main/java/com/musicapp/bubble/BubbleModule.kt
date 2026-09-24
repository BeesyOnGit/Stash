package com.musicapp.bubble

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext

/** JS side: src/bubble/BubbleBridge.ts. JS pushes state in, taps come out as "StashBubble" events. */
class BubbleModule(context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context), LifecycleEventListener {

  override fun getName() = NAME

  override fun initialize() {
    super.initialize()
    BubbleManager.init(reactApplicationContext.applicationContext)
    BubbleState.emitter = { reactApplicationContext.emitDeviceEvent(EVENT, it) }
    // Calls onHostResume right away if the app is already on screen.
    reactApplicationContext.addLifecycleEventListener(this)
  }

  override fun invalidate() {
    reactApplicationContext.removeLifecycleEventListener(this)
    BubbleState.emitter = null
    main { BubbleManager.hideAll() }
    super.invalidate()
  }

  // ---- the app coming and going ----

  override fun onHostResume() = main {
    BubbleState.foreground = true
    BubbleManager.update()
  }

  override fun onHostPause() = main {
    BubbleState.foreground = false
    BubbleManager.update()
  }

  override fun onHostDestroy() = main {
    BubbleState.foreground = false
    BubbleState.has = false
    BubbleManager.update()
  }

  // ---- permission ----

  @ReactMethod
  fun canDrawOverlays(promise: Promise) {
    promise.resolve(Settings.canDrawOverlays(reactApplicationContext))
  }

  /** Opens the system "Display over other apps" screen for this app. */
  @ReactMethod
  fun requestPermission() {
    val ctx = reactApplicationContext
    val intent = Intent(
      Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
      Uri.parse("package:" + ctx.packageName),
    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      ctx.startActivity(intent)
    } catch (_: Exception) {
      // Some phones have no per-app screen: fall back to the list.
      ctx.startActivity(
        Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    }
  }

  // ---- state from JS ----

  @ReactMethod
  fun setConfig(c: ReadableMap) = main {
    val s = BubbleState
    s.enabled = c.getBoolean("enabled")
    s.ringColor = c.getString("ringColor") ?: "white"
    s.vinylStyle = c.getString("vinylStyle") ?: "classic"
    s.rotate = c.getBoolean("rotate")
    s.haptics = c.getBoolean("haptics")
    s.hapticStrength = c.getString("hapticStrength") ?: "medium"
    BubbleManager.update()
  }

  @ReactMethod
  fun setNowPlaying(p: ReadableMap) = main {
    val s = BubbleState
    s.has = p.getBoolean("has")
    s.title = p.getString("title") ?: ""
    s.artist = p.getString("artist") ?: ""
    s.art = p.getString("art")?.ifEmpty { null }
    s.hue = p.getDouble("hue").toFloat()
    s.playing = p.getBoolean("playing")
    s.buffering = p.getBoolean("buffering")
    s.durationSec = p.getDouble("duration")
    s.speed = p.getDouble("speed").toFloat()
    s.setPosition(p.getDouble("position"))
    BubbleManager.update()
  }

  @ReactMethod
  fun setLists(json: String) = main {
    BubbleState.setLists(json)
    BubbleManager.update()
  }

  /**
   * Android pauses JS timers in the background; a running headless task keeps
   * them going. JS holds one while it handles a tap in the bubble (e.g.
   * resolving a YouTube stream) and ends it when done, or it times out.
   */
  @ReactMethod
  fun holdJs(timeoutMs: Double) {
    UiThreadUtil.runOnUiThread {
      try {
        HeadlessJsTaskContext.getInstance(reactApplicationContext).startTask(
          HeadlessJsTaskConfig(KEEP_ALIVE_TASK, Arguments.createMap(), timeoutMs.toLong(), true),
        )
      } catch (_: Exception) {}
    }
  }

  // Required by NativeEventEmitter.
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Double) {}

  private fun main(block: () -> Unit) {
    reactApplicationContext.runOnUiQueueThread(block)
  }

  companion object {
    const val NAME = "StashBubble"
    const val EVENT = "StashBubble"
    /** Registered in src/bubble/BubbleBridge.ts. */
    const val KEEP_ALIVE_TASK = "StashBubbleKeepAlive"
  }
}
